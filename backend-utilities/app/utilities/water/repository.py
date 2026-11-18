"""ที่เก็บรายการระบบน้ำ (ตาราง water_systems) — config เก็บเป็น JSONB ตามโครงสร้าง WaterSystemConfig ของ frontend"""
from datetime import datetime, timezone

from app.utilities.db import pool


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def list_systems() -> list[dict]:
    rows = await pool().fetch("SELECT config FROM water_systems ORDER BY sort_order, created_at")
    return [r["config"] for r in rows]


async def get_system(system_id: str) -> dict | None:
    return await pool().fetchval("SELECT config FROM water_systems WHERE id = $1", system_id)


async def replace_all(systems: list[dict], user: str) -> list[dict]:
    """แทนที่ทั้งรายการ (ตรงกับ WaterSystemRepository.saveAll ของ frontend) — ลำดับในรายการ = ลำดับที่แสดง"""
    ids = [s["id"] for s in systems]
    async with pool().acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM water_systems WHERE NOT (id = ANY($1::text[]))", ids)
        for order, cfg in enumerate(systems):
            await conn.execute(
                """INSERT INTO water_systems (id, config, sort_order, updated_by) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, sort_order = EXCLUDED.sort_order,
                       updated_at = now(), updated_by = EXCLUDED.updated_by""",
                cfg["id"], cfg, order, user,
            )
    return systems


async def upsert(cfg: dict, user: str) -> dict:
    cfg = {**cfg, "updatedAt": _now_iso()}
    await pool().execute(
        """INSERT INTO water_systems (id, config, sort_order, updated_by)
           VALUES ($1, $2, COALESCE((SELECT max(sort_order) + 1 FROM water_systems), 0), $3)
           ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by""",
        cfg["id"], cfg, user,
    )
    return cfg


async def delete(system_id: str) -> bool:
    res = await pool().execute("DELETE FROM water_systems WHERE id = $1", system_id)
    return res.endswith(" 1")
