"""จุดเชื่อมส่วน Utilities เข้ากับแอปหลัก (app/main.py)

- start_utilities(): สร้างตาราง/นโยบาย TimescaleDB ของส่วนนี้ → เริ่ม alarm engine → เริ่มรับ MQTT
- stop_utilities(): ปิดตามลำดับกลับกัน
- utilities_routers(): router ทั้งหมดของส่วนนี้ พร้อม prefix

ต้องรันแอป 1 process เท่านั้น (MQTT / บันทึก / แจ้งเตือน อยู่ใน process เดียว) — ห้ามใช้ --workers > 1
"""
import logging

from fastapi import APIRouter

from app.utilities import db
from app.utilities.config import settings
from app.utilities.mqtt.hub import hub
from app.utilities.routes import alarms, mqtt, settings as settings_routes, water_supply, water_systems, ws
from app.utilities.services.alarms import engine
from app.utilities.services.ingest import ingestor
from app.utilities.water.supply_source import source as supply_source

log = logging.getLogger("utilities")

health_router = APIRouter(tags=["utilities"])


@health_router.get("/health")
async def utilities_health() -> dict:
    try:
        await db.pool().fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    st = hub.status()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
        "timescaledb": db.timescale_enabled,
        "mqttConnected": sum(1 for c in st if c["connected"]),
        "mqttBrokers": len(st),
        "systems": len(ingestor.systems),
        "dropped": ingestor.dropped,
    }


def utilities_routers() -> list[tuple[APIRouter, str]]:
    p = settings.API_PREFIX
    return [(health_router, p), (water_systems.router, p), (alarms.router, p), (mqtt.router, p), (settings_routes.router, p), (water_supply.router, p), (ws.router, "")]


async def start_utilities() -> bool:
    try:
        await db.init_db()
        await supply_source.load()
        if settings.ALARM_ENGINE_ENABLED:
            await engine.start()
        await ingestor.start()
        log.info("utilities started")
        return True
    except Exception:
        log.exception("utilities failed to start — water-system / MQTT features are unavailable")
        # ปิดให้หมด: API ส่วนนี้ตอบ 503 ชัดเจน แทนการทำงานครึ่งๆ กลางๆ
        await ingestor.stop()
        await engine.stop()
        await hub.close()
        await db.close_db()
        return False


async def stop_utilities() -> None:
    await ingestor.stop()
    await engine.stop()
    await hub.close()
    await db.close_db()
