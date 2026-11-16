# -*- coding: utf-8 -*-
"""مدیریت کاربران (فقط مدیر سامانه)"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..security import hash_password, ROLE_LABELS
from .helpers import log, require

router = APIRouter(prefix="/api/users", tags=["users"])


def user_dict(u: models.User) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name,
            "role": u.role, "role_label": ROLE_LABELS.get(u.role, u.role),
            "member_id": u.member_id, "is_active": u.is_active,
            "has_pin": bool(u.pin_hash)}


@router.get("")
def list_users(user: dict = Depends(require("admin")), db: Session = Depends(get_db)):
    return [user_dict(u) for u in db.execute(select(models.User).order_by(models.User.id)).scalars()]


class UserBody(BaseModel):
    username: str
    password: str | None = None
    full_name: str
    role: str
    member_id: int | None = None
    is_active: bool = True


VALID_ROLES = set(ROLE_LABELS)


@router.post("")
def create_user(body: UserBody, user: dict = Depends(require("admin")), db: Session = Depends(get_db)):
    if body.role not in VALID_ROLES:
        raise HTTPException(400, "نقش نامعتبر است")
    if db.execute(select(models.User).where(models.User.username == body.username)).scalar_one_or_none():
        raise HTTPException(400, "نام کاربری تکراری است")
    if body.role == "member" and not body.member_id:
        raise HTTPException(400, "کاربر نقش عضو باید به یک عضو متصل شود")
    if not body.password or len(body.password) < 6:
        raise HTTPException(400, "رمز عبور باید حداقل ۶ نویسه باشد")
    u = models.User(username=body.username.strip(), pw_hash=hash_password(body.password),
                    full_name=body.full_name, role=body.role, member_id=body.member_id,
                    is_active=body.is_active)
    db.add(u)
    db.flush()
    log(db, user, "create", "user", u.id, {"username": u.username, "role": u.role})
    db.commit()
    return user_dict(u)


@router.patch("/{uid}")
def update_user(uid: int, body: UserBody, user: dict = Depends(require("admin")),
                db: Session = Depends(get_db)):
    u = db.get(models.User, uid)
    if not u:
        raise HTTPException(404, "کاربر یافت نشد")
    before = {"role": u.role, "is_active": u.is_active, "member_id": u.member_id}
    u.full_name = body.full_name
    u.role = body.role
    u.member_id = body.member_id
    u.is_active = body.is_active
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(400, "رمز عبور باید حداقل ۶ نویسه باشد")
        u.pw_hash = hash_password(body.password)
    log(db, user, "update", "user", u.id, {"before": before, "after": body.model_dump(exclude={"password"})})
    db.commit()
    return user_dict(u)


@router.delete("/{uid}")
def deactivate(uid: int, user: dict = Depends(require("admin")), db: Session = Depends(get_db)):
    u = db.get(models.User, uid)
    if not u:
        raise HTTPException(404, "کاربر یافت نشد")
    if u.id == user["id"]:
        raise HTTPException(400, "حذف کاربر خودی مجاز نیست")
    u.is_active = False
    log(db, user, "deactivate", "user", u.id, {"username": u.username})
    db.commit()
    return {"ok": True}
