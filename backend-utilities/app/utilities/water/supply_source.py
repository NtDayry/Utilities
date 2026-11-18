"""แหล่งข้อมูล MQTT ของ "บ่อน้ำประปาโรงงาน + ระบบปั๊ม" (คอนโทรลเลอร์ WaterLevel — หน้า Water Supply / Pump Station / Control)

ตั้งค่าในหน้าเว็บ (Water Supply → ตั้งค่าคอนโทรลเลอร์, admin) — เก็บใน core.app_settings key "_water_supply_mqtt"
(key ขึ้นต้นด้วย _ ไม่อยู่ใน ALLOWED_KEYS ของ /settings จึงไม่ถูกส่งให้หน้าเว็บ — มีรหัสผ่าน broker)

  topic   : topic หลัก — ใช้ <topic> (ข้อมูล), <topic>/settings, <topic>/configs และส่งคำสั่งไป <topic>/set
  broker  : None = broker พื้นฐานของ backend (DEFAULT_MQTT_URL + bridge ไป broker เดิม) ; หรือ {url, username, password}
ยังไม่ได้ตั้ง = topic แรกใน MQTT_CONTROL_TOPICS (.env) บน broker พื้นฐาน (พฤติกรรมเดิม)

หน้าเว็บ subscribe / publish ผ่าน /ws/utilities/mqtt ด้วย systemId = SYSTEM_ID
"""
from __future__ import annotations

import logging

from app.utilities.config import settings
from app.utilities.db import pool
from app.utilities.mqtt.hub import Broker, resolve_broker

log = logging.getLogger("utilities.water_supply")

KEY = "_water_supply_mqtt"
SYSTEM_ID = "__water_supply__"
DEFAULT_TOPIC = "water-system-production"


def default_config() -> dict:
    topics = settings.control_topics
    return {"topic": topics[0] if topics else DEFAULT_TOPIC, "broker": None}


class SupplySource:
    def __init__(self) -> None:
        self.cfg: dict = default_config()

    async def load(self) -> None:
        data = await pool().fetchval("SELECT data FROM app_settings WHERE key = $1", KEY)
        cfg = default_config()
        if isinstance(data, dict):
            if isinstance(data.get("topic"), str) and data["topic"]:
                cfg["topic"] = data["topic"]
            b = data.get("broker")
            if isinstance(b, dict) and b.get("url"):
                cfg["broker"] = {"url": b["url"], "username": b.get("username") or "", "password": b.get("password") or ""}
        self.cfg = cfg

    async def save(self, cfg: dict, username: str | None) -> None:
        await pool().execute(
            """INSERT INTO app_settings (key, data, updated_by) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by""",
            KEY, cfg, username,
        )
        self.cfg = cfg
        log.info("water supply MQTT source: %s @ %s (by %s)", cfg["topic"], self.broker().key, username)

    @property
    def topic(self) -> str:
        return self.cfg["topic"]

    def broker(self) -> Broker:
        return resolve_broker(self.cfg.get("broker"))

    def topics(self) -> list[str]:
        """topic ที่หน้าเว็บฟังได้ / ที่บันทึกข้อความดิบ"""
        t = self.topic
        return [t, f"{t}/settings", f"{t}/configs"]


source = SupplySource()
