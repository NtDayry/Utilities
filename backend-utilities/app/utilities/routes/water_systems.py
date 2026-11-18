"""/api/utilities/water-systems — รายการถังน้ำ/บ่อเก็บน้ำ (แทน localStorage ของ frontend) + ค่าล่าสุด + ข้อมูลย้อนหลัง"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.utilities import db
from app.utilities.auth import User, admin_user, current_user
from app.utilities.config import settings
from app.utilities.services.ingest import ingestor
from app.utilities.water import repository
from app.utilities.water.model import normalize_system, validate_system

router = APIRouter(prefix="/water-systems", tags=["water-systems"])

# ขนาดช่วงเวลาที่เลือกอัตโนมัติ (วินาที) — เลือกตัวเล็กสุดที่ให้จุดไม่เกิน TARGET_POINTS
NICE_BUCKETS = [10, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400]
TARGET_POINTS = 500
MAX_POINTS = 5000


# รหัสผ่าน broker ไม่ส่งกลับให้เบราว์เซอร์ (backend เป็นผู้เชื่อมต่อ broker เอง) — ส่งค่านี้แทน
# ถ้าบันทึกกลับมาเป็นค่านี้ = ไม่ได้แก้รหัสผ่าน → ใช้รหัสผ่านเดิมที่เก็บไว้
PASSWORD_MASK = "********"


def _mask(cfg: dict) -> dict:
    b = cfg.get("broker")
    if b and b.get("password"):
        return {**cfg, "broker": {**b, "password": PASSWORD_MASK}}
    return cfg


def _keep_password(cfg: dict, saved: dict | None) -> dict:
    b = cfg.get("broker")
    if b and b.get("password") == PASSWORD_MASK:
        old = (saved or {}).get("broker") or {}
        return {**cfg, "broker": {**b, "password": old.get("password", "") if old.get("url") == b.get("url") else ""}}
    return cfg


def _clean(item: object, index: int | None = None) -> dict:
    cfg = normalize_system(item)
    where = {} if index is None else {"index": index}
    if cfg is None:
        raise HTTPException(422, detail={**where, "errors": {"id": "id_or_name_invalid"}})
    errors = validate_system(cfg)
    # topic ว่าง = "ยังไม่เชื่อมต่อเซ็นเซอร์" (ถัง/บ่อตั้งต้นของโรงงาน) → เก็บได้ ; ระบบไม่รับข้อมูลจนกว่าจะตั้ง topic
    if errors.get("topic") == "topic_required":
        del errors["topic"]
    if errors:
        raise HTTPException(422, detail={**where, "id": cfg["id"], "errors": errors})
    return cfg


@router.get("")
async def list_systems(_: User = Depends(current_user)) -> list[dict]:
    return [_mask(c) for c in await repository.list_systems()]


@router.put("")
async def replace_systems(items: list[dict] = Body(...), user: User = Depends(admin_user)) -> list[dict]:
    """แทนที่ทั้งรายการ (ตรงกับ WaterSystemRepository.saveAll ของ frontend)"""
    systems = [_clean(item, i) for i, item in enumerate(items)]
    ids = [s["id"] for s in systems]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, detail={"errors": {"id": "duplicate_id"}})
    stored = {c["id"]: c for c in await repository.list_systems()}
    systems = [_keep_password(c, stored.get(c["id"])) for c in systems]
    saved = await repository.replace_all(systems, user.username)
    await ingestor.resync()
    return [_mask(c) for c in saved]


SEEDED_KEY = "_water_systems_seeded"


@router.post("/seed")
async def seed_systems(items: list[dict] = Body(...), user: User = Depends(admin_user)) -> list[dict]:
    """ใส่ถัง/บ่อตั้งต้นของโรงงาน (builtins.ts) ครั้งเดียวต่อ id — ถ้า admin ลบทิ้งแล้วจะไม่กลับมาอีก

    แทน logic เดิมที่เก็บรายการ "ใส่แล้ว" ไว้ใน localStorage ของแต่ละเบราว์เซอร์
    """
    systems = [_clean(item, i) for i, item in enumerate(items)]
    async with db.pool().acquire() as conn, conn.transaction():
        await conn.execute("LOCK TABLE water_systems IN SHARE ROW EXCLUSIVE MODE")
        seeded = set((await conn.fetchval("SELECT data FROM app_settings WHERE key = $1", SEEDED_KEY) or {}).get("ids", []))
        existing = {r["id"] for r in await conn.fetch("SELECT id FROM water_systems")}
        for cfg in systems:
            if cfg["id"] in seeded or cfg["id"] in existing:
                continue
            await conn.execute(
                """INSERT INTO water_systems (id, config, sort_order, updated_by)
                   VALUES ($1, $2, COALESCE((SELECT min(sort_order) - 1 FROM water_systems), 0), $3)""",
                cfg["id"], cfg, user.username,
            )
        seeded |= {c["id"] for c in systems}
        await conn.execute(
            """INSERT INTO app_settings (key, data, updated_by) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
            SEEDED_KEY, {"ids": sorted(seeded)}, user.username,
        )
    await ingestor.resync()
    return [_mask(c) for c in await repository.list_systems()]


@router.get("/{system_id}")
async def get_system(system_id: str, _: User = Depends(current_user)) -> dict:
    cfg = await repository.get_system(system_id)
    if cfg is None:
        raise HTTPException(404, "water system not found")
    return _mask(cfg)


@router.put("/{system_id}")
async def upsert_system(system_id: str, item: dict = Body(...), user: User = Depends(admin_user)) -> dict:
    cfg = _clean(item)
    if cfg["id"] != system_id:
        raise HTTPException(422, detail={"errors": {"id": "id_mismatch"}})
    cfg = _keep_password(cfg, await repository.get_system(system_id))
    saved = await repository.upsert(cfg, user.username)
    await ingestor.resync()
    return _mask(saved)


@router.delete("/{system_id}")
async def delete_system(system_id: str, _: User = Depends(admin_user)) -> dict:
    if not await repository.delete(system_id):
        raise HTTPException(404, "water system not found")
    await ingestor.resync()
    return {"status": "deleted", "id": system_id}


@router.get("/{system_id}/latest")
async def latest(system_id: str, _: User = Depends(current_user)) -> dict:
    """ค่าล่าสุดที่ backend รับได้ (raw = ข้อความ JSON ทั้งก้อน, reading/calc = ค่าที่อ่านตาม path แล้ว)"""
    if system_id not in ingestor.systems:
        raise HTTPException(404, "water system not found")
    st = ingestor.state.get(system_id)
    if st is None:
        return {"id": system_id, "at": None, "stale": True, "raw": None, "reading": None, "calc": None, "metrics": {}}
    at = st["at"]
    stale = (datetime.now(timezone.utc).timestamp() - at) > settings.COMM_TIMEOUT_SEC
    return {"id": system_id, "at": datetime.fromtimestamp(at, tz=timezone.utc).isoformat(), "stale": stale, **{k: st[k] for k in ("raw", "reading", "calc", "metrics")}}


def _parse_time(v: str | None, default: datetime) -> datetime:
    if not v:
        return default
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"invalid datetime: {v}")
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


@router.get("/{system_id}/history")
async def history(
    system_id: str,
    metrics: str = Query("level_pct", description="คั่นด้วย , เช่น level_pct,volume_l,pump1_running"),
    start: str | None = Query(None, description="ISO 8601 (ค่าเริ่มต้น 24 ชม. ก่อน end)"),
    end: str | None = Query(None, description="ISO 8601 (ค่าเริ่มต้น = ตอนนี้)"),
    bucket: int | None = Query(None, ge=10, description="ขนาดช่วง (วินาที) — ไม่ระบุ = เลือกอัตโนมัติ"),
    _: User = Depends(current_user),
) -> dict:
    names = [m.strip() for m in metrics.split(",") if m.strip()]
    if not names or len(names) > 20:
        raise HTTPException(422, "metrics: 1-20 names")
    t_end = _parse_time(end, datetime.now(timezone.utc))
    t_start = _parse_time(start, t_end - timedelta(hours=24))
    span = (t_end - t_start).total_seconds()
    if span <= 0:
        raise HTTPException(422, "start must be before end")
    if bucket is None:
        bucket = next((b for b in NICE_BUCKETS if span / b <= TARGET_POINTS), NICE_BUCKETS[-1])
    if span / bucket > MAX_POINTS:
        raise HTTPException(422, f"too many points ({int(span / bucket)}) — use a larger bucket")

    if db.timescale_enabled and bucket % 3600 == 0:
        source, tcol, agg = "readings_1h", "bucket", "sum(avg * cnt) / NULLIF(sum(cnt), 0), min(min), max(max), sum(cnt)"
    elif db.timescale_enabled and bucket % 60 == 0:
        source, tcol, agg = "readings_1m", "bucket", "sum(avg * cnt) / NULLIF(sum(cnt), 0), min(min), max(max), sum(cnt)"
    else:
        source, tcol, agg = "readings", "time", "avg(value), min(value), max(value), count(*)"

    origin = datetime.fromisoformat(settings.BUCKET_ORIGIN)
    rows = await db.pool().fetch(
        f"""SELECT date_bin($5::interval, {tcol}, $6::timestamptz) AS t, metric, {agg}
            FROM {source}
            WHERE system_id = $1 AND metric = ANY($2::text[]) AND {tcol} >= $3 AND {tcol} < $4
            GROUP BY 1, 2 ORDER BY 1""",
        system_id, names, t_start, t_end, timedelta(seconds=bucket), origin,
    )
    series: dict[str, list[dict]] = {n: [] for n in names}
    for r in rows:
        series[r["metric"]].append({"t": r["t"].isoformat(), "avg": r[2], "min": r[3], "max": r[4], "n": int(r[5])})
    return {
        "id": system_id,
        "start": t_start.isoformat(),
        "end": t_end.isoformat(),
        "bucketSec": bucket,
        "source": source,
        "series": series,
    }
