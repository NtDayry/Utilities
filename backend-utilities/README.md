# backend-utilities

Backend ทั้งระบบของ **frontend-utilities** — รวมโค้ด backend เดิมของ PurifiedWater (login, users, roles, audit log,
sensors, alerts, notifications, backup, system monitor) กับส่วน Utilities ใหม่ (ระบบน้ำ, MQTT, TimescaleDB)
ไว้ใน stack เดียว: FastAPI + PostgreSQL/TimescaleDB + Redis + Mosquitto + Nginx (Docker Compose)

```
เบราว์เซอร์ ──https://<host>──► utilities-nginx
                                ├─ /api/*  /ws/*  /static/*  /storage/*  → utilities-api (FastAPI)
                                ├─ /mqtt                                   → utilities-mqtt (MQTT over WebSocket)
                                ├─ /portainer/                             → portainer
                                └─ /                                       → หน้าเว็บ (build จาก ../frontend-utilities ใน Docker)

อุปกรณ์ Purified Water ──MQTT──► broker (ตั้งในหน้า purified-water/settings) ──► utilities-api
คอนโทรลเลอร์ระบบน้ำ ──mqtt:1883──► utilities-mqtt ◄──bridge──► broker เดิม
                                 │                                                      │
                        utilities-db (PostgreSQL 16 + TimescaleDB)  ◄──── utilities-api (อ่านค่าตาม path → บันทึก + แจ้งเตือน)
                        utilities-redis (cache login / สิทธิ์)
```

## ย้ายจาก stack เดิม (ครั้งแรก)

stack ใหม่ใช้ **โฟลเดอร์ข้อมูลเดิม** (`../storage`) และพอร์ตเดิม (80/443/5432) — ผู้ใช้ รหัสผ่าน ประวัติ ไฟล์อัปโหลด ไฟล์ backup เดิมใช้ต่อได้ทันที

```bash
# 1) หยุด stack เดิม (ห้ามรัน 2 stack พร้อมกัน — ใช้ฐานข้อมูลโฟลเดอร์เดียวกัน)
cd D:\Utilities
docker compose down

# 2) เริ่ม stack ใหม่
cd D:\Utilities\backend-utilities
docker compose up -d --build
docker compose ps
docker compose logs -f utilities-api      # ควรเห็น "Database initialization completed" และ "utilities started"
```

ถ้าต้องการกลับไปใช้ของเดิม: `docker compose down` ที่นี่ แล้ว `docker compose up -d` ที่ `D:\Utilities`
(ตารางใหม่ของระบบน้ำที่เพิ่มในฐานข้อมูลไม่กระทบระบบเดิม)

## โครงสร้างโค้ด

| โฟลเดอร์ | |
|---|---|
| `app/api` `app/core` `app/db` `app/models` `app/services` `app/websocket` | โค้ดเดิมของ PurifiedWater (import path เดิมทั้งหมด) |
| `app/utilities/` | ส่วนใหม่: ระบบน้ำ, MQTT hub, ingest → TimescaleDB, แจ้งเตือน, WebSocket `/ws/utilities/mqtt` |
| `app/main.py` | แอปเดียว: ระบบเดิม + `app.utilities.main` |
| `app/purified_water/` | Purified Water รับค่าทาง MQTT: แปลงค่า raw (สูตรเดียวกับตัวอ่าน Modbus เดิม), ค่าสด, รวมรายนาที, แจ้งเตือน |
| `frontend/Dockerfile` | build หน้าเว็บ `../frontend-utilities` ใน Docker → image ของ utilities-nginx |
| `modbus_service/` | ตัวอ่าน RS485 เดิม (เลิกใช้ — service `modbus-reader`, profile `modbus` ปิดอยู่) |
| `assets/sql/default` | ข้อมูลตั้งต้น (roles / permissions / support team) |

## ฐานข้อมูล: แยก schema ต่อระบบ

database เดียว แยก schema ต่อระบบ — ระบบทั้งหมดใช้ผู้ใช้ / สิทธิ์ / การแจ้งเตือนชุดเดียวกันใน `core` (รายการเต็มอยู่ใน `app/db/schemas.py`)

| schema | ตาราง | หมายเหตุ |
|---|---|---|
| `core` (ใช้ร่วมกัน) | `users` `roles` `permissions` `role_permissions` `audit_logs` `support_team` `notification_settings` `app_settings` `alarm_settings` `alarm_events` `mqtt_messages` | login / สิทธิ์ / audit / ค่า LINE-Email ใช้ทุกระบบ ; `alarm_*` แยกระบบด้วยคอลัมน์ `system` |
| `purified_water` | `sensor_groups` `sensors` `sensor_configs` `sensor_readings` (hypertable) `sensor_readings_1hour` (aggregate) `alert_rules` `alert_events` `pw_mqtt_broker` `pw_mqtt_mappings` | รับค่าทาง MQTT ; `alert_events.acknowledged_by` → `core.users` |
| `water_supply` (ประปา) | `water_systems` `readings` (hypertable) `readings_1m` `readings_1h` (aggregate) | MQTT |
| `wastewater` `electrical` | (ยังไม่มีตาราง) | สร้างตารางใหม่ของระบบนั้นใน schema นี้ |

- ทุก connection ตั้ง `search_path = core, purified_water, water_supply, wastewater, electrical, public` และตั้งเป็นค่าเริ่มต้นของ database ด้วย → SQL / psql / pgAdmin ใช้ชื่อตารางสั้นได้เหมือนเดิม (ชื่อตารางห้ามซ้ำข้าม schema)
- **ย้ายอัตโนมัติ**: ตอนเริ่ม API ถ้าตารางยังอยู่ใน `public` จะ `ALTER ... SET SCHEMA` ไปที่ schema ใหม่ (ย้ายแค่ชื่อ ไม่คัดลอกข้อมูล — chunk / index / policy ของ TimescaleDB ตามไปด้วย) รันซ้ำได้ ; ถ้ามีตารางชื่อเดียวกันทั้งใน `public` และ schema ใหม่จะไม่แตะ และเขียน ERROR ใน log
- ไฟล์ backup เก็บชื่อตารางสั้น → backup ที่ทำก่อนแยก schema ยัง restore ได้
- เพิ่มตารางใหม่: ใส่ใน `TABLE_SCHEMA` (`app/db/schemas.py`) + ระบุ schema ใน model (`__table_args__ = {"schema": ...}`) หรือใน SQL ที่สร้างตาราง

## Volume

| โฟลเดอร์ | |
|---|---|
| `${STORAGE_ROOT}` (ค่าเริ่มต้น `../storage`) | `database/postgres/data`, `redis`, `mosquitto`, `uploads`, `profile`, `support-team`, `backups` |
| `logs/api` `logs/nginx` `logs/mosquitto` | log |
| `app` `assets` | โค้ด/ข้อมูลตั้งต้น (แก้โค้ดแล้ว `docker compose restart utilities-api`) |
| `nginx/templates` `nginx/ssl` `mosquitto/config` `init-db` | การตั้งค่า / certificate |
| `/var/run/docker.sock` `/proc` `/sys` | หน้า System Monitor (เหมือนเดิม) |

## พอร์ต

| พอร์ต | |
|---|---|
| 80 / 443 | เว็บ |
| 5432 | PostgreSQL |
| 1883 | MQTT สำหรับอุปกรณ์ |
| 9001 | MQTT over WebSocket (ปกติใช้ผ่าน `wss://<host>/mqtt`) |
| 9443 | Portainer |

## API

ระบบเดิม `/api/*` เหมือนเดิมทุก endpoint (auth, users, roles, support-team, audit-logs, sensors, alerts, notifications, ingest, backup)
และ WebSocket `/ws/monitor`, `/ws/backup` (`/ws/sensor-data`, `/ws/sensor-ingest` ยังมีอยู่แต่หน้าเว็บไม่ใช้แล้ว — ค่าสด Purified Water มาจาก MQTT)

ส่วนใหม่ `/api/utilities` (เอกสาร: `https://<host>/docs`) — สิทธิ์ใช้ login/role ของระบบหลัก:

| Method | Path | สิทธิ์ | |
|---|---|---|---|
| GET | `/water-systems` | login | รายการระบบน้ำ (WaterSystemConfig[]) — รหัสผ่าน broker ส่งเป็น `********` |
| PUT | `/water-systems` | admin | แทนที่ทั้งรายการ (= `WaterSystemRepository.saveAll`) |
| GET/PUT/DELETE | `/water-systems/{id}` | login / admin | ทีละระบบ (บันทึกรหัสผ่านเป็น `********` = ใช้รหัสผ่านเดิม ; topic ว่าง = ยังไม่เชื่อมต่อเซ็นเซอร์) |
| POST | `/water-systems/seed` | admin | ใส่ถัง/บ่อตั้งต้นของโรงงานครั้งเดียวต่อ id (ลบแล้วไม่กลับมา) |
| GET | `/water-systems/{id}/latest` | login | ข้อความล่าสุด + ค่าที่อ่านตาม path + ปริมาตร/% |
| GET | `/water-systems/{id}/history?metrics=level_pct,volume_l&start=&end=&bucket=` | login | ข้อมูลย้อนหลัง |
| POST | `/mqtt/probe` | admin | เชื่อมต่อ + รอข้อความแรก + สแกนตำแหน่งข้อมูล |
| GET | `/mqtt/status` | admin | สถานะ broker / topic |
| GET/PUT | `/alarms/{water\|electrical\|wastewater}/{rules\|targets}` | login / admin | ตั้งค่าแจ้งเตือน |
| GET | `/alarms/events?system=&group_id=&active=&start=&end=` | login | เหตุการณ์แจ้งเตือน |
| POST | `/alarms/events/ack` `{ids}` | `alarm:acknowledge` | รับทราบ |
| GET | `/settings` · GET/PUT `/settings/{factory-sensors\|pump-station-tank}` | login / admin | การตั้งค่าส่วนกลางของหน้าเว็บ (เดิมอยู่ใน localStorage) |
| GET | `/health` | - | สถานะ |

admin = role `admin` / `super admin` (ตรงกับ `isAdminRole` ของ frontend-utilities) — logout / ปิดผู้ใช้ มีผลกับ API ส่วนนี้ทันที

WebSocket `/ws/utilities/mqtt` (MQTT ทั้งหมดของหน้าเว็บผ่านช่องนี้):

```jsonc
{"type":"subscribe","topic":"tank-a","systemId":"tank-a"}                       // ส่ง
{"type":"publish","id":"1","topic":"water-system-production/set","payload":{}}  // admin เท่านั้น
{"type":"msg","topic":"tank-a","systemId":"tank-a","data":{...},"at":1731830000000,"ageMs":0}   // รับ (ageMs = อายุของข้อความที่เก็บไว้)
{"type":"alarm","action":"raised|cleared|acknowledged","event":{...}}
```

## Purified Water: รับค่าทาง MQTT

ตั้งค่าในหน้า **Purified Water → Settings Devices** (`/purified-water/settings`, สิทธิ์ `page:device`) — ไม่ต้องแก้ไฟล์หรือ restart

1. การ์ด **แหล่งข้อมูล MQTT**: Broker URL (`mqtt://` `mqtts://` `ws://` `wss://`), ชื่อผู้ใช้, รหัสผ่าน → ทดสอบ (รอข้อความแรกของ topic) → บันทึก
   - backend เป็นผู้ต่อ broker: ใช้ broker เดิมตรงๆ ได้ (เช่น `mqtt://192.168.12.77:1884`) หรือใช้ `mqtt://utilities-mqtt:1883` แล้วเพิ่ม topic ใน `MQTT_BRIDGE_TOPICS`
2. คอลัมน์ **MQTT Source** ของแต่ละเซนเซอร์ → หน้าต่างตั้งค่าทั้งอุปกรณ์: ใส่ topic → **สแกน topic** (เห็น payload จริง + ตัวเลือก field) → ใส่ field ของแต่ละเซนเซอร์ (เห็น raw → ค่าที่แปลงแล้วทันที) → บันทึก
   - field = path ใน payload JSON เช่น `ro1.conduct`, `regs.0` ; ว่าง = payload เป็นตัวเลขตัวเดียว ; topic ว่าง = เลิกรับค่าเซนเซอร์นั้น
   - จุดสีในคอลัมน์: เขียว = กำลังรับค่า, เหลือง = รอข้อความ, แดง = ผิดพลาด (ไม่พบ field / ค่าไม่ใช่ตัวเลข / ไม่มี sensor config), เทา = ยังไม่ตั้ง

การแปลงค่า (ใช้ sensor config ที่ใช้งานอยู่ — แก้ Decode Type / Raw / Range ในตารางเดิมแล้วมีผลภายใน 5 วินาที):

| Decode Type | ค่า raw ที่รับ | ค่าจริง |
|---|---|---|
| `analog_4_20ma` | ตัวเลข (เช่น 0–20000) | raw → mA → `range_min`–`range_max` + สถานะ NO_SIGNAL / UNDER_RANGE / OVER_RANGE (สูตรเดิม) |
| `bcd_hex` | register 2 ตัว `[hi, lo]` หรือค่าจริงเป็นตัวเลข | `[0x0012, 0x3400]` → 12.34 |
| `float32_cdab` | register 2 ตัว `[hi, lo]` หรือค่าจริงเป็นตัวเลข | IEEE-754 CDAB |

backend: ตรวจกฎแจ้งเตือน (`sustained_seconds`) → alert event + LINE/Email, รวมค่ารายนาที (avg/min/max/raw) → `sensor_readings` (เหมือนตัวอ่าน Modbus เดิม)
ค่าสดบนหน้าเว็บ: **รับจาก MQTT เท่านั้น** — เบราว์เซอร์ subscribe topic เดียวกันผ่าน `/ws/utilities/mqtt` (systemId `__purified_water__`, เฉพาะ topic ที่ตั้งไว้, ไม่มีรหัสผ่าน broker ในเบราว์เซอร์) แล้วแปลงค่าเองด้วยสูตรเดียวกัน (`frontend-utilities/src/lib/purifiedWater/pwConvert.ts` — ตรวจความตรงกันด้วย `tests/parity/pw_convert`)
หน้าเว็บไม่ใช้ `/ws/sensor-data` แล้ว และ backend ไม่ส่งค่าเข้า `/ws/sensor-data` อีก
ตาราง: `purified_water.pw_mqtt_broker`, `purified_water.pw_mqtt_mappings` (รวมใน backup) — API: `/api/purified-water/mqtt/{config,broker,mappings,probe,preview,status,sources}`

## ระบบประปาและบ่อน้ำ: ตั้งค่า MQTT ในหน้าเว็บ

- **บ่อน้ำประปาโรงงาน + ระบบปั๊ม** (คอนโทรลเลอร์ WaterLevel — หน้า Water Overview / Pump Station / Reports / Control):
  ตั้งในหน้า **ควบคุม/ตั้งค่าระบบประปา** (`/water-supply/settings`, admin — ไม่อยู่ใน sidebar ; เข้าจากปุ่ม **ควบคุม/ตั้งค่าปั๊ม** ในหน้ารายละเอียดระบบประปาและปั๊มน้ำ) การ์ด **การเชื่อมต่อ MQTT ระบบควบคุมปั๊มน้ำ** ด้านบน (เฉพาะคอนโทรลเลอร์ปั๊มน้ำ) ; `/water-supply/mqtt` เดิม redirect มาหน้านี้
  - topic หลัก: `<topic>` ข้อมูล, `<topic>/settings`, `<topic>/configs` และส่งคำสั่งไป `<topic>/set`
  - broker: **broker พื้นฐานของเซิร์ฟเวอร์** (`utilities-mqtt` + bridge — topic ต้องอยู่ใน `MQTT_BRIDGE_TOPICS`) หรือ **กำหนดเอง** (URL / ชื่อผู้ใช้ / รหัสผ่าน — backend ต่อตรง)
  - ทดสอบก่อนบันทึกได้ ; บันทึกแล้วทุกหน้าใช้ค่าใหม่ทันที (ไม่ต้อง restart) — ยังไม่ได้ตั้ง = topic แรกใน `MQTT_CONTROL_TOPICS` บน broker พื้นฐาน
  - เก็บใน `core.app_settings` key `_water_supply_mqtt` (ไม่ส่งรหัสผ่านให้หน้าเว็บ) — API: `GET /api/utilities/water-supply/source` (login), `GET/PUT /api/utilities/water-supply/mqtt` (admin)
  - หน้าเว็บรับ/ส่งผ่าน `/ws/utilities/mqtt` ด้วย systemId `__water_supply__` (เฉพาะ topic ข้างบน ; ส่งคำสั่งได้เฉพาะ admin ไปที่ `<topic>/set`)
- **ถัง / บ่อเก็บน้ำอื่น** (บ่อเก็บน้ำอาคาร 1,4, ถังดาดฟ้า ฯลฯ และระบบที่เพิ่มเอง): ตั้ง topic / broker / ตำแหน่งข้อมูลในหน้าของแต่ละระบบ (ตั้งค่า / เพิ่มเซนเซอร์)

## Backup / Restore

backup รวมตารางของระบบน้ำด้วย (`water_systems`, `alarm_settings`, `alarm_events`, `app_settings`, `readings`)

## หน้าเว็บ (frontend-utilities)

build ภายใน Docker (`frontend/Dockerfile`, context `../frontend-utilities`) — เครื่องไม่ต้องมี Node.js ; ไฟล์ `.env*` ของ frontend ไม่ถูกคัดลอกเข้า image
แก้หน้าเว็บแล้ว: `docker compose up -d --build utilities-nginx`

ตอนพัฒนา (`npm run dev` ใน `frontend-utilities`): ข้อมูลจริงจาก backend ที่ตั้งใน `.env.development` → `VITE_BASE_URL` (origin ของ nginx เช่น `https://localhost`) — Vite ส่ง `/api` `/ws` `/storage` `/static` ไปที่นั่น

ใช้ API/WebSocket ข้างบนทั้งหมด (MQTT ผ่าน backend เท่านั้น — หน้าเว็บไม่ต่อ broker เอง): รายการระบบน้ำ, ตั้งค่า/เหตุการณ์แจ้งเตือน, ขนาดบ่อประปา,
การตั้งค่าแผนผังโรงงาน และข้อมูล MQTT สด — ข้อมูลเดิมใน localStorage ของเบราว์เซอร์ admin ถูกย้ายขึ้น backend อัตโนมัติครั้งแรกที่เปิดหน้า

## สิ่งที่แก้จากโค้ดเดิมระหว่างย้าย (bug ที่พบตอนทดสอบ)

| ไฟล์ | ปัญหาเดิม | ผล |
|---|---|---|
| `app/api/routes/auth.py` (refresh) | เขียน Redis cache ซ้ำด้วยข้อมูลผู้ใช้ที่อ่านไว้ตั้งแต่ต้น request — ถ้า logout เกิดระหว่างนั้น token_version เก่ากลับเข้า cache | token ที่ logout แล้วกลับมาใช้ได้ (พบ 1 ครั้งในการทดสอบผ่านเบราว์เซอร์) |
| `app/services/backup_service.py` | restore ส่งเวลาเป็นข้อความเข้า asyncpg ตรงๆ → ทุกแถวที่มีคอลัมน์เวลาถูกปฏิเสธ และ error แรกทำให้ทั้ง transaction ล้ม แต่งานรายงานว่า "completed" | restore ไม่ได้กู้ users / audit logs / sensor readings / ฯลฯ เลย |
| `app/api/routes/auth.py` (logout) | ใส่ `token_version` เป็น int ในคอลัมน์ VARCHAR และเขียน Redis cache โดยไม่ refresh (MissingGreenlet) — error ถูกกลืน | logout ไม่ revoke token: token เดิมใช้ต่อได้จนหมดอายุ |
| `app/db/seed.py` + `app/db/session.py` | seed `sensor_configs` ไม่ใส่ `alert_enabled` (NOT NULL) และ seed อยู่ใน transaction เดียวกับการสร้างตาราง | ติดตั้งบนฐานข้อมูลใหม่ไม่ได้ — ตารางทั้งหมดถูก rollback |
| `app/api/ws_monitor.py` | เครื่องที่ไม่มี `vcgencmd` / เซนเซอร์อุณหภูมิ → exception หยุด broadcast loop ; เก็บค่า Docker แบบ blocking ใน event loop | หน้า System Monitor ไม่ได้ข้อมูล / API ค้างทุกรอบที่เก็บค่า |
| `app/db/session.py` (TimescaleDB) | `add_continuous_aggregate_policy` ของ `sensor_readings_1hour` ใช้ช่วง 2 ชม. (ต้องครอบ ≥ 2 bucket) → error ถูก `except: pass` กลืน แต่ทั้ง transaction ถูก rollback | ไม่มี aggregate รายชั่วโมง / retention / compression ของ purified water เลย — แก้เป็น 3 ชม. และรันทีละขั้นใน savepoint พร้อม log |
| `app/utilities/db.py` | `CREATE INDEX IF NOT EXISTS` บน hypertable ที่บีบอัดแล้วถูกปฏิเสธทุกครั้ง | WARNING เตือนผิดๆ ทุกครั้งที่เริ่ม (index มีอยู่แล้ว) |

## ทดสอบ

- `tests/e2e_local.py` — ระบบน้ำ/MQTT/แจ้งเตือน/WebSocket ครบวงจร ด้วย login จริง (`E2E_ADMIN_USER` ฯลฯ)
- `tests/parity/` — เทียบ `app/utilities/water/model.py` กับ `frontend-utilities/src/lib/waterSystems/model.ts`
- `tests/parity/pw_convert/` — เทียบการแปลงค่า Purified Water ของ backend กับหน้าเว็บ

## หมายเหตุ

- utilities-api ต้องรัน 1 process (ห้ามเพิ่ม `--workers`)
- ระบบที่ topic อยู่บน broker เดิม ต้องใส่ topic ใน `MQTT_BRIDGE_TOPICS`
- `MQTT_BRIDGE_ADDRESS` ต้องเป็นพอร์ต MQTT แบบ TCP ของ broker เดิม
- ตัวอ่าน Modbus RS485 (`modbus-reader`) ปิดอยู่ — ห้ามเปิดพร้อมการรับค่าทาง MQTT (ค่าจะบันทึกซ้ำ)
