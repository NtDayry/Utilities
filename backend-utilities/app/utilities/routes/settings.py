"""/api/utilities/settings — การตั้งค่าส่วนกลางที่เดิมเก็บใน localStorage ของแต่ละเบราว์เซอร์

ทุกเครื่องเห็นค่าเดียวกัน: อ่าน = ผู้ใช้ที่ login ; แก้ = admin
"""
import json

from fastapi import APIRouter, Body, Depends, HTTPException

from app.utilities.auth import User, admin_user, current_user
from app.utilities.db import pool

router = APIRouter(prefix="/settings", tags=["settings"])

# key ที่อนุญาต (กันการใช้เป็นที่เก็บข้อมูลทั่วไป)
ALLOWED_KEYS = {
    "factory-sensors",  # store/factorySensorSettings.ts — เซ็นเซอร์/alarm ที่แสดงบนแผนผังโรงงาน
    "pump-station-tank",  # lib/tankCalculations.ts — ขนาดบ่อประปาหลัก (ใช้คำนวณปริมาตร)
}
MAX_BYTES = 64 * 1024


def _check(key: str) -> None:
    if key not in ALLOWED_KEYS:
        raise HTTPException(404, f"unknown setting: {key}")


@router.get("")
async def all_settings(_: User = Depends(current_user)) -> dict:
    rows = await pool().fetch("SELECT key, data FROM app_settings WHERE key = ANY($1::text[])", list(ALLOWED_KEYS))
    return {r["key"]: r["data"] for r in rows}


@router.get("/{key}")
async def get_setting(key: str, _: User = Depends(current_user)) -> dict:
    _check(key)
    data = await pool().fetchval("SELECT data FROM app_settings WHERE key = $1", key)
    if data is None:
        raise HTTPException(404, "not set")
    return data


@router.put("/{key}")
async def put_setting(key: str, data: dict = Body(...), user: User = Depends(admin_user)) -> dict:
    _check(key)
    if len(json.dumps(data)) > MAX_BYTES:
        raise HTTPException(413, "setting too large")
    await pool().execute(
        """INSERT INTO app_settings (key, data, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by""",
        key, data, user.username,
    )
    return data
