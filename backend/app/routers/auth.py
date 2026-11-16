# -*- coding: utf-8 -*-
"""ورود، نشست کاربر و احراز هویت دومرحله‌ای اختیاری (PIN)"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..security import (create_token, hash_password, verify_password, ROLE_LABELS)
from .helpers import get_current_user, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str
    pin: str | None = None


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.execute(select(models.User).where(
        models.User.username == body.username.strip())).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.pw_hash):
        raise HTTPException(401, "نام کاربری یا رمز عبور نادرست است")
    if user.pin_hash:  # دومرحله‌ای
        if not body.pin:
            raise HTTPException(401, "PIN_REQUIRED")
        if not verify_password(body.pin, user.pin_hash):
            raise HTTPException(401, "رمز دومرحله‌ای نادرست است")
    s = get_settings(db)
    token = create_token(user.id, user.role, s.secret)
    from ..services.accounting import log
    log(db, {"username": user.username}, "login", "user", user.id, {})
    db.commit()
    return {"token": token, "user": {
        "id": user.id, "username": user.username, "full_name": user.full_name,
        "role": user.role, "role_label": ROLE_LABELS.get(user.role, user.role),
        "member_id": user.member_id,
        "has_pin": bool(user.pin_hash)}}


@router.post("/logout")
def logout(user: dict = Depends(get_current_user)):
    """پایان نشست — توکن‌ها سمت کلاینت حذف می‌شوند؛ برای هم‌خوانی پرتیبل/سرور موجود است"""
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user["id"])
    return {"id": u.id, "username": u.username, "full_name": u.full_name,
            "role": u.role, "role_label": ROLE_LABELS.get(u.role, u.role),
            "member_id": u.member_id, "has_pin": bool(u.pin_hash)}


class PinBody(BaseModel):
    pin: str | None = None  # None یا خالی = غیرفعال‌سازی


@router.post("/pin")
def set_pin(body: PinBody, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user["id"])
    if body.pin and len(body.pin) >= 4 and body.pin.isdigit():
        u.pin_hash = hash_password(body.pin)
    elif not body.pin:
        u.pin_hash = None
    else:
        raise HTTPException(400, "PIN باید ۴ رقم یا بیشتر و فقط عدد باشد")
    db.commit()
    return {"has_pin": bool(u.pin_hash)}
