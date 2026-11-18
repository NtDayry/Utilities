"""Purified Water — แหล่งข้อมูล MQTT (แทนตัวอ่าน Modbus RS485)

pw_mqtt_broker   : broker ที่ใช้รับค่า (แถวเดียว id = 1) ตั้งค่าในหน้า purified-water/settings
pw_mqtt_mappings : เซนเซอร์ (device_name, metric_name) ← topic + field ใน payload
                   ผูกด้วยชื่อ ไม่ใช่ config id เพราะ sensor_configs สร้างแถวใหม่ทุกครั้งที่แก้ค่า
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.schemas import PURIFIED_WATER
from app.db.session import Base


class PwMqttBroker(Base):
    __tablename__ = "pw_mqtt_broker"
    __table_args__ = {"schema": PURIFIED_WATER}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    url: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    username: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    password: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)


class PwMqttMapping(Base):
    __tablename__ = "pw_mqtt_mappings"
    __table_args__ = {"schema": PURIFIED_WATER}

    device_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    metric_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    # ตำแหน่งค่าใน payload JSON เช่น "ro1.conduct" หรือ "regs.0" ; ว่าง = payload เป็นตัวเลขเดี่ยว
    field: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
