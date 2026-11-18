"""สิทธิ์ของ API ส่วน Utilities — ใช้ระบบ login หลักโดยตรง (cookie access_token, users, token_version, status, role)

ตรวจผ่าน app.api.routes.auth.get_current_user ตัวเดียวกับทุก API เดิม:
logout / ปิดผู้ใช้ / เปลี่ยน token_version มีผลกับ API ส่วนนี้ทันทีเหมือนกัน
"""
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import get_current_user, get_db, get_permissions_for_role
from app.db.session import AsyncSessionLocal
from app.utilities.config import settings


@dataclass
class User:
    username: str
    role: str
    permissions: list[str] = field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return (self.role or "").lower() in settings.admin_roles or "*" in self.permissions

    def can(self, permission_key: str) -> bool:
        return self.is_admin or permission_key in self.permissions


async def _to_user(u: object, db: AsyncSession) -> User:
    role = str(getattr(u, "role", "") or "")
    try:
        perms = await get_permissions_for_role(role, db)
    except Exception:
        perms = []
    return User(username=str(getattr(u, "username", "")), role=role, permissions=list(perms))


async def current_user(u=Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    return await _to_user(u, db)


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    return user


async def websocket_user(ws: WebSocket) -> User | None:
    token = ws.cookies.get("access_token")
    if not token:
        return None
    async with AsyncSessionLocal() as db:
        try:
            u = await get_current_user(access_token=token, db=db)
        except HTTPException:
            return None
        return await _to_user(u, db)
