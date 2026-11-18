"""/api/utilities/alarms — ตั้งค่าการแจ้งเตือน (แทน localStorage) + รายการเหตุการณ์ + รับทราบ"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.utilities.auth import User, admin_user, current_user
from app.utilities.db import pool
from app.utilities.services.alarms import engine, event_row_to_dict

router = APIRouter(prefix="/alarms", tags=["alarms"])

UtilitySystem = Literal["water", "electrical", "wastewater"]
SettingKind = Literal["rules", "targets"]


@router.get("/{system}/{kind}")
async def get_setting(system: UtilitySystem, kind: SettingKind, _: User = Depends(current_user)) -> dict:
    """rules = Record<sensorKey, AlarmRule> ที่บันทึกไว้ (frontend เติมค่าตั้งต้นของเซนเซอร์ใหม่เอง) ; targets = NotifyTargets"""
    data = await pool().fetchval("SELECT data FROM alarm_settings WHERE system = $1 AND kind = $2", system, kind)
    return data or {}


@router.put("/{system}/{kind}")
async def put_setting(system: UtilitySystem, kind: SettingKind, data: dict = Body(...), user: User = Depends(admin_user)) -> dict:
    await pool().execute(
        """INSERT INTO alarm_settings (system, kind, data, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (system, kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by""",
        system, kind, data, user.username,
    )
    return data


def _ts(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"invalid datetime: {v}")
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


@router.get("/events")
async def list_events(
    system: UtilitySystem | None = None,
    group_id: str | None = None,
    active: bool | None = Query(None, description="true = ยังไม่จบ, false = จบแล้ว"),
    acknowledged: bool | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    _: User = Depends(current_user),
) -> dict:
    where, args = [], []

    def add(cond: str, value: object) -> None:
        args.append(value)
        where.append(cond.replace("?", f"${len(args)}"))

    if system:
        add("system = ?", system)
    if group_id:
        add("group_id = ?", group_id)
    if active is not None:
        where.append("ended_at IS NULL" if active else "ended_at IS NOT NULL")
    if acknowledged is not None:
        add("acknowledged = ?", acknowledged)
    if (s := _ts(start)) is not None:
        add("started_at >= ?", s)
    if (e := _ts(end)) is not None:
        add("started_at < ?", e)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    total = await pool().fetchval(f"SELECT count(*) FROM alarm_events {clause}", *args)
    rows = await pool().fetch(
        f"SELECT * FROM alarm_events {clause} ORDER BY started_at DESC LIMIT {limit} OFFSET {offset}", *args
    )
    return {"total": total, "items": [event_row_to_dict(r) for r in rows]}


class AckIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


@router.post("/events/ack")
async def ack_events(body: AckIn, user: User = Depends(current_user)) -> dict:
    # สิทธิ์เดียวกับระบบหลัก: alarm:acknowledge (admin / super admin ทำได้เสมอ)
    if not user.can("alarm:acknowledge"):
        raise HTTPException(403, "Permission denied")
    rows = await pool().fetch(
        """UPDATE alarm_events SET acknowledged = TRUE, ack_by = $2, ack_at = now()
           WHERE id = ANY($1::text[]) AND NOT acknowledged RETURNING *""",
        body.ids, user.username,
    )
    items = [event_row_to_dict(r) for r in rows]
    for ev in items:
        engine._notify({"action": "acknowledged", "event": ev})
    return {"updated": len(items), "items": items}
