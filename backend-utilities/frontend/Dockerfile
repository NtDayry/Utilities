# syntax=docker/dockerfile:1
# =====================================================================
# utilities-nginx: build หน้าเว็บ (../frontend-utilities) ภายใน Docker แล้วเสิร์ฟด้วย nginx
#   build context = ../frontend-utilities (ดู docker-compose.yml) — ไม่ต้องมี Node.js / npm run build บนเครื่อง
#   ไฟล์ .env* ของ frontend ไม่ถูกคัดลอกเข้า image (Dockerfile.dockerignore) → ไม่มีรหัสผ่าน broker ในไฟล์ JS
#   ค่าที่ฝังในหน้าเว็บมาจาก build args ด้านล่าง (ตั้งใน backend-utilities/.env)
# =====================================================================
FROM node:22-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# API / WebSocket / MQTT ทั้งหมดผ่าน nginx ตัวเดียวกัน (origin เดียวกับหน้าเว็บ)
ENV VITE_BASE_URL=/api
ARG VITE_PROJECT_NAME="Utilities System"
ARG VITE_COPYRIGHT="Copyright © 2026 Engineering Department All Rights Reserved."
ARG VITE_CREDITE="By Engineering"
# แสดงผลเท่านั้น (โหมด backend: backend เป็นผู้ต่อ broker) = broker พื้นฐานของ utilities-api
ARG VITE_MQTT_WATER_URL="mqtt://utilities-mqtt:1883"
ENV VITE_PROJECT_NAME=${VITE_PROJECT_NAME} \
    VITE_COPYRIGHT=${VITE_COPYRIGHT} \
    VITE_CREDITE=${VITE_CREDITE} \
    VITE_MQTT_WATER_URL=${VITE_MQTT_WATER_URL}

RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
