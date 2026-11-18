"""การตั้งค่าของส่วน Utilities (ระบบน้ำ / MQTT / แจ้งเตือน) — อ่านจาก environment

ค่าที่ใช้ร่วมกับระบบหลัก (DATABASE_URL, SECRET_KEY, LOG_LEVEL ...) อยู่ที่ app/core/config.py
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import settings as core_settings


class UtilitiesSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    API_PREFIX: str = "/api/utilities"
    WS_PREFIX: str = "/ws/utilities"

    # ---------- Database (ใช้ฐานข้อมูลเดียวกับระบบหลัก) ----------
    DB_POOL_MIN: int = 2
    DB_POOL_MAX: int = 10
    RAW_RETENTION_DAYS: int = 90
    AGG_1M_RETENTION_DAYS: int = 400
    AGG_1H_RETENTION_DAYS: int = 0  # 0 = เก็บตลอดไป
    MESSAGE_RETENTION_DAYS: int = 30
    COMPRESS_AFTER_DAYS: int = 7
    BUCKET_ORIGIN: str = "2000-01-01T00:00:00+07:00"

    # ---------- MQTT ----------
    DEFAULT_MQTT_URL: str = "mqtt://utilities-mqtt:1883"
    DEFAULT_MQTT_USERNAME: str = ""
    DEFAULT_MQTT_PASSWORD: str = ""
    MQTT_EXTRA_TOPICS: str = "water-system-production,water-system-production/settings,water-system-production/configs"
    MQTT_CONTROL_TOPICS: str = "water-system-production"
    MQTT_RECONNECT_SEC: float = 5.0
    MQTT_CLIENT_PREFIX: str = "utilities-api"

    # ---------- Ingestion ----------
    METRIC_SAMPLE_SEC: float = 10.0
    RAW_MESSAGE_SAMPLE_SEC: float = 60.0
    COMM_TIMEOUT_SEC: float = 60.0

    # ---------- Alarms ----------
    ALARM_ENGINE_ENABLED: bool = True
    ALARM_LEVEL_DEADBAND_PCT: float = 1.0

    # ---------- สิทธิ์ (login ใช้ระบบหลัก) ----------
    # role ที่แก้ตั้งค่าระบบน้ำ / ส่งคำสั่งได้ (ตรงกับ isAdminRole ของ frontend-utilities)
    ADMIN_ROLES: str = "super admin,admin"

    @staticmethod
    def _split(v: str) -> list[str]:
        return [x.strip() for x in v.split(",") if x.strip()]

    @property
    def DATABASE_URL(self) -> str:
        """URL เดียวกับระบบหลัก แต่ในรูปที่ asyncpg ใช้ได้ตรง (ตัด +asyncpg ออก)"""
        return core_settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)

    @property
    def extra_topics(self) -> list[str]:
        return self._split(self.MQTT_EXTRA_TOPICS)

    @property
    def control_topics(self) -> list[str]:
        return self._split(self.MQTT_CONTROL_TOPICS)

    @property
    def admin_roles(self) -> set[str]:
        return {r.lower() for r in self._split(self.ADMIN_ROLES)}


@lru_cache
def get_settings() -> UtilitiesSettings:
    return UtilitiesSettings()


settings = get_settings()
