"""ศูนย์กลางการเชื่อมต่อ MQTT ของ service

- 1 การเชื่อมต่อต่อ broker (ใช้ร่วมกันทั้งการบันทึกข้อมูลและ WebSocket ของหน้าเว็บ)
- subscribe ตามจำนวนผู้ฟัง: topic แรกที่มีผู้ฟัง → subscribe, ผู้ฟังคนสุดท้ายออก → unsubscribe
- หลุดแล้วต่อใหม่เอง + subscribe ทุก topic ที่ยังมีผู้ฟังอีกครั้ง
- เก็บข้อความล่าสุดของแต่ละ topic (ส่งให้ผู้ฟังใหม่ทันที)
"""
from __future__ import annotations

import asyncio
import json
import logging
import ssl
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import aiomqtt

from app.utilities.config import settings

log = logging.getLogger("utilities.mqtt")

# callback(broker_key, topic, data, at_epoch)
Listener = Callable[[str, str, Any, float], Awaitable[None] | None]


@dataclass(frozen=True)
class Broker:
    url: str
    username: str = ""
    password: str = ""

    @property
    def key(self) -> str:
        """ระบุ broker โดยไม่มีรหัสผ่าน (ใช้เก็บลงฐานข้อมูล / แสดงผลได้)"""
        return f"{self.url}|{self.username}"


def default_broker() -> Broker:
    return Broker(settings.DEFAULT_MQTT_URL, settings.DEFAULT_MQTT_USERNAME, settings.DEFAULT_MQTT_PASSWORD)


def resolve_broker(cfg: dict | None) -> Broker:
    """broker ของระบบน้ำ (None/url ว่าง = broker พื้นฐาน) — รูปแบบเดียวกับ resolveBroker() ของ frontend"""
    if cfg and cfg.get("url"):
        return Broker(cfg["url"], cfg.get("username") or "", cfg.get("password") or "")
    return default_broker()


def client_kwargs(b: Broker) -> dict:
    """แปลง URL (mqtt:// mqtts:// ws:// wss:// tcp://) เป็นพารามิเตอร์ของ aiomqtt.Client"""
    u = urlsplit(b.url)
    scheme = (u.scheme or "mqtt").lower()
    if scheme not in ("mqtt", "tcp", "mqtts", "ssl", "ws", "wss"):
        raise ValueError(f"unsupported broker url scheme: {scheme}")
    secure = scheme in ("mqtts", "ssl", "wss")
    websockets = scheme in ("ws", "wss")
    port = u.port or (443 if scheme == "wss" else 80 if scheme == "ws" else 8883 if secure else 1883)
    kw: dict[str, Any] = {
        "hostname": u.hostname or "localhost",
        "port": port,
        "username": b.username or None,
        "password": b.password or None,
        "keepalive": 30,
        "timeout": 10,
    }
    if websockets:
        kw["transport"] = "websockets"
        kw["websocket_path"] = u.path or "/"
    if secure:
        ctx = ssl.create_default_context()
        # broker ในโรงงานมักใช้ self-signed certificate
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kw["tls_context"] = ctx
    return kw


@dataclass
class _Conn:
    broker: Broker
    topics: dict[str, set[Listener]] = field(default_factory=dict)
    latest: dict[str, tuple[Any, float]] = field(default_factory=dict)
    client: aiomqtt.Client | None = None
    connected: bool = False
    error: str | None = None
    task: asyncio.Task | None = None
    status_listeners: set[Callable[[bool], None]] = field(default_factory=set)


class MqttHub:
    def __init__(self) -> None:
        self._conns: dict[Broker, _Conn] = {}
        self._lock = asyncio.Lock()
        self._closing = False

    # ------------------------------------------------------------ public
    async def subscribe(self, broker: Broker, topic: str, listener: Listener) -> None:
        async with self._lock:
            conn = self._conns.get(broker)
            if conn is None:
                conn = _Conn(broker)
                self._conns[broker] = conn
                conn.task = asyncio.create_task(self._run(conn), name=f"mqtt:{broker.key}")
            listeners = conn.topics.setdefault(topic, set())
            first = not listeners
            listeners.add(listener)
            client = conn.client if conn.connected else None
        if first and client is not None:
            try:
                await client.subscribe(topic, qos=1)
            except aiomqtt.MqttError as exc:
                log.warning("[%s] subscribe %s failed: %s", broker.key, topic, exc)

    async def unsubscribe(self, broker: Broker, topic: str, listener: Listener) -> None:
        async with self._lock:
            conn = self._conns.get(broker)
            if conn is None or topic not in conn.topics:
                return
            conn.topics[topic].discard(listener)
            client = None
            if not conn.topics[topic]:
                del conn.topics[topic]
                conn.latest.pop(topic, None)
                client = conn.client if conn.connected else None
            stop = not conn.topics and not conn.status_listeners
            if stop:
                del self._conns[broker]
        if client is not None:
            try:
                await client.unsubscribe(topic)
            except aiomqtt.MqttError:
                pass
        if stop and conn.task:
            conn.task.cancel()

    def latest(self, broker: Broker, topic: str) -> tuple[Any, float] | None:
        conn = self._conns.get(broker)
        return conn.latest.get(topic) if conn else None

    def is_connected(self, broker: Broker) -> bool:
        conn = self._conns.get(broker)
        return bool(conn and conn.connected)

    def watch_status(self, broker: Broker, fn: Callable[[bool], None]) -> Callable[[], None]:
        conn = self._conns.get(broker)
        if conn is None:
            return lambda: None
        conn.status_listeners.add(fn)
        return lambda: conn.status_listeners.discard(fn)

    async def publish(self, broker: Broker, topic: str, payload: Any, qos: int = 1) -> None:
        conn = self._conns.get(broker)
        if conn is None or not conn.connected or conn.client is None:
            raise RuntimeError("broker_not_connected")
        data = payload if isinstance(payload, (str, bytes)) else json.dumps(payload, ensure_ascii=False)
        await conn.client.publish(topic, data, qos=qos)

    def status(self) -> list[dict]:
        return [
            {"broker": c.broker.key, "connected": c.connected, "error": c.error, "topics": sorted(c.topics)}
            for c in self._conns.values()
        ]

    async def close(self) -> None:
        self._closing = True
        tasks = [c.task for c in self._conns.values() if c.task]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._conns.clear()

    # ------------------------------------------------------------ internals
    def _set_connected(self, conn: _Conn, ok: bool, error: str | None = None) -> None:
        changed = conn.connected != ok
        conn.connected = ok
        conn.error = error
        if changed:
            for fn in list(conn.status_listeners):
                try:
                    fn(ok)
                except Exception:
                    log.exception("status listener failed")

    async def _run(self, conn: _Conn) -> None:
        try:
            kwargs = client_kwargs(conn.broker)
        except ValueError as exc:
            self._set_connected(conn, False, str(exc))
            log.error("[%s] %s", conn.broker.key, exc)
            return
        ident = f"{settings.MQTT_CLIENT_PREFIX}-{uuid.uuid4().hex[:8]}"
        while not self._closing:
            try:
                async with aiomqtt.Client(identifier=ident, **kwargs) as client:
                    conn.client = client
                    for topic in list(conn.topics):
                        await client.subscribe(topic, qos=1)
                    self._set_connected(conn, True)
                    log.info("[%s] connected, %d topic(s)", conn.broker.key, len(conn.topics))
                    async for message in client.messages:
                        await self._dispatch(conn, message)
            except asyncio.CancelledError:
                break
            except Exception as exc:  # MqttError, OSError, ...
                self._set_connected(conn, False, str(exc) or exc.__class__.__name__)
                log.warning("[%s] disconnected: %s — retry in %.0fs", conn.broker.key, exc, settings.MQTT_RECONNECT_SEC)
            finally:
                conn.client = None
                if conn.connected:
                    self._set_connected(conn, False, conn.error)
            try:
                await asyncio.sleep(settings.MQTT_RECONNECT_SEC)
            except asyncio.CancelledError:
                break

    async def _dispatch(self, conn: _Conn, message: aiomqtt.Message) -> None:
        topic = str(message.topic)
        try:
            raw = message.payload.decode("utf-8") if isinstance(message.payload, (bytes, bytearray)) else message.payload
        except UnicodeDecodeError:
            return
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            data = raw.strip() if isinstance(raw, str) else None
        # ค่าเดี่ยว (ตัวเลข / ข้อความ / array) → {"value": ...} — อุปกรณ์ที่ส่ง 1 ค่าต่อ topic (Purified Water)
        if not isinstance(data, dict):
            if data is None or data == "":
                return
            data = {"value": data}
        at = time.time()
        listeners = conn.topics.get(topic)
        if not listeners:
            return
        conn.latest[topic] = (data, at)
        for fn in list(listeners):
            try:
                res = fn(conn.broker.key, topic, data, at)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                log.exception("listener failed for %s", topic)


hub = MqttHub()
