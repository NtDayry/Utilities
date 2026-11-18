"""Purified Water: รับค่าเซนเซอร์จาก MQTT (ทำงานแทนตัวอ่าน Modbus RS485 — modbus_service/main.py)

ทำหน้าที่เดียวกับตัวอ่านเดิมทุกอย่าง แต่ข้อมูลมาจาก MQTT:
  1) อ่านค่า raw ตาม topic + field ของแต่ละเซนเซอร์ (ตั้งค่าในหน้า purified-water/settings)
  2) แปลงเป็นค่าจริงด้วย sensor_config ที่ใช้งานอยู่ (สูตรเดียวกับ decoders เดิม: 4-20mA → raw_min/max → range_min/max)
  3) ค่าสดบนหน้าเว็บ: เบราว์เซอร์ subscribe topic เดียวกันผ่าน /ws/utilities/mqtt (systemId = PW_SYSTEM_ID)
     แล้วแปลงค่าเองด้วยสูตรเดียวกัน (frontend: src/lib/purifiedWater/pwMqttLive.ts) — ไม่ใช้ /ws/sensor-data แล้ว
  4) ตรวจกฎแจ้งเตือนต่อเนื่อง (sustained_seconds) → สร้าง/ปิด alert event + ส่ง LINE/Email แบบเดิม
  5) รวมค่ารายนาที (avg/min/max) → บันทึก sensor_readings ผ่าน logic เดิมของ POST /api/ingest/sensor-data

payload ที่รับได้: JSON object (เลือก field ด้วย path เช่น "ro1.conduct", "regs.0") หรือค่าเดี่ยว (ตัวเลข / ข้อความตัวเลข — field ว่าง)
ค่า raw ที่รับได้: ตัวเลข, ข้อความที่เป็นตัวเลข หรือ register 2 ตัว [hi, lo] สำหรับ bcd_hex / float32_cdab
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import select

from app.db.models.alert_model import AlertRule
from app.db.models.pw_mqtt_model import PwMqttBroker, PwMqttMapping
from app.db.models.sensor_model import SensorConfig
from app.db.session import AsyncSessionLocal
from app.purified_water.decoders import decode_float32_cdab, decode_value
from app.utilities.mqtt.hub import Broker, hub

log = logging.getLogger("purified_water.mqtt")

PW_SYSTEM_ID = "__purified_water__"  # systemId ของ /ws/utilities/mqtt สำหรับ broker ของ Purified Water
TICK_SEC = 1.0  # ตรวจปิดนาทีที่ผ่านไปแล้ว
RELOAD_SEC = 5.0  # โหลด sensor config / กฎแจ้งเตือนใหม่ (เดิม CONFIG_REFRESH_INTERVAL = 3 วินาที)
AGGREGATE_SEC = 60  # รวมค่ารายนาที (เดิม AGGREGATE_INTERVAL = 60)


# ----------------------------------------------------------------- อ่าน / แปลงค่า
def read_field(data: Any, path: str) -> Any:
    """อ่านค่าตาม path ("a.b", "regs.0") ; path ว่าง = ค่าเดี่ยวของ payload"""
    if not path:
        return data.get("value") if isinstance(data, dict) else data
    cur = data
    for key in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(key)
        elif isinstance(cur, list) and key.isdigit() and int(key) < len(cur):
            cur = cur[int(key)]
        else:
            return None
        if cur is None:
            return None
    return cur


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, str) and v.strip():
        try:
            f = float(v.strip())
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


def _registers(v: Any) -> list[int] | None:
    if isinstance(v, list) and v and all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x <= 0xFFFF for x in v):
        return v
    return None


@dataclass
class Converted:
    raw: Any
    value: float
    status: str


def convert(raw: Any, cfg: dict) -> Converted | None:
    """ค่า raw → ค่าจริงตาม sensor config (สูตรเดียวกับ build_reading_result ของตัวอ่าน Modbus)"""
    decode_type = cfg.get("decode_type") or "analog_4_20ma"
    regs = _registers(raw)
    if regs is not None and len(regs) == 2 and decode_type in ("bcd_hex", "float32_cdab"):
        res = decode_value(regs, decode_type, cfg)
        if decode_type == "bcd_hex":
            text = f"{regs[0]:04X}.{regs[1]:04X}"
            raw_scalar: Any = float(text) if text.replace(".", "", 1).isdigit() else regs[0]
        else:
            f = decode_float32_cdab(regs)
            raw_scalar = f.value if f.status != "ERROR" else regs[0]
        return Converted(raw_scalar, res.value, res.status)
    if regs is not None and len(regs) == 1:
        raw = regs[0]
    n = _num(raw)
    if n is None:
        return None
    if decode_type == "analog_4_20ma":
        res = decode_value([n], decode_type, cfg)
        return Converted(n, res.value, res.status)
    # bcd_hex / float32_cdab ที่ส่งมาเป็นตัวเลขแล้ว = ค่าจริง
    value = n
    dp = cfg.get("decimal_places")
    if dp is not None:
        try:
            value = round(value, int(dp))
        except (TypeError, ValueError):
            pass
    return Converted(n, value, "OK")


# ----------------------------------------------------------------- แจ้งเตือน (พอร์ตจาก modbus_service/alert_engine.py)
@dataclass
class _AlertState:
    started_at: datetime
    triggered: bool = False
    event_id: int | None = None


class AlertEngine:
    def __init__(self) -> None:
        self._states: dict[tuple[str, str], _AlertState] = {}
        self.rules: dict[tuple[str, str], dict] = {}

    def check(self, device: str, metric: str, value: float, now: datetime) -> list[dict]:
        rule = self.rules.get((device, metric))
        if not rule:
            return []
        key = (device, metric)
        lo, hi = rule.get("threshold_min"), rule.get("threshold_max")
        out = (lo is not None and value < lo) or (hi is not None and value > hi)
        actions: list[dict] = []
        if out:
            state = self._states.setdefault(key, _AlertState(started_at=now))
            if not state.triggered and (now - state.started_at).total_seconds() >= (rule.get("sustained_seconds") or 0):
                state.triggered = True
                actions.append({
                    "action": "create_event", "rule": rule, "device_name": device, "metric_name": metric,
                    "started_at": state.started_at, "triggered_at": now, "trigger_value": value,
                })
        elif key in self._states:
            state = self._states.pop(key)
            if state.triggered and state.event_id is not None:
                actions.append({"action": "end_event", "event_id": state.event_id, "ended_at": now})
        return actions

    def set_event_id(self, device: str, metric: str, event_id: int | None) -> None:
        if (device, metric) in self._states:
            self._states[(device, metric)].event_id = event_id


# ----------------------------------------------------------------- รวมค่ารายนาที (พอร์ตจาก modbus_service/buffer.py)
@dataclass
class _Sample:
    raw: Any
    value: float
    status: str
    config_id: int | None
    decimal_places: int | None


def aggregate(bucket: datetime, key: tuple[str, str], samples: list[_Sample]) -> dict:
    values = [s.value for s in samples]
    raws = [s.raw for s in samples]
    dp = samples[-1].decimal_places if samples[-1].decimal_places is not None else 2
    numeric = all(isinstance(r, (int, float)) and not isinstance(r, bool) for r in raws)
    raw_avg = sum(raws) / len(raws) if numeric else 0.0
    return {
        "time": bucket,
        "device_name": key[0],
        "metric_name": key[1],
        "avg_value": round(sum(values) / len(values), dp),
        "min_value": round(min(values), dp),
        "max_value": round(max(values), dp),
        "raw_avg": round(raw_avg, dp),
        "raw_min": min(raws) if numeric else 0,
        "raw_max": max(raws) if numeric else 0,
        "sample_count": len(samples),
        "config_id": samples[-1].config_id,
        "status": samples[-1].status,
    }


# ----------------------------------------------------------------- service
@dataclass
class _Latest:
    raw: Any = None
    value: float | None = None
    status: str = ""
    at: float = 0.0
    error: str | None = None  # no_config / field_missing / not_number


@dataclass
class _Mapping:
    device_name: str
    metric_name: str
    topic: str
    field: str


@dataclass
class _State:
    broker: Broker | None = None
    enabled: bool = False
    by_topic: dict[str, list[_Mapping]] = field(default_factory=dict)
    configs: dict[tuple[str, str], dict] = field(default_factory=dict)


class PwMqttIngest:
    def __init__(self) -> None:
        self.st = _State()
        self.feeds: set[tuple[Broker, str]] = set()
        self.latest: dict[tuple[str, str], _Latest] = {}
        self.alerts = AlertEngine()
        self._bucket: datetime | None = None
        self._samples: dict[tuple[str, str], list[_Sample]] = {}
        self._tasks: list[asyncio.Task] = []
        self._lock = asyncio.Lock()
        self._alert_queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=10_000)
        self.last_message_at: float = 0.0
        self.running = False

    # ------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        await self.reload()
        self._tasks = [
            asyncio.create_task(self._tick_loop(), name="pw-mqtt-tick"),
            asyncio.create_task(self._reload_loop(), name="pw-mqtt-reload"),
            asyncio.create_task(self._alert_loop(), name="pw-mqtt-alerts"),
        ]
        self.running = True
        log.info("purified water MQTT ingest started")

    async def stop(self) -> None:
        self.running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        for b, topic in list(self.feeds):
            await hub.unsubscribe(b, topic, self.on_message)
        self.feeds = set()

    # ------------------------------------------------------------ config
    async def reload(self) -> None:
        """โหลด broker / mapping / sensor config / กฎแจ้งเตือนจากฐานข้อมูล แล้วปรับ subscription"""
        async with self._lock:
            async with AsyncSessionLocal() as db:
                broker_row = await db.get(PwMqttBroker, 1)
                mappings = (await db.execute(select(PwMqttMapping).where(PwMqttMapping.enabled.is_(True)))).scalars().all()
                configs = (await db.execute(select(SensorConfig).where(SensorConfig.is_active.is_(True)))).scalars().all()
                rules = (await db.execute(select(AlertRule).where(AlertRule.is_active.is_(True)))).scalars().all()

            broker = None
            enabled = bool(broker_row and broker_row.enabled and broker_row.url)
            if enabled:
                broker = Broker(broker_row.url, broker_row.username or "", broker_row.password or "")
            by_topic: dict[str, list[_Mapping]] = {}
            for m in mappings:
                if m.topic:
                    by_topic.setdefault(m.topic, []).append(_Mapping(m.device_name, m.metric_name, m.topic, m.field or ""))
            self.st = _State(
                broker=broker,
                enabled=enabled,
                by_topic=by_topic,
                configs={
                    (c.device_name, c.metric_name): {
                        "id": c.id, "decode_type": c.decode_type, "raw_min": c.raw_min, "raw_max": c.raw_max,
                        "range_min": c.range_min, "range_max": c.range_max, "decimal_places": c.decimal_places,
                    }
                    for c in configs
                },
            )
            self.alerts.rules = {
                (r.device_name, r.metric_name): {
                    "id": r.id, "threshold_min": r.threshold_min, "threshold_max": r.threshold_max,
                    "sustained_seconds": r.sustained_seconds or 0, "severity": r.severity or "warning",
                    "save_alarm": True if r.save_alarm is None else bool(r.save_alarm),
                }
                for r in rules
            }

            want = {(broker, t) for t in by_topic} if broker else set()
            for b, topic in self.feeds - want:
                await hub.unsubscribe(b, topic, self.on_message)
            for b, topic in want - self.feeds:
                await hub.subscribe(b, topic, self.on_message)
            changed = want != self.feeds
            self.feeds = want
            mapped = {(m.device_name, m.metric_name) for ms in by_topic.values() for m in ms}
            for key in list(self.latest):
                if key not in mapped:
                    del self.latest[key]
        if changed:
            log.info("purified water MQTT: %s, %d topic(s), %d sensor(s)",
                     broker.key if broker else "disabled", len(want), sum(len(v) for v in by_topic.values()))

    async def _reload_loop(self) -> None:
        while True:
            await asyncio.sleep(RELOAD_SEC)
            try:
                await self.reload()
            except Exception:
                log.exception("reload failed")

    # ------------------------------------------------------------ messages
    async def on_message(self, broker_key: str, topic: str, data: Any, at: float) -> None:
        st = self.st
        if not st.broker or broker_key != st.broker.key:
            return
        self.last_message_at = at
        now = datetime.fromtimestamp(at, tz=timezone.utc)
        for m in st.by_topic.get(topic, ()):
            key = (m.device_name, m.metric_name)
            latest = self.latest.setdefault(key, _Latest())
            raw = read_field(data, m.field)
            if raw is None:
                latest.error, latest.at = "field_missing", at
                continue
            cfg = st.configs.get(key)
            if cfg is None:
                latest.raw, latest.error, latest.at = raw, "no_config", at
                continue
            conv = convert(raw, cfg)
            if conv is None:
                latest.raw, latest.error, latest.at = raw, "not_number", at
                continue
            latest.raw, latest.value, latest.status, latest.at, latest.error = conv.raw, conv.value, conv.status, at, None
            self._add_sample(now, key, _Sample(conv.raw, conv.value, conv.status, cfg["id"], cfg.get("decimal_places")))
            for action in self.alerts.check(m.device_name, m.metric_name, conv.value, now):
                try:
                    self._alert_queue.put_nowait(action)
                except asyncio.QueueFull:
                    log.warning("alert queue full — dropped %s", action.get("action"))

    def _add_sample(self, now: datetime, key: tuple[str, str], sample: _Sample) -> None:
        bucket = datetime.fromtimestamp(int(now.timestamp()) // AGGREGATE_SEC * AGGREGATE_SEC, tz=timezone.utc)
        if self._bucket is not None and bucket != self._bucket:
            self._flush_soon()
        if self._bucket is None or bucket != self._bucket:
            self._bucket = bucket
        self._samples.setdefault(key, []).append(sample)

    def _flush_soon(self) -> None:
        bucket, samples = self._bucket, self._samples
        self._samples = {}
        self._bucket = None
        if bucket and samples:
            asyncio.create_task(self._flush(bucket, samples), name="pw-mqtt-flush")

    async def _flush(self, bucket: datetime, samples: dict[tuple[str, str], list[_Sample]]) -> None:
        from app.api.routes.ingest import AggregatedReading, IngestPayload, ingest_sensor_data

        readings = [AggregatedReading(**aggregate(bucket, key, s)) for key, s in samples.items() if s]
        if not readings:
            return
        try:
            async with AsyncSessionLocal() as db:
                await ingest_sensor_data(IngestPayload(readings=readings), db)
            log.debug("flushed %d aggregated readings for %s", len(readings), bucket.isoformat())
        except Exception as exc:
            log.error("cannot save %d aggregated readings for %s: %s", len(readings), bucket.isoformat(), exc)

    # ------------------------------------------------------------ aggregate tick
    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_SEC)
            try:
                # ปิดนาทีที่ผ่านไปแล้วแม้ไม่มีข้อความใหม่เข้ามา
                if self._bucket is not None and time.time() - self._bucket.timestamp() >= AGGREGATE_SEC:
                    self._flush_soon()
            except Exception:
                log.exception("tick failed")

    # ------------------------------------------------------------ alert events
    async def _alert_loop(self) -> None:
        from app.api.routes.alerts import AlertEventCreate, AlertEventEnd, create_alert_event, end_alert_event

        while True:
            action = await self._alert_queue.get()
            try:
                async with AsyncSessionLocal() as db:
                    if action["action"] == "create_event":
                        rule = action["rule"]
                        if not rule.get("save_alarm", True):
                            continue
                        tasks = BackgroundTasks()
                        event = await create_alert_event(
                            AlertEventCreate(
                                alert_rule_id=rule["id"], device_name=action["device_name"], metric_name=action["metric_name"],
                                started_at=action["started_at"], triggered_at=action["triggered_at"],
                                trigger_value=action["trigger_value"], severity=rule.get("severity"),
                            ),
                            tasks,
                            db,
                        )
                        self.alerts.set_event_id(action["device_name"], action["metric_name"], getattr(event, "id", None))
                        await tasks()  # ส่ง LINE / Email (เหมือนตอนตัวอ่าน Modbus เรียก POST /api/alerts/events)
                    elif action["action"] == "end_event":
                        await end_alert_event(action["event_id"], AlertEventEnd(ended_at=action["ended_at"]), db)
            except Exception:
                log.exception("alert action %s failed", action.get("action"))

    # ------------------------------------------------------------ status (หน้า settings)
    def status(self) -> dict:
        st = self.st
        now = time.time()
        sensors = {}
        for (device, metric), v in self.latest.items():
            sensors[f"{device}/{metric}"] = {
                "raw": v.raw, "value": v.value, "status": v.status, "error": v.error,
                "ageMs": int((now - v.at) * 1000) if v.at else None,
            }
        conn = None
        if st.broker:
            conn = next((c for c in hub.status() if c["broker"] == st.broker.key), None)
        return {
            "enabled": st.enabled,
            "running": self.running,
            "connected": bool(st.broker and hub.is_connected(st.broker)),
            "error": conn.get("error") if conn else None,
            "topics": sorted(st.by_topic),
            "lastMessageAgeMs": int((now - self.last_message_at) * 1000) if self.last_message_at else None,
            "sensors": sensors,
        }


ingest = PwMqttIngest()
