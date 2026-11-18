"""/api/purified-water/mqtt — ตั้งค่าแหล่งข้อมูล MQTT ของ Purified Water (หน้า purified-water/settings)

GET  /config     broker (รหัสผ่านปิดบัง) + mapping ทุกเซนเซอร์
PUT  /broker     บันทึก broker (รหัสผ่าน "********" = ใช้รหัสผ่านเดิม)
PUT  /mappings   บันทึก mapping หลายเซนเซอร์ (topic ว่าง = ลบ)
POST /probe      ต่อ broker → รอข้อความแรกของ topic → คืน payload + field ที่เลือกได้
GET  /status     สถานะการเชื่อมต่อ + ค่าล่าสุดของแต่ละเซนเซอร์
GET  /sources    (ผู้ใช้ที่ login) topic + field ของแต่ละเซนเซอร์ — หน้าเว็บใช้ subscribe ค่าสดผ่าน /ws/utilities/mqtt
สิทธิ์: page:device (เท่ากับการแก้ sensor config ในหน้าเดียวกัน) ยกเว้น /sources
"""
from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
from typing import Any

import aiomqtt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import get_current_user, get_db, require_roles
from app.core.audit_log import create_audit_log
from app.db.models.pw_mqtt_model import PwMqttBroker, PwMqttMapping
from app.db.models.sensor_model import SensorConfig
from app.purified_water.mqtt_ingest import PW_SYSTEM_ID, convert, ingest
from app.utilities.config import settings as utilities_settings
from app.utilities.mqtt.hub import Broker, client_kwargs
from app.utilities.water.model import is_valid_topic

router = APIRouter(prefix="/purified-water/mqtt", tags=["purified-water"])

PASSWORD_MASK = "********"
PERMISSION = "page:device"


class BrokerIn(BaseModel):
    url: str = Field("", max_length=255)
    username: str = Field("", max_length=100)
    password: str = Field("", max_length=255)
    enabled: bool = True


class MappingIn(BaseModel):
    device_name: str = Field(..., min_length=1, max_length=50)
    metric_name: str = Field(..., min_length=1, max_length=50)
    topic: str = Field("", max_length=255)
    field: str = Field("", max_length=255)
    enabled: bool = True


class ProbeIn(BaseModel):
    topic: str
    timeout_sec: float = Field(10, ge=1, le=30)
    broker: BrokerIn | None = None  # ทดสอบก่อนบันทึก ; ไม่ส่ง = ใช้ broker ที่บันทึกไว้


def _broker_out(row: PwMqttBroker | None) -> dict:
    if row is None:
        return {"url": "", "username": "", "password": "", "enabled": False}
    return {"url": row.url, "username": row.username, "password": PASSWORD_MASK if row.password else "", "enabled": row.enabled}


def _check_url(url: str) -> None:
    try:
        client_kwargs(Broker(url))
    except ValueError as exc:
        raise HTTPException(422, detail={"errors": {"url": str(exc)}}) from exc


@router.get("/config")
async def get_config(db: AsyncSession = Depends(get_db), _=Depends(require_roles(PERMISSION))) -> dict:
    row = await db.get(PwMqttBroker, 1)
    mappings = (await db.execute(select(PwMqttMapping).order_by(PwMqttMapping.device_name, PwMqttMapping.metric_name))).scalars().all()
    return {
        "broker": _broker_out(row),
        "mappings": [
            {"device_name": m.device_name, "metric_name": m.metric_name, "topic": m.topic, "field": m.field, "enabled": m.enabled}
            for m in mappings
        ],
    }


@router.put("/broker")
async def put_broker(body: BrokerIn, request: Request, db: AsyncSession = Depends(get_db), user=Depends(require_roles(PERMISSION))) -> dict:
    url = body.url.strip()
    if url:
        _check_url(url)
    elif body.enabled:
        raise HTTPException(422, detail={"errors": {"url": "required"}})
    row = await db.get(PwMqttBroker, 1)
    old = _broker_out(row)
    if row is None:
        row = PwMqttBroker(id=1)
        db.add(row)
    password = (row.password or "") if body.password == PASSWORD_MASK else body.password
    row.url, row.username, row.password, row.enabled = url, body.username.strip(), password, body.enabled
    row.updated_by = getattr(user, "username", None)
    new = _broker_out(row)
    await create_audit_log(db, request, user, action="update_pw_mqtt_broker", entity="pw_mqtt_broker", entity_id="1", old_data=old, new_data=new)
    await db.commit()
    await ingest.reload()
    return new


@router.put("/mappings")
async def put_mappings(
    body: list[MappingIn], request: Request, db: AsyncSession = Depends(get_db), user=Depends(require_roles(PERMISSION))
) -> dict:
    errors: dict[str, str] = {}
    for m in body:
        if m.topic.strip() and not is_valid_topic(m.topic.strip()):
            errors[f"{m.device_name}/{m.metric_name}"] = "topic_invalid"
    if errors:
        raise HTTPException(422, detail={"errors": errors})
    username = getattr(user, "username", None)
    changed = []
    for m in body:
        key = (m.device_name, m.metric_name)
        topic, path = m.topic.strip(), m.field.strip()
        row = await db.get(PwMqttMapping, key)
        old = {"topic": row.topic, "field": row.field, "enabled": row.enabled} if row else None
        if not topic:
            if row is not None:
                await db.execute(delete(PwMqttMapping).where(PwMqttMapping.device_name == key[0], PwMqttMapping.metric_name == key[1]))
                changed.append({"sensor": "/".join(key), "old": old, "new": None})
            continue
        if row is None:
            row = PwMqttMapping(device_name=key[0], metric_name=key[1])
            db.add(row)
        row.topic, row.field, row.enabled, row.updated_by = topic, path, m.enabled, username
        new = {"topic": topic, "field": path, "enabled": m.enabled}
        if new != old:
            changed.append({"sensor": "/".join(key), "old": old, "new": new})
    if changed:
        await create_audit_log(db, request, user, action="update_pw_mqtt_mappings", entity="pw_mqtt_mappings", old_data=None, new_data=changed)
    await db.commit()
    await ingest.reload()
    return {"updated": len(changed)}


def scan_fields(data: Any, max_depth: int = 5) -> list[dict]:
    """field ที่เลือกได้: ตัวเลข / ข้อความตัวเลข / register 2 ตัว (สำหรับ bcd_hex, float32_cdab)"""
    out: list[dict] = []

    def walk(node: Any, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
        for key, value in items:
            key = str(key)
            if "." in key:
                continue
            path = f"{prefix}.{key}" if prefix else key
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                out.append({"path": path, "type": "number", "preview": value})
            elif isinstance(value, str) and _is_num_text(value):
                out.append({"path": path, "type": "text", "preview": value})
            elif isinstance(value, list) and len(value) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in value):
                out.append({"path": path, "type": "registers", "preview": value})
                walk(value, path, depth + 1)
            elif isinstance(value, (dict, list)):
                walk(value, path, depth + 1)

    if isinstance(data, dict) and set(data) == {"value"} and not isinstance(data["value"], (dict, list)):
        return [{"path": "", "type": "number", "preview": data["value"]}]  # payload เป็นค่าเดี่ยว
    walk(data, "", 1)
    return out


def _is_num_text(v: str) -> bool:
    try:
        return math.isfinite(float(v.strip()))
    except ValueError:
        return False


def _decode_payload(raw: bytes | str) -> Any:
    """เหมือน hub: JSON object ใช้ตามเดิม ; ค่าเดี่ยว (ตัวเลข/ข้อความ/array) → {"value": ...}"""
    text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
    try:
        data = json.loads(text)
    except ValueError:
        data = text.strip()
    return data if isinstance(data, dict) else {"value": data}


@router.post("/probe")
async def probe(body: ProbeIn, db: AsyncSession = Depends(get_db), _=Depends(require_roles(PERMISSION))) -> dict:
    topic = body.topic.strip()
    if not is_valid_topic(topic):
        raise HTTPException(422, detail={"errors": {"topic": "topic_invalid"}})
    saved = await db.get(PwMqttBroker, 1)
    if body.broker and body.broker.url.strip():
        password = body.broker.password
        if password == PASSWORD_MASK:
            password = saved.password if saved else ""
        broker = Broker(body.broker.url.strip(), body.broker.username.strip(), password)
    elif saved and saved.url:
        broker = Broker(saved.url, saved.username, saved.password)
    else:
        raise HTTPException(422, detail={"errors": {"url": "required"}})
    try:
        kwargs = client_kwargs(broker)
    except ValueError as exc:
        return {"ok": False, "stage": "connect", "error": str(exc)}

    started = time.monotonic()
    try:
        async with aiomqtt.Client(identifier=f"{utilities_settings.MQTT_CLIENT_PREFIX}-pwprobe-{uuid.uuid4().hex[:6]}", **kwargs) as client:
            await client.subscribe(topic, qos=0)
            connected_ms = int((time.monotonic() - started) * 1000)
            try:
                async with asyncio.timeout(body.timeout_sec):
                    async for msg in client.messages:
                        try:
                            data = _decode_payload(msg.payload)
                        except UnicodeDecodeError:
                            continue
                        return {"ok": True, "connectedMs": connected_ms, "topic": str(msg.topic), "payload": data, "fields": scan_fields(data)}
            except TimeoutError:
                return {"ok": False, "stage": "message", "connectedMs": connected_ms, "error": "no_message"}
    except (aiomqtt.MqttError, OSError) as exc:
        return {"ok": False, "stage": "connect", "error": str(exc)}
    return {"ok": False, "stage": "message", "error": "no_message"}


class PreviewIn(BaseModel):
    device_name: str
    metric_name: str
    raw: Any


@router.post("/preview")
async def preview(body: PreviewIn, db: AsyncSession = Depends(get_db), _=Depends(require_roles(PERMISSION))) -> dict:
    """แปลงค่า raw ตัวอย่างด้วย sensor config ที่ใช้งานอยู่ (แสดงในหน้าต่างเลือก field)"""
    cfg = (
        await db.execute(
            select(SensorConfig).where(
                SensorConfig.device_name == body.device_name, SensorConfig.metric_name == body.metric_name, SensorConfig.is_active.is_(True)
            )
        )
    ).scalars().first()
    if cfg is None:
        return {"ok": False, "error": "no_config"}
    conv = convert(
        body.raw,
        {"decode_type": cfg.decode_type, "raw_min": cfg.raw_min, "raw_max": cfg.raw_max, "range_min": cfg.range_min,
         "range_max": cfg.range_max, "decimal_places": cfg.decimal_places},
    )
    if conv is None:
        return {"ok": False, "error": "not_number"}
    return {"ok": True, "raw": conv.raw, "value": conv.value, "status": conv.status, "unit": cfg.unit}


@router.get("/status")
async def status(_=Depends(require_roles(PERMISSION))) -> dict:
    return ingest.status()


@router.get("/sources")
async def sources(_=Depends(get_current_user)) -> dict:
    """ข้อมูลสำหรับรับค่าสดในเบราว์เซอร์ (ไม่มีข้อมูล broker / รหัสผ่าน)"""
    st = ingest.st
    return {
        "systemId": PW_SYSTEM_ID,
        "enabled": st.enabled,
        "mappings": [
            {"device_name": m.device_name, "metric_name": m.metric_name, "topic": m.topic, "field": m.field}
            for ms in (st.by_topic.values() if st.broker else ())
            for m in ms
        ],
    }
