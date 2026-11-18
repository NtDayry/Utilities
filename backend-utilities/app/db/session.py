from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import logging
from sqlalchemy import text
from app.core.config import settings

from app.db.schemas import SEARCH_PATH

# ทุก connection ค้นตารางใน core / purified_water / water_supply / ... ก่อน public
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"server_settings": {"search_path": SEARCH_PATH}},
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

logger = logging.getLogger(__name__)

class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """สร้างตาราง database อัตโนมัติจาก SQLAlchemy models

    - import ทุก model เพื่อให้ Base.metadata รู้จักตาราง
    - เปิดใช้ pg_trgm extension (สำหรับ GIN index ค้นหาแบบ fuzzy)
    - สร้างทุกตารางด้วย create_all (checkfirst=True = ข้ามถ้ามีอยู่แล้ว)
    - สร้าง indexes ที่ไม่สามารถกำหนดผ่าน model ได้โดยตรง
    - seed ข้อมูล default จาก assets/sql/default/*.csv (ข้ามถ้ามีข้อมูลแล้ว)
    """
    # === Import ทุก model เพื่อ register เข้า Base.metadata ===
    import app.db.models.auth_model          # noqa: F401  (Role, Permission, RolePermission, User)
    import app.db.models.audit_log_model     # noqa: F401  (AuditLog)
    import app.db.models.support_team_model  # noqa: F401  (SupportTeam)
    import app.db.models.sensor_model        # noqa: F401  (SensorReading, SensorConfig)
    import app.db.models.alert_model         # noqa: F401  (AlertRule, AlertEvent)
    import app.db.models.pw_mqtt_model       # noqa: F401  (PwMqttBroker, PwMqttMapping)

    from app.db.schemas import DATABASE_SEARCH_PATH_SQL, PURIFIED_WATER, migrate_public

    async def _step(conn, label: str, sql: str) -> bool:
        """รัน 1 คำสั่งใน SAVEPOINT: ถ้าพังจะย้อนเฉพาะคำสั่งนั้นและเขียน log
        (ไม่ใช้ try/except เปล่าๆ — error ใน transaction ทำให้ COMMIT ท้ายบล็อกกลายเป็น ROLLBACK ทั้งบล็อกแบบเงียบๆ)"""
        try:
            async with conn.begin_nested():
                await conn.execute(text(sql))
            return True
        except Exception as exc:
            logger.warning("init_db: %s failed: %s", label, getattr(exc, "orig", exc))
            return False

    async with engine.begin() as conn:
        # === แยก schema ต่อระบบ: สร้าง schema + ย้ายตารางเดิมจาก public (ถ้ามี) ===
        moved = await migrate_public(
            lambda sql: conn.scalar(text(sql)),
            lambda sql: conn.execute(text(sql)),
        )
        if moved:
            logger.info("moved %d tables out of public: %s", len(moved), ", ".join(moved))
        await _step(conn, "database default search_path", DATABASE_SEARCH_PATH_SQL)

        # === เปิดใช้ pg_trgm extension (สำหรับ GIN fuzzy search index) ===
        await _step(conn, "pg_trgm", "CREATE EXTENSION IF NOT EXISTS pg_trgm")

        # === สร้างตารางทั้งหมดจาก model (ข้ามถ้ามีอยู่แล้ว) — model ระบุ schema เองแล้ว ===
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)

        # === Schema column migrations for existing tables ===
        await _step(conn, "alert_rules.save_alarm",
                    "ALTER TABLE purified_water.alert_rules ADD COLUMN IF NOT EXISTS save_alarm BOOLEAN DEFAULT TRUE")

        # === สร้าง GIN Indexes (ต้องใช้ pg_trgm จึงสร้างแยกด้วย raw SQL) — index อยู่ schema เดียวกับตาราง ===
        gin_indexes = [
            # users — ค้นหาชื่อ/username/แผนก แบบ fuzzy
            "CREATE INDEX IF NOT EXISTS idx_users_role ON core.users(role)",
            "CREATE INDEX IF NOT EXISTS idx_users_fullname_trgm ON core.users USING GIN (fullname gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON core.users USING GIN (username gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_users_department_trgm ON core.users USING GIN (department gin_trgm_ops)",
            # role_permissions
            "CREATE INDEX IF NOT EXISTS idx_role_permissions_perm_id ON core.role_permissions(permission_id)",
        ]
        for sql in gin_indexes:
            await _step(conn, sql.split(" ON ")[0].rsplit(" ", 1)[-1], sql)

        # === Seed ข้อมูล default จาก CSV (ข้ามถ้าตารางมีข้อมูลอยู่แล้ว) ===
        # ใช้ SAVEPOINT: seed ล้มเหลวจะย้อนเฉพาะ seed ไม่ทำให้การสร้างตารางทั้งหมดถูก rollback ไปด้วย
        try:
            from app.db.seed import seed_default_data
            async with conn.begin_nested():
                await seed_default_data(conn)
        except Exception:
            logger.exception("Failed to seed default data")

    # === TimescaleDB (Purified Water): hypertable / aggregate / retention / compression ===
    pw = PURIFIED_WATER
    async with engine.begin() as conn:
        # ปกติ init-db/001 สร้างให้แล้ว — เผื่อฐานข้อมูลที่ไม่ได้สร้างผ่าน docker-entrypoint-initdb.d
        await _step(conn, "timescaledb extension",
                    "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') "
                    "THEN CREATE EXTENSION IF NOT EXISTS timescaledb; END IF; END $$")
        has_ts = await conn.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')"))
        if not has_ts:
            logger.warning("TimescaleDB extension not installed — sensor_readings stays a plain table")
            return
        steps = [
            ("hypertable sensor_readings",
             f"SELECT create_hypertable('{pw}.sensor_readings', 'time', if_not_exists => TRUE, migrate_data => TRUE)"),
            # === Continuous Aggregate: 1-hour from 1-min data ===
            ("continuous aggregate sensor_readings_1hour", f"""
                CREATE MATERIALIZED VIEW IF NOT EXISTS {pw}.sensor_readings_1hour
                WITH (timescaledb.continuous) AS
                SELECT
                    time_bucket('1 hour', time) AS bucket,
                    device_name,
                    metric_name,
                    AVG(avg_value)    AS avg_value,
                    MIN(min_value)    AS min_value,
                    MAX(max_value)    AS max_value,
                    AVG(raw_avg)      AS raw_avg,
                    MIN(raw_min)      AS raw_min,
                    MAX(raw_max)      AS raw_max,
                    SUM(sample_count) AS sample_count
                FROM {pw}.sensor_readings
                GROUP BY bucket, device_name, metric_name
                WITH NO DATA
            """),
            # === Retention: 1-min data 6 months / 1-hour data 3 years ===
            ("retention sensor_readings",
             f"SELECT add_retention_policy('{pw}.sensor_readings', INTERVAL '6 months', if_not_exists => TRUE)"),
            ("retention sensor_readings_1hour",
             f"SELECT add_retention_policy('{pw}.sensor_readings_1hour', INTERVAL '3 years', if_not_exists => TRUE)"),
            # === Compression: compress after 7 days ===
            ("compression settings sensor_readings", f"""
                ALTER TABLE {pw}.sensor_readings SET (
                    timescaledb.compress,
                    timescaledb.compress_segmentby = 'device_name, metric_name',
                    timescaledb.compress_orderby = 'time DESC'
                )
            """),
            ("compression policy sensor_readings",
             f"SELECT add_compression_policy('{pw}.sensor_readings', INTERVAL '7 days', if_not_exists => TRUE)"),
            # === Continuous Aggregate Refresh ===
            # ช่วง refresh ต้องครอบอย่างน้อย 2 bucket (2 ชม.): start 3 ชม. - end 1 ชม.
            # (ค่าเดิม 2 ชม. - 1 ชม. ทำให้ TimescaleDB ปฏิเสธ และทั้งบล็อกนี้ถูก rollback แบบเงียบๆ มาตลอด)
            ("refresh policy sensor_readings_1hour",
             f"SELECT add_continuous_aggregate_policy('{pw}.sensor_readings_1hour', "
             "start_offset => INTERVAL '3 hours', end_offset => INTERVAL '1 hour', "
             "schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE)"),
        ]
        for label, sql in steps:
            await _step(conn, label, sql)
