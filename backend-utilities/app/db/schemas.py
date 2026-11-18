"""การแบ่ง schema ของฐานข้อมูล (database เดียว แยก schema ต่อระบบ)

    core            ใช้ร่วมกันทุกระบบ: ผู้ใช้ / สิทธิ์ / audit log / ทีมซัพพอร์ต / การแจ้งเตือน / การตั้งค่าส่วนกลาง / MQTT log
    purified_water  ระบบน้ำบริสุทธิ์ (รับค่าทาง MQTT): sensor registry, แหล่งข้อมูล MQTT, ค่าที่อ่าน, กฎ/เหตุการณ์แจ้งเตือน
    water_supply    ระบบประปา: ถัง/บ่อ, ค่าที่อ่านตาม path (MQTT)
    wastewater      ระบบบำบัดน้ำเสีย (ยังไม่มีตาราง)
    electrical      ระบบไฟฟ้า (ยังไม่มีตาราง)

ทุก connection ตั้ง search_path = SEARCH_PATH จึงอ้างชื่อตารางสั้นๆ ได้ (ชื่อตารางต้องไม่ซ้ำกันข้าม schema)
ตารางใหม่: เพิ่มใน TABLE_SCHEMA และใส่ schema ใน model / SQL ที่สร้างตาราง
"""
import logging

logger = logging.getLogger(__name__)

CORE = "core"
PURIFIED_WATER = "purified_water"
WATER_SUPPLY = "water_supply"
WASTEWATER = "wastewater"
ELECTRICAL = "electrical"

ALL_SCHEMAS = [CORE, PURIFIED_WATER, WATER_SUPPLY, WASTEWATER, ELECTRICAL]
SEARCH_PATH = ", ".join(ALL_SCHEMAS + ["public"])

# ตาราง / continuous aggregate ทั้งหมด → schema (ใช้ย้ายจาก public, backup/restore, เอกสาร)
TABLE_SCHEMA: dict[str, str] = {
    # ---- ใช้ร่วมกัน ----
    "roles": CORE,
    "permissions": CORE,
    "role_permissions": CORE,
    "users": CORE,
    "audit_logs": CORE,
    "support_team": CORE,
    "notification_settings": CORE,  # ค่า LINE / Email กลาง
    "app_settings": CORE,  # การตั้งค่าส่วนกลางของหน้าเว็บ (แผนผังโรงงาน ฯลฯ)
    "alarm_settings": CORE,  # กฎ/ผู้รับแจ้งของ water / electrical / wastewater (แยกด้วยคอลัมน์ system)
    "alarm_events": CORE,  # เหตุการณ์แจ้งเตือนของ water / electrical / wastewater (แยกด้วยคอลัมน์ system)
    "mqtt_messages": CORE,  # log ข้อความ MQTT ดิบจากทุก broker / topic
    # ---- Purified Water ----
    "sensor_groups": PURIFIED_WATER,
    "sensors": PURIFIED_WATER,
    "sensor_configs": PURIFIED_WATER,
    "sensor_readings": PURIFIED_WATER,
    "sensor_readings_1hour": PURIFIED_WATER,
    "alert_rules": PURIFIED_WATER,
    "alert_events": PURIFIED_WATER,
    "pw_mqtt_broker": PURIFIED_WATER,  # broker MQTT ที่รับค่าเซนเซอร์
    "pw_mqtt_mappings": PURIFIED_WATER,  # เซนเซอร์ ← topic + field
    # ---- ประปา ----
    "water_systems": WATER_SUPPLY,
    "readings": WATER_SUPPLY,
    "readings_1m": WATER_SUPPLY,
    "readings_1h": WATER_SUPPLY,
}

# continuous aggregate (ย้ายด้วย ALTER MATERIALIZED VIEW)
_MATVIEWS = {"sensor_readings_1hour", "readings_1m", "readings_1h"}


def qualified(table: str) -> str:
    """ชื่อเต็ม "schema"."table" สำหรับ SQL"""
    return f'"{TABLE_SCHEMA[table]}"."{table}"'


async def migrate_public(fetchval, execute) -> list[str]:
    """สร้าง schema และย้ายตารางเดิมออกจาก public (idempotent — รันทุกครั้งที่เริ่มได้)

    fetchval(sql) / execute(sql) = ฟังก์ชัน async ของ connection ที่อยู่ใน transaction
    (ใช้ได้ทั้ง SQLAlchemy และ asyncpg — ส่วน PurifiedWater และ utilities เรียกทั้งคู่ ใครเริ่มก่อนก็ย้ายก่อน)
    ALTER ... SET SCHEMA ย้ายเฉพาะชื่อ: ข้อมูล / index / sequence / hypertable chunk / policy ตามไปเอง ไม่มีการคัดลอกข้อมูล
    คืนรายการที่ย้าย
    """
    for s in ALL_SCHEMAS:
        await execute(f'CREATE SCHEMA IF NOT EXISTS "{s}"')

    moved: list[str] = []
    # ย้ายตารางก่อน แล้วค่อยย้าย continuous aggregate
    for name in sorted(TABLE_SCHEMA, key=lambda n: n in _MATVIEWS):
        target = TABLE_SCHEMA[name]
        if not await fetchval(f"SELECT to_regclass('public.\"{name}\"') IS NOT NULL"):
            continue
        if await fetchval(f"SELECT to_regclass('\"{target}\".\"{name}\"') IS NOT NULL"):
            logger.error(
                "schema migration: both public.%s and %s.%s exist — left public.%s untouched, please resolve manually",
                name, target, name, name,
            )
            continue
        kind = "MATERIALIZED VIEW" if name in _MATVIEWS else "TABLE"
        await execute(f'ALTER {kind} public."{name}" SET SCHEMA "{target}"')
        logger.info("schema migration: public.%s -> %s.%s", name, target, name)
        moved.append(f"{target}.{name}")
    return moved


# ให้ psql / เครื่องมืออื่นที่ต่อฐานข้อมูลนี้เห็นตารางด้วยชื่อสั้นเหมือนเดิม (มีผลกับ connection ใหม่)
# อาจ error ถ้า user ไม่ใช่เจ้าของฐานข้อมูล — รันใน savepoint แล้วข้ามได้ เพราะแอปตั้ง search_path ต่อ connection อยู่แล้ว
DATABASE_SEARCH_PATH_SQL = (
    "DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = " + SEARCH_PATH + "', current_database()); END $$"
)
