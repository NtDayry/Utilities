import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.session import init_db
from app.utilities.main import start_utilities, stop_utilities, utilities_routers

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("purifield_app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifespan context."""
    logger.info("Initializing database schema and TimescaleDB hypertables...")
    try:
        await init_db()
        logger.info("Database initialization completed successfully.")
        from app.core.redis_client import preload_sensor_configs_cache
        await preload_sensor_configs_cache()
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}", exc_info=True)

    # Start backup scheduler background worker
    from app.services.backup_scheduler import backup_scheduler_worker
    backup_task = asyncio.create_task(backup_scheduler_worker())

    # Utilities (ระบบน้ำ / MQTT / แจ้งเตือน) — เริ่มหลังฐานข้อมูลหลักพร้อม
    utilities_started = await start_utilities()

    # Purified Water: รับค่าเซนเซอร์จาก MQTT (ใช้ MQTT hub ของส่วน Utilities) — แทนตัวอ่าน Modbus RS485
    from app.purified_water.mqtt_ingest import ingest as pw_mqtt_ingest
    pw_mqtt_started = False
    try:
        await pw_mqtt_ingest.start()
        pw_mqtt_started = True
    except Exception:
        logger.exception("purified water MQTT ingest failed to start")

    yield

    if pw_mqtt_started:
        await pw_mqtt_ingest.stop()
    if utilities_started:
        await stop_utilities()

    # Cancel backup scheduler on shutdown
    backup_task.cancel()
    try:
        await backup_task
    except asyncio.CancelledError:
        pass

    logger.info("Application shutting down...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.ws_sensor import router as ws_sensor_router
from app.api.ws_monitor import router as ws_monitor_router
from app.websocket.backup_ws import router as ws_backup_router

# Include WebSocket sensor endpoints at root level (/ws/sensor-data & /ws/sensor-ingest)
app.include_router(ws_sensor_router)

# Include system monitor WebSocket endpoint at root level (/ws/monitor)
app.include_router(ws_monitor_router)

# Include backup & restore WebSocket endpoint at root level (/ws/backup)
app.include_router(ws_backup_router)

# Utilities API (/api/utilities/*) + WebSocket (/ws/utilities/mqtt)
# ต้อง include ก่อน api_router ไม่มีผลกับ path เพราะ prefix ไม่ซ้ำกัน แต่ใส่ไว้ก่อนให้อ่านง่าย
for _r, _prefix in utilities_routers():
    app.include_router(_r, prefix=_prefix)

# Include main API router
app.include_router(api_router, prefix="/api")

# Serve uploaded static files if directory exists
if settings.UPLOAD_DIR.exists():
    app.mount("/static/uploads", StaticFiles(directory=str(settings.UPLOAD_DIR)), name="uploads")
if settings.UPLOAD_PROFILE_DIR.exists():
    app.mount("/static/profile", StaticFiles(directory=str(settings.UPLOAD_PROFILE_DIR)), name="profile_uploads")
if settings.SUPPORT_TEAM_DIR.exists():
    app.mount("/storage/support-team", StaticFiles(directory=str(settings.SUPPORT_TEAM_DIR)), name="support_team_storage")


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "online",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    """Root healthcheck endpoint."""
    return {"status": "ok", "service": settings.APP_NAME}
