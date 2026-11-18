"""/api/utilities/mqtt — ทดสอบการเชื่อมต่อ + สแกนข้อความ (หน้าต่าง "เพิ่มระบบ") และสถานะการเชื่อมต่อ"""
import asyncio
import json
import time
import uuid

import aiomqtt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.utilities.auth import User, admin_user
from app.utilities.config import settings
from app.utilities.mqtt.hub import Broker, client_kwargs, default_broker, hub
from app.utilities.routes.water_systems import PASSWORD_MASK
from app.utilities.water import repository
from app.utilities.water.supply_source import SYSTEM_ID as SUPPLY_SYSTEM_ID, source as supply_source
from app.utilities.water.model import guess_level_path, is_valid_topic, scan_payload

router = APIRouter(prefix="/mqtt", tags=["mqtt"])


class BrokerIn(BaseModel):
    url: str = ""
    username: str = ""
    password: str = ""


class ProbeIn(BaseModel):
    broker: BrokerIn | None = None
    topic: str
    timeout_sec: float = Field(10, ge=1, le=30)
    # แก้ระบบเดิม: ไม่ส่งรหัสผ่านมา = ใช้รหัสผ่านที่บันทึกไว้ของระบบนี้
    system_id: str | None = None


@router.post("/probe")
async def probe(body: ProbeIn, _: User = Depends(admin_user)) -> dict:
    """เชื่อมต่อ broker → รอข้อความแรกของ topic → คืนข้อความ + รายการตำแหน่งข้อมูลที่เลือกได้"""
    if not is_valid_topic(body.topic):
        raise HTTPException(422, detail={"errors": {"topic": "topic_invalid"}})
    if body.broker and body.broker.url:
        password = body.broker.password
        # ไม่ส่งรหัสผ่าน / ส่งค่าที่ปิดบังไว้ = ใช้รหัสผ่านที่บันทึกไว้ของระบบนี้
        if password == PASSWORD_MASK:
            password = ""
        if not password and body.system_id == SUPPLY_SYSTEM_ID:
            saved_b = supply_source.cfg.get("broker") or {}
            if saved_b.get("url") == body.broker.url:
                password = saved_b.get("password") or ""
        elif not password and body.system_id:
            saved = await repository.get_system(body.system_id)
            if saved and saved.get("broker") and saved["broker"].get("url") == body.broker.url:
                password = saved["broker"].get("password") or ""
        broker = Broker(body.broker.url, body.broker.username, password)
    else:
        broker = default_broker()
    try:
        kwargs = client_kwargs(broker)
    except ValueError as exc:
        return {"ok": False, "stage": "connect", "error": str(exc)}

    started = time.monotonic()
    try:
        async with aiomqtt.Client(identifier=f"{settings.MQTT_CLIENT_PREFIX}-probe-{uuid.uuid4().hex[:6]}", **kwargs) as client:
            await client.subscribe(body.topic, qos=0)
            connected_ms = int((time.monotonic() - started) * 1000)
            try:
                async with asyncio.timeout(body.timeout_sec):
                    async for msg in client.messages:
                        try:
                            data = json.loads(msg.payload.decode("utf-8"))
                        except (ValueError, UnicodeDecodeError, AttributeError):
                            continue
                        if isinstance(data, dict):
                            points = scan_payload(data)
                            return {
                                "ok": True,
                                "connectedMs": connected_ms,
                                "topic": str(msg.topic),
                                "payload": data,
                                "points": points,
                                "guessedLevelPath": guess_level_path(points),
                            }
            except TimeoutError:
                return {"ok": False, "stage": "message", "connectedMs": connected_ms, "error": "no_message"}
    except aiomqtt.MqttError as exc:
        return {"ok": False, "stage": "connect", "error": str(exc)}
    except OSError as exc:
        return {"ok": False, "stage": "connect", "error": str(exc)}
    return {"ok": False, "stage": "message", "error": "no_message"}


@router.get("/status")
async def status(_: User = Depends(admin_user)) -> list[dict]:
    return hub.status()
