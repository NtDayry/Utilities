"""/api/utilities/water-supply — แหล่งข้อมูล MQTT ของบ่อน้ำประปาโรงงาน + ระบบปั๊ม (คอนโทรลเลอร์ WaterLevel)

GET /water-supply/source   (login)  topic + broker ที่ใช้ (ไม่มีชื่อผู้ใช้/รหัสผ่าน) — หน้าเว็บใช้ subscribe ผ่าน /ws/utilities/mqtt
GET /water-supply/mqtt     (admin)  ค่าที่ตั้งไว้ (รหัสผ่านปิดบัง)
PUT /water-supply/mqtt     (admin)  บันทึก — broker = null : ใช้ broker พื้นฐานของ backend ; รหัสผ่าน "********" = ใช้รหัสผ่านเดิม
ทดสอบก่อนบันทึก: POST /mqtt/probe {broker, topic, system_id: "__water_supply__"}
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.utilities.auth import User, admin_user, current_user
from app.utilities.mqtt.hub import Broker, client_kwargs
from app.utilities.routes.water_systems import PASSWORD_MASK
from app.utilities.services.ingest import ingestor
from app.utilities.water.model import is_valid_topic
from app.utilities.water.supply_source import SYSTEM_ID, source

router = APIRouter(prefix="/water-supply", tags=["water-supply"])


class BrokerIn(BaseModel):
    url: str = Field("", max_length=255)
    username: str = Field("", max_length=100)
    password: str = Field("", max_length=255)


class SourceIn(BaseModel):
    topic: str = Field(..., max_length=200)
    broker: BrokerIn | None = None


def _masked(cfg: dict) -> dict:
    b = cfg.get("broker")
    return {
        "topic": cfg["topic"],
        "broker": None if not b else {"url": b["url"], "username": b["username"], "password": PASSWORD_MASK if b.get("password") else ""},
    }


@router.get("/source")
async def get_source(_: User = Depends(current_user)) -> dict:
    b = source.broker()
    return {"systemId": SYSTEM_ID, "topic": source.topic, "brokerUrl": b.url, "customBroker": source.cfg.get("broker") is not None}


@router.get("/mqtt")
async def get_mqtt(_: User = Depends(admin_user)) -> dict:
    return _masked(source.cfg)


@router.put("/mqtt")
async def put_mqtt(body: SourceIn, user: User = Depends(admin_user)) -> dict:
    topic = body.topic.strip()
    errors: dict[str, str] = {}
    if not is_valid_topic(topic) or topic.endswith(("/set", "/settings", "/configs")):
        errors["topic"] = "topic_invalid"
    broker = None
    if body.broker and body.broker.url.strip():
        url = body.broker.url.strip()
        try:
            client_kwargs(Broker(url))
        except ValueError:
            errors["url"] = "broker_url_invalid"
        password = body.broker.password
        old = source.cfg.get("broker") or {}
        if password == PASSWORD_MASK:
            password = old.get("password", "") if old.get("url") == url else ""
        broker = {"url": url, "username": body.broker.username.strip(), "password": password}
    if errors:
        raise HTTPException(422, detail={"errors": errors})
    await source.save({"topic": topic, "broker": broker}, user.username)
    await ingestor.resync()
    return _masked(source.cfg)
