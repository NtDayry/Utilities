"""/ws/utilities/mqtt — ส่งข้อมูล MQTT สดให้หน้าเว็บ (ใช้แทน Vite MQTT bridge ตอน production)

ข้อความจากเบราว์เซอร์ (JSON):
  {"type": "subscribe",   "topic": "...", "systemId": "..."?}   systemId = ใช้ broker ของระบบนั้น, ไม่ใส่ = broker พื้นฐาน
                                                               systemId "__purified_water__" = broker ของ Purified Water (เฉพาะ topic ที่ตั้งไว้)
                                                               systemId "__water_supply__"   = บ่อประปา + ปั๊ม (topic / broker ที่ตั้งในหน้าเว็บ)
  {"type": "unsubscribe", "topic": "...", "systemId": "..."?}
  {"type": "publish", "id": "...", "topic": "<base>/set", "payload": {...}, "systemId": "..."?}   (admin เท่านั้น)
  {"type": "ping"}

ข้อความจาก server:
  {"type": "hello", "username", "isAdmin"}
  {"type": "status", "topic", "systemId", "connected"}
  {"type": "msg", "topic", "systemId", "data", "at", "ageMs"?}  at = epoch ms (เวลาเซิร์ฟเวอร์), ageMs = อายุของข้อความที่เก็บไว้
  {"type": "publish-ack", "id", "ok", "error"?}
  {"type": "alarm", "action": "raised|cleared|acknowledged", "event": {...}}
  {"type": "error", "error": "..."}
"""
import asyncio
import contextlib
import logging
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.utilities.auth import websocket_user
from app.utilities.config import settings
from app.utilities.mqtt.hub import Broker, default_broker, hub, resolve_broker
from app.utilities.services.alarms import engine
from app.utilities.services.ingest import ingestor
from app.utilities.water.model import is_valid_topic
from app.purified_water.mqtt_ingest import PW_SYSTEM_ID, ingest as pw_ingest
from app.utilities.water.supply_source import SYSTEM_ID as SUPPLY_SYSTEM_ID, source as supply_source

log = logging.getLogger("utilities.ws")
router = APIRouter()

QUEUE_SIZE = 500


@router.websocket(f"{settings.WS_PREFIX}/mqtt")
async def mqtt_ws(ws: WebSocket) -> None:
    user = await websocket_user(ws)
    if user is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
    subs: dict[tuple[Broker, str, str | None], tuple[Any, Any]] = {}

    def send(msg: dict) -> None:
        try:
            queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass  # เบราว์เซอร์รับไม่ทัน — ข้ามข้อความ (ข้อความใหม่จะตามมาเอง)

    def on_alarm(m: dict) -> None:
        send({"type": "alarm", **m})

    engine.listeners.add(on_alarm)

    async def sender() -> None:
        while True:
            await ws.send_json(await queue.get())

    def broker_for(system_id: str | None) -> Broker | None:
        if not system_id:
            return default_broker()
        if system_id == PW_SYSTEM_ID:
            return pw_ingest.st.broker
        if system_id == SUPPLY_SYSTEM_ID:
            return supply_source.broker()
        cfg = ingestor.systems.get(system_id)
        return resolve_broker(cfg.get("broker")) if cfg else None

    async def subscribe(topic: str, system_id: str | None) -> None:
        if system_id == SUPPLY_SYSTEM_ID and topic not in supply_source.topics():
            return send({"type": "error", "error": "topic_not_allowed", "topic": topic, "systemId": system_id})
        if system_id == PW_SYSTEM_ID and topic not in pw_ingest.st.by_topic:
            # Purified Water: เปิดให้ฟังเฉพาะ topic ที่ตั้งไว้ในหน้า purified-water/settings
            return send({"type": "error", "error": "topic_not_allowed", "topic": topic, "systemId": system_id})
        broker = broker_for(system_id)
        if broker is None:
            return send({"type": "error", "error": "unknown_system", "systemId": system_id})
        key = (broker, topic, system_id)
        if key in subs:
            return
        async def listener(_bk: str, t: str, data: Any, at: float) -> None:
            send({"type": "msg", "topic": t, "systemId": system_id, "data": data, "at": int(at * 1000)})
        await hub.subscribe(broker, topic, listener)
        unwatch = hub.watch_status(broker, lambda ok: send({"type": "status", "topic": topic, "systemId": system_id, "connected": ok}))
        subs[key] = (listener, unwatch)
        send({"type": "status", "topic": topic, "systemId": system_id, "connected": hub.is_connected(broker)})
        last = hub.latest(broker, topic)
        if last:
            # ข้อความล่าสุดที่เก็บไว้: ส่งอายุของข้อความด้วย (เบราว์เซอร์ใช้คำนวณ "ข้อมูลค้าง" โดยไม่ขึ้นกับนาฬิกาของเซิร์ฟเวอร์)
            age_ms = max(0, int((time.time() - last[1]) * 1000))
            send({"type": "msg", "topic": topic, "systemId": system_id, "data": last[0], "at": int(last[1] * 1000), "ageMs": age_ms})

    async def unsubscribe(topic: str, system_id: str | None) -> None:
        for key in [k for k in subs if k[1] == topic and k[2] == system_id]:
            listener, unwatch = subs.pop(key)
            unwatch()
            await hub.unsubscribe(key[0], topic, listener)

    async def publish(msg: dict) -> None:
        mid = msg.get("id")
        topic = msg.get("topic")
        payload = msg.get("payload")
        system_id = msg.get("systemId") or None
        if not user.is_admin:
            return send({"type": "publish-ack", "id": mid, "ok": False, "error": "forbidden"})
        if not isinstance(topic, str) or not topic.endswith("/set") or not isinstance(payload, dict):
            return send({"type": "publish-ack", "id": mid, "ok": False, "error": "invalid_payload"})
        base = topic[: -len("/set")]
        if not system_id:
            allowed = base in settings.control_topics
        elif system_id == SUPPLY_SYSTEM_ID:
            allowed = base == supply_source.topic
        else:
            allowed = (ingestor.systems.get(system_id) or {}).get("topic") == base
        if not allowed:
            return send({"type": "publish-ack", "id": mid, "ok": False, "error": "topic_not_allowed"})
        broker = broker_for(system_id)
        try:
            await hub.publish(broker, topic, payload)
            log.info("publish by %s → %s %s", user.username, topic, payload)
            send({"type": "publish-ack", "id": mid, "ok": True})
        except Exception as exc:
            send({"type": "publish-ack", "id": mid, "ok": False, "error": str(exc)})

    send_task = asyncio.create_task(sender())
    send({"type": "hello", "username": user.username, "isAdmin": user.is_admin})
    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            topic = msg.get("topic")
            system_id = msg.get("systemId") or None
            if kind in ("subscribe", "unsubscribe"):
                if not isinstance(topic, str) or not is_valid_topic(topic):
                    send({"type": "error", "error": "topic_invalid", "topic": topic})
                elif kind == "subscribe":
                    if len(subs) >= 50:
                        send({"type": "error", "error": "too_many_subscriptions"})
                    else:
                        await subscribe(topic, system_id)
                else:
                    await unsubscribe(topic, system_id)
            elif kind == "publish":
                await publish(msg)
            elif kind == "ping":
                send({"type": "pong"})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        engine.listeners.discard(on_alarm)
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await send_task
        for (broker, topic, _sid), (listener, unwatch) in list(subs.items()):
            unwatch()
            await hub.unsubscribe(broker, topic, listener)
