from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

from app.db.schemas import SEARCH_PATH

# ทุก connection ค้นตารางใน core / purified_water / water_supply / ... ก่อน public
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"server_settings": {"search_path": SEARCH_PATH}},
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass