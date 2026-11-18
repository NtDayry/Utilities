FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# เหมือน Dockerfile เดิมของ PurifiedWater (build-essential/libpq สำหรับ package ที่ต้อง compile, curl ใช้ตรวจระบบ)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY assets ./assets

EXPOSE 8000

# 1 process เท่านั้น (MQTT / บันทึกข้อมูล / แจ้งเตือน / backup scheduler อยู่ใน process เดียว) — ห้ามเพิ่ม --workers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
