# -*- coding: utf-8 -*-
"""امنیت: هش رمز عبور (PBKDF2)، توکن JWT و ابزارهای دسترسی نقش‌محور"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

ALGO = "HS256"
TOKEN_HOURS = 12
_PBKDF2_ITERS = 120_000

ROLE_LABELS = {
    "admin": "مدیر سامانه",
    "finance": "مدیر مالی",
    "accountant": "مسئول حسابداری",
    "ceo": "مدیرعامل / تأییدکننده",
    "member": "عضو / سهامدار",
    "auditor": "حسابرس",
}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS)
    return base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_b64, dk_b64 = stored.split("$", 1)
        salt = base64.b64decode(salt_b64)
        dk = base64.b64decode(dk_b64)
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS)
        return hmac.compare_digest(calc, dk)
    except Exception:
        return False


def create_token(user_id: int, role: str, secret: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(payload, secret, algorithm=ALGO)


def decode_token(token: str, secret: str) -> dict | None:
    try:
        return jwt.decode(token, secret, algorithms=[ALGO])
    except Exception:
        return None
