"""รับข้อมูล MQTT ของทุกระบบน้ำ → อ่านค่าตาม path → บันทึก TimescaleDB + ประเมินแจ้งเตือน

- subscribe topic ของทุกระบบใน water_systems + บ่อประปา/ปั๊ม (supply_source) + MQTT_EXTRA_TOPICS (broker พื้นฐาน)
- ค่าตาม path บันทึกทุก METRIC_SAMPLE_SEC ต่อระบบ (ตาราง readings)
- ข้อความทั้งก้อนบันทึกทุก RAW_MESSAGE_SAMPLE_SEC ต่อ topic (ตาราง mqtt_messages)
- เขียนฐานข้อมูลแบบรวมเป็นชุด (ไม่ถ่วงการรับข้อความ)
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from app.utilities.config import settings
from app.utilities.db import pool
from app.utilities.mqtt.hub import Broker, default_broker, hub, resolve_broker
from app.utilities.services.alarms import engine
from app.utilities.water import repository
from app.utilities.water.model import system_metrics
from app.utilities.water.supply_source import source as supply_source

log = logging.getLogger("utilities.ingest")

FLUSH_SEC = 2.0
QUEUE_MAX = 50_000


class Ingestor:
    def __init__(self) -> None:
        self.systems: dict[str, dict] = {}
        # (broker.key, topic) → [system ids]
        self.by_feed: dict[tuple[str, str], list[str]] = {}
        self.feeds: set[tuple[Broker, str]] = set()
        self.state: dict[str, dict] = {}  # system id → ค่าล่าสุดที่คำนวณแล้ว
        self.last_msg: dict[str, float] = {}
        self._last_metric: dict[str, float] = {}
        self._last_raw: dict[tuple[str, str], float] = {}
        self._readings: list[tuple] = []
        self._messages: list[tuple] = []
        self._tasks: list[asyncio.Task] = []
        self._sync_lock = asyncio.Lock()
        self.dropped = 0

    async def start(self) -> None:
        await self.resync()
        self._tasks = [asyncio.create_task(self._flush_loop(), name="ingest-flush")]
        if settings.ALARM_ENGINE_ENABLED:
            self._tasks.append(asyncio.create_task(self._comm_loop(), name="ingest-comm"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self._flush()

    async def resync(self) -> None:
        """โหลดรายการระบบใหม่จากฐานข้อมูล แล้วปรับ subscription ให้ตรง (เรียกหลังเพิ่ม/แก้/ลบระบบ)"""
        async with self._sync_lock:
            systems = {s["id"]: s for s in await repository.list_systems()}
            removed = set(self.systems) - set(systems)
            want: set[tuple[Broker, str]] = set()
            by_feed: dict[tuple[str, str], list[str]] = {}
            for sid, cfg in systems.items():
                if not cfg.get("topic"):
                    continue
                b = resolve_broker(cfg.get("broker"))
                want.add((b, cfg["topic"]))
                by_feed.setdefault((b.key, cfg["topic"]), []).append(sid)
            # บ่อน้ำประปาโรงงาน + ระบบปั๊ม: topic / broker ที่ตั้งในหน้าเว็บ (water/supply_source.py)
            for topic in supply_source.topics():
                want.add((supply_source.broker(), topic))
            for topic in settings.extra_topics:
                want.add((default_broker(), topic))

            self.systems = systems
            self.by_feed = by_feed
            for b, topic in want - self.feeds:
                await hub.subscribe(b, topic, self.on_message)
            for b, topic in self.feeds - want:
                await hub.unsubscribe(b, topic, self.on_message)
            self.feeds = want
            now = time.time()
            for sid in removed:
                self.state.pop(sid, None)
                self.last_msg.pop(sid, None)
                if settings.ALARM_ENGINE_ENABLED:
                    engine.close_system(sid, now)
            log.info("ingest: %d system(s), %d feed(s)", len(systems), len(want))

    async def on_message(self, broker_key: str, topic: str, data: Any, at: float) -> None:
        feed = (broker_key, topic)
        if settings.RAW_MESSAGE_SAMPLE_SEC > 0 and at - self._last_raw.get(feed, 0) >= settings.RAW_MESSAGE_SAMPLE_SEC:
            self._last_raw[feed] = at
            self._push(self._messages, (datetime.fromtimestamp(at, tz=timezone.utc), broker_key, topic, data))

        for sid in self.by_feed.get(feed, ()):
            cfg = self.systems.get(sid)
            if cfg is None:
                continue
            try:
                reading, calc, metrics = system_metrics(cfg, data)
            except Exception:
                log.exception("cannot read system %s", sid)
                continue
            self.last_msg[sid] = at
            self.state[sid] = {"at": at, "raw": data, "reading": reading, "calc": calc, "metrics": metrics}
            if settings.ALARM_ENGINE_ENABLED:
                engine.evaluate(cfg, metrics, at)
            if metrics and at - self._last_metric.get(sid, 0) >= settings.METRIC_SAMPLE_SEC:
                self._last_metric[sid] = at
                ts = datetime.fromtimestamp(at, tz=timezone.utc)
                for name, value in metrics.items():
                    self._push(self._readings, (ts, sid, name, float(value)))

    def _push(self, buf: list, row: tuple) -> None:
        if len(self._readings) + len(self._messages) >= QUEUE_MAX:
            self.dropped += 1
            return
        buf.append(row)

    async def _flush(self) -> None:
        readings, self._readings = self._readings, []
        messages, self._messages = self._messages, []
        if not readings and not messages:
            return
        try:
            async with pool().acquire() as conn:
                if readings:
                    await conn.copy_records_to_table("readings", schema_name="water_supply", records=readings, columns=["time", "system_id", "metric", "value"])
                if messages:
                    await conn.executemany("INSERT INTO mqtt_messages (time, broker, topic, payload) VALUES ($1, $2, $3, $4)", messages)
        except Exception:
            log.exception("flush failed — %d reading(s), %d message(s) put back", len(readings), len(messages))
            # ใส่กลับไว้ลองใหม่รอบหน้า (ถ้าฐานข้อมูลล่มนานจะถูกจำกัดที่ QUEUE_MAX)
            self._readings[:0] = readings[: QUEUE_MAX // 2]
            self._messages[:0] = messages[: QUEUE_MAX // 10]

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_SEC)
            await self._flush()

    async def _comm_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            try:
                engine.check_comm(self.systems, self.last_msg, time.time())
            except Exception:
                log.exception("comm check failed")


ingestor = Ingestor()
