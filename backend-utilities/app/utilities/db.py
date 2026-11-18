"""การเชื่อมต่อ PostgreSQL (asyncpg) + สร้าง schema / นโยบาย TimescaleDB ตอนเริ่ม (idempotent)"""
import json
import logging

import asyncpg

from app.db.schemas import SEARCH_PATH, migrate_public
from app.utilities.config import settings

log = logging.getLogger("utilities.db")

_pool: asyncpg.Pool | None = None
timescale_enabled = False


async def _init_conn(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(typ, encoder=lambda v: json.dumps(v, ensure_ascii=False), decoder=json.loads, schema="pg_catalog")


def pool() -> asyncpg.Pool:
    if _pool is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="utilities service unavailable (see server log)")
    return _pool


BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS water_supply.water_systems (
    id          TEXT PRIMARY KEY,
    config      JSONB NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT
);

-- ค่าที่อ่านตาม path ของแต่ละระบบ (1 แถว = 1 ค่า) → hypertable
CREATE TABLE IF NOT EXISTS water_supply.readings (
    time       TIMESTAMPTZ NOT NULL,
    system_id  TEXT NOT NULL,
    metric     TEXT NOT NULL,
    value      DOUBLE PRECISION NOT NULL
);

-- ข้อความ MQTT ทั้งก้อน (สุ่มเก็บ) → hypertable
CREATE TABLE IF NOT EXISTS core.mqtt_messages (
    time     TIMESTAMPTZ NOT NULL,
    broker   TEXT NOT NULL,
    topic    TEXT NOT NULL,
    payload  JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS mqtt_messages_topic_time_idx ON core.mqtt_messages (topic, time DESC);

-- ตั้งค่าการแจ้งเตือนของแต่ละกลุ่มระบบ (water / electrical / wastewater): rules, targets
CREATE TABLE IF NOT EXISTS core.alarm_settings (
    system      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT,
    PRIMARY KEY (system, kind)
);

-- การตั้งค่าส่วนกลางของหน้าเว็บ (เดิมอยู่ใน localStorage) — key ที่อนุญาตอยู่ใน routes/settings.py
CREATE TABLE IF NOT EXISTS core.app_settings (
    key         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT
);

-- เหตุการณ์แจ้งเตือน (โครงสร้างตาม UtilityAlarmEvent ของ frontend)
CREATE TABLE IF NOT EXISTS core.alarm_events (
    id            TEXT PRIMARY KEY,
    system        TEXT NOT NULL,
    group_id      TEXT NOT NULL,
    sensor_key    TEXT NOT NULL,
    device_name   TEXT NOT NULL,
    metric_name   TEXT NOT NULL,
    device_th     TEXT NOT NULL DEFAULT '',
    device_en     TEXT NOT NULL DEFAULT '',
    th            TEXT NOT NULL DEFAULT '',
    en            TEXT NOT NULL DEFAULT '',
    unit          TEXT NOT NULL DEFAULT '',
    dp            INTEGER NOT NULL DEFAULT 1,
    level         TEXT NOT NULL,
    severity      TEXT NOT NULL,
    value         DOUBLE PRECISION,
    limit_value   DOUBLE PRECISION,
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
    ack_by        TEXT,
    ack_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alarm_events_started_idx ON core.alarm_events (started_at DESC);
CREATE INDEX IF NOT EXISTS alarm_events_active_idx ON core.alarm_events (system) WHERE ended_at IS NULL;
"""


def _timescale_sql() -> list[str]:
    s = settings
    sql = [
        "SELECT create_hypertable('water_supply.readings', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE)",
        "SELECT create_hypertable('core.mqtt_messages', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE)",
        """ALTER TABLE water_supply.readings SET (timescaledb.compress,
            timescaledb.compress_segmentby = 'system_id, metric', timescaledb.compress_orderby = 'time DESC')""",
        """ALTER TABLE core.mqtt_messages SET (timescaledb.compress,
            timescaledb.compress_segmentby = 'topic', timescaledb.compress_orderby = 'time DESC')""",
        f"SELECT add_compression_policy('water_supply.readings', INTERVAL '{int(s.COMPRESS_AFTER_DAYS)} days', if_not_exists => TRUE)",
        f"SELECT add_compression_policy('core.mqtt_messages', INTERVAL '{int(s.COMPRESS_AFTER_DAYS)} days', if_not_exists => TRUE)",
        # ข้อมูลรวมรายนาที (min/avg/max/count) — materialized_only = false: รวมข้อมูลล่าสุดที่ยังไม่ได้ refresh ด้วย
        """CREATE MATERIALIZED VIEW IF NOT EXISTS water_supply.readings_1m
            WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
            SELECT time_bucket(INTERVAL '1 minute', time) AS bucket, system_id, metric,
                   avg(value) AS avg, min(value) AS min, max(value) AS max, count(*) AS cnt
            FROM water_supply.readings GROUP BY bucket, system_id, metric WITH NO DATA""",
        """SELECT add_continuous_aggregate_policy('water_supply.readings_1m',
            start_offset => INTERVAL '2 hours', end_offset => INTERVAL '1 minute',
            schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)""",
        # รายชั่วโมง สร้างต่อจากรายนาที (hierarchical continuous aggregate)
        """CREATE MATERIALIZED VIEW IF NOT EXISTS water_supply.readings_1h
            WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
            SELECT time_bucket(INTERVAL '1 hour', bucket) AS bucket, system_id, metric,
                   sum(avg * cnt) / NULLIF(sum(cnt), 0) AS avg, min(min) AS min, max(max) AS max, sum(cnt) AS cnt
            FROM water_supply.readings_1m GROUP BY 1, system_id, metric WITH NO DATA""",
        """SELECT add_continuous_aggregate_policy('water_supply.readings_1h',
            start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE)""",
    ]
    # นโยบายการลบข้อมูลเก่า: ลบของเดิมแล้วตั้งใหม่ทุกครั้ง เพื่อให้ค่าใน .env ที่เปลี่ยนมีผล
    for rel, days in (
        ("water_supply.readings", s.RAW_RETENTION_DAYS),
        ("core.mqtt_messages", s.MESSAGE_RETENTION_DAYS),
        ("water_supply.readings_1m", s.AGG_1M_RETENTION_DAYS),
        ("water_supply.readings_1h", s.AGG_1H_RETENTION_DAYS),
    ):
        sql.append(f"SELECT remove_retention_policy('{rel}', if_exists => TRUE)")
        if int(days) > 0:
            sql.append(f"SELECT add_retention_policy('{rel}', INTERVAL '{int(days)} days', if_not_exists => TRUE)")
    return sql


async def init_db() -> None:
    global _pool, timescale_enabled
    _pool = await asyncpg.create_pool(
        settings.DATABASE_URL, min_size=settings.DB_POOL_MIN, max_size=settings.DB_POOL_MAX, init=_init_conn, command_timeout=30,
        server_settings={"search_path": SEARCH_PATH},
    )
    async with _pool.acquire() as conn:
        available = await conn.fetchval("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb')")
        if available:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
        # แยก schema ต่อระบบ (ปกติส่วน PurifiedWater ย้ายไปแล้วตอนเริ่ม — เรียกซ้ำเผื่อส่วนนั้นล้มเหลว)
        async with conn.transaction():
            await migrate_public(conn.fetchval, conn.execute)
        await conn.execute(BASE_SCHEMA)
        # unique index ของ readings (กันข้อมูลซ้ำตอน restore) — ต้องสร้างก่อนเปิด compression
        # ฐานข้อมูลที่เปิด compression ไปแล้วจะเพิ่ม index ไม่ได้: แจ้งเตือนแล้วทำงานต่อ
        # (เช็คก่อน: TimescaleDB ปฏิเสธ CREATE INDEX บนตารางที่บีบอัดแล้วแม้จะมี IF NOT EXISTS)
        if not await conn.fetchval("SELECT to_regclass('water_supply.readings_sys_metric_time_uidx') IS NOT NULL"):
            try:
                await conn.execute("CREATE UNIQUE INDEX readings_sys_metric_time_uidx ON water_supply.readings (system_id, metric, time DESC)")
            except asyncpg.PostgresError as exc:
                log.warning("cannot create unique index on readings (%s) — restore may duplicate readings rows", exc)
        timescale_enabled = bool(await conn.fetchval("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')"))
        if timescale_enabled:
            for stmt in _timescale_sql():
                await conn.execute(stmt)
            log.info("TimescaleDB enabled: hypertables, compression, continuous aggregates and retention ready")
        else:
            log.warning("TimescaleDB extension not available — running on plain PostgreSQL (no compression / aggregates / retention)")


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
