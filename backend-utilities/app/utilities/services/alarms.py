"""แจ้งเตือนของถังน้ำ / บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ (ประเมินฝั่ง server ทุกข้อความ MQTT)

- ระดับน้ำ (% ความจุรวม) ต่ำกว่า lowPct → L, สูงกว่า highPct → H (มี deadband กันกระพริบ)
- ปั๊มขัดข้อง (alarm / fault / overload / trip / faultPath) → STATE critical
- ไม่มีข้อความเกิน COMM_TIMEOUT_SEC → COMM

เขียนลงตาราง alarm_events ตามโครงสร้าง UtilityAlarmEvent ของ frontend และแจ้งผู้ฟัง (WebSocket) ทันที
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from app.utilities.config import settings
from app.utilities.db import pool

log = logging.getLogger("utilities.alarms")

GROUP_PREFIX = "water-system:"


def _ts(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


def event_row_to_dict(r: Any) -> dict:
    """แถวจากฐานข้อมูล → รูปแบบ UtilityAlarmEvent ของ frontend"""
    started, ended = r["started_at"], r["ended_at"]
    return {
        "id": r["id"],
        "system": r["system"],
        "groupId": r["group_id"],
        "sensorKey": r["sensor_key"],
        "deviceName": r["device_name"],
        "metricName": r["metric_name"],
        "deviceTh": r["device_th"],
        "deviceEn": r["device_en"],
        "th": r["th"],
        "en": r["en"],
        "unit": r["unit"],
        "dp": r["dp"],
        "level": r["level"],
        "severity": r["severity"],
        "value": r["value"],
        "limit": r["limit_value"],
        "startedAt": started.isoformat(),
        "endedAt": ended.isoformat() if ended else None,
        "durationSec": int((ended - started).total_seconds()) if ended else None,
        "acknowledged": r["acknowledged"],
        "ackBy": r["ack_by"],
        "ackAt": r["ack_at"].isoformat() if r["ack_at"] else None,
    }


class WaterAlarmEngine:
    def __init__(self) -> None:
        # (system_id, metric, level) → event id ที่ยังไม่จบ
        self.active: dict[tuple[str, str, str], str] = {}
        self.listeners: set[Callable[[dict], None]] = set()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._started = time.time()

    async def start(self) -> None:
        rows = await pool().fetch(
            "SELECT id, device_name, metric_name, level FROM alarm_events WHERE ended_at IS NULL AND group_id LIKE $1",
            GROUP_PREFIX + "%",
        )
        for r in rows:
            self.active[(r["device_name"], r["metric_name"], r["level"])] = r["id"]
        self._started = time.time()
        self._worker = asyncio.create_task(self._write_loop(), name="alarm-writer")
        log.info("alarm engine started, %d active alarm(s) restored", len(self.active))

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)

    # ------------------------------------------------------------ evaluate
    def evaluate(self, cfg: dict, metrics: dict[str, float], at: float) -> None:
        sid = cfg["id"]
        # มีข้อความเข้า = สื่อสารได้
        self._clear(sid, "comm", "COMM", at, None)

        pct = metrics.get("level_pct")
        if pct is not None:
            db = settings.ALARM_LEVEL_DEADBAND_PCT
            low, high = float(cfg["lowPct"]), float(cfg["highPct"])
            if pct < low:
                self._raise(cfg, "level_pct", "L", "warning", pct, low, at, "ระดับน้ำต่ำ", "Low water level", "%", 1)
            elif pct >= low + db:
                self._clear(sid, "level_pct", "L", at, pct)
            if pct > high:
                self._raise(cfg, "level_pct", "H", "warning", pct, high, at, "ระดับน้ำสูง", "High water level", "%", 1)
            elif pct <= high - db:
                self._clear(sid, "level_pct", "H", at, pct)

        for i, pump in enumerate(cfg["pumps"], start=1):
            fault = metrics.get(f"pump{i}_fault")
            if fault is None:
                continue
            metric = f"pump{i}_fault"
            if fault >= 1:
                self._raise(cfg, metric, "STATE", "critical", 1, None, at, f"{pump['name']} ขัดข้อง", f"{pump['name']} fault", "", 0)
            else:
                self._clear(sid, metric, "STATE", at, 0)

    def check_comm(self, systems: dict[str, dict], last_msg: dict[str, float], now: float) -> None:
        timeout = settings.COMM_TIMEOUT_SEC
        if now - self._started < timeout:
            return  # เพิ่งเริ่ม — ให้เวลาเชื่อมต่อก่อน
        for sid, cfg in systems.items():
            if not cfg.get("topic"):
                continue
            last = last_msg.get(sid, self._started)
            if now - last > timeout:
                self._raise(cfg, "comm", "COMM", "warning", None, timeout, now, "ขาดการสื่อสาร", "Communication lost", "s", 0, started=last)

    def close_system(self, system_id: str, at: float) -> None:
        """ระบบถูกลบ → ปิด alarm ที่ค้างอยู่ทั้งหมดของระบบนั้น"""
        for key in [k for k in self.active if k[0] == system_id]:
            self._clear(*key, at, None)

    # ------------------------------------------------------------ state changes
    def _raise(self, cfg: dict, metric: str, level: str, severity: str, value: float | None, limit: float | None,
               at: float, th: str, en: str, unit: str, dp: int, started: float | None = None) -> None:
        key = (cfg["id"], metric, level)
        if key in self.active:
            return
        ev = {
            "id": uuid.uuid4().hex,
            "system": "water",
            "groupId": GROUP_PREFIX + cfg["id"],
            "sensorKey": f"{cfg['id']}.{metric}",
            "deviceName": cfg["id"],
            "metricName": metric,
            "deviceTh": cfg["name"],
            "deviceEn": cfg["name"],
            "th": th,
            "en": en,
            "unit": unit,
            "dp": dp,
            "level": level,
            "severity": severity,
            "value": value,
            "limit": limit,
            "startedAt": _ts(started or at).isoformat(),
            "endedAt": None,
            "durationSec": None,
            "acknowledged": False,
            "ackBy": None,
            "ackAt": None,
        }
        self.active[key] = ev["id"]
        log.info("ALARM %s %s %s value=%s limit=%s", cfg["id"], metric, level, value, limit)
        self._queue.put_nowait(("raise", ev))

    def _clear(self, sid: str, metric: str, level: str, at: float, value: float | None) -> None:
        ev_id = self.active.pop((sid, metric, level), None)
        if ev_id is None:
            return
        log.info("CLEAR %s %s %s", sid, metric, level)
        self._queue.put_nowait(("clear", {"id": ev_id, "endedAt": _ts(at)}))

    # ------------------------------------------------------------ persistence
    async def _write_loop(self) -> None:
        while True:
            op, ev = await self._queue.get()
            try:
                if op == "raise":
                    await pool().execute(
                        """INSERT INTO alarm_events (id, system, group_id, sensor_key, device_name, metric_name, device_th, device_en,
                               th, en, unit, dp, level, severity, value, limit_value, started_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)""",
                        ev["id"], ev["system"], ev["groupId"], ev["sensorKey"], ev["deviceName"], ev["metricName"], ev["deviceTh"],
                        ev["deviceEn"], ev["th"], ev["en"], ev["unit"], ev["dp"], ev["level"], ev["severity"], ev["value"],
                        ev["limit"], datetime.fromisoformat(ev["startedAt"]),
                    )
                    self._notify({"action": "raised", "event": ev})
                else:
                    row = await pool().fetchrow(
                        "UPDATE alarm_events SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL RETURNING *", ev["id"], ev["endedAt"]
                    )
                    if row:
                        self._notify({"action": "cleared", "event": event_row_to_dict(row)})
            except Exception:
                log.exception("cannot write alarm event")

    def _notify(self, msg: dict) -> None:
        for fn in list(self.listeners):
            try:
                fn(msg)
            except Exception:
                log.exception("alarm listener failed")


engine = WaterAlarmEngine()
