# -*- coding: utf-8 -*-
"""تنظیمات شرکت، سیاست‌ها، سال مالی و بستن دوره + پشتیبان‌گیری"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from .helpers import get_settings, log, require

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/public")
def public_settings(db: Session = Depends(get_db)):
    """برندینگ عمومی برای صفحه ورود — بدون احراز هویت، فقط فیلدهای نمایشی"""
    s = get_settings(db)
    return {"company_name": s.company_name, "company_name_en": s.company_name_en,
            "company_logo": s.company_logo}


@router.get("")
def read_settings(user: dict = Depends(require()), db: Session = Depends(get_db)):
    s = get_settings(db)
    return {"company_name": s.company_name, "company_name_en": s.company_name_en,
            "company_national_id": s.company_national_id,
            "company_reg_no": s.company_reg_no,
            "company_economic_code": s.company_economic_code,
            "company_activity": s.company_activity,
            "company_address": s.company_address, "company_phone": s.company_phone,
            "company_email": s.company_email, "company_website": s.company_website,
            "company_logo": s.company_logo,
            "currency_display": s.currency_display,
            "member_sees_all_expenses": s.member_sees_all_expenses,
            "auto_offset": s.auto_offset, "fiscal_label": s.fiscal_label,
            "fiscal_start": s.fiscal_start, "fiscal_end": s.fiscal_end,
            "period_closed": s.period_closed, "base_share_date": s.base_share_date}


class SettingsBody(BaseModel):
    company_name: str | None = None
    company_name_en: str | None = None
    company_national_id: str | None = None
    company_reg_no: str | None = None
    company_economic_code: str | None = None
    company_activity: str | None = None
    company_address: str | None = None
    company_phone: str | None = None
    company_email: str | None = None
    company_website: str | None = None
    company_logo: str | None = None
    currency_display: str | None = None
    member_sees_all_expenses: bool | None = None
    auto_offset: bool | None = None
    fiscal_label: str | None = None
    fiscal_start: str | None = None
    fiscal_end: str | None = None
    base_share_date: str | None = None


MAX_LOGO_BYTES = 400_000  # سقف حجم آرم (dataURL) برای سلامت پایگاه‌داده و سرعت بارگذاری


@router.patch("")
def update_settings(body: SettingsBody, user: dict = Depends(require("admin", "finance")),
                    db: Session = Depends(get_db)):
    s = get_settings(db)
    before = {"currency_display": s.currency_display,
              "member_sees_all_expenses": s.member_sees_all_expenses,
              "auto_offset": s.auto_offset, "fiscal_label": s.fiscal_label}
    data = body.model_dump(exclude_none=True)
    if "company_logo" in data and data["company_logo"] and len(data["company_logo"]) > MAX_LOGO_BYTES:
        raise HTTPException(400, "حجم تصویر آرم بیش از حد مجاز است (حداکثر ۳۰۰ کیلوبایت — تصویر کوچک‌تری انتخاب کنید)")
    for k, v in data.items():
        setattr(s, k, v)
    log(db, user, "update", "settings", 1, {"before": before, "after": data})
    db.commit()
    return {"ok": True}


class PeriodBody(BaseModel):
    closed: bool
    reason: str = ""


@router.post("/period")
def set_period(body: PeriodBody, user: dict = Depends(require("finance", "admin")),
               db: Session = Depends(get_db)):
    s = get_settings(db)
    s.period_closed = body.closed
    log(db, user, "close_period" if body.closed else "open_period", "settings", 1,
        {"reason": body.reason})
    db.commit()
    return {"period_closed": s.period_closed}


@router.get("/backup")
def export_backup(user: dict = Depends(require("admin", "finance")), db: Session = Depends(get_db)):
    """خروجی کامل JSON برای پشتیبان‌گیری"""
    data = {}
    for name, table in [("settings", models.Setting), ("users", models.User),
                        ("members", models.Member), ("shares", models.Share),
                        ("projects", models.Project), ("banks", models.BankAccount),
                        ("tafsils", models.Tafsil), ("accounts", models.Account),
                        ("expenses", models.Expense), ("funding", models.FundingRequest),
                        ("commitments", models.Commitment), ("payments", models.Payment),
                        ("allocations", models.Allocation), ("credits", models.OffsetCredit),
                        ("services", models.Service), ("wallet", models.WalletTx),
                        ("vouchers", models.Voucher), ("vlines", models.VLine),
                        ("audit", models.AuditLog), ("attachments", models.Attachment)]:
        rows = db.execute(select(table)).scalars().all()
        data[name] = []
        for r in rows:
            d = {}
            for col in table.__table__.columns:
                v = getattr(r, col.name)
                d[col.name] = v.isoformat() if isinstance(v, type(json)) else \
                    (v.isoformat() if hasattr(v, "isoformat") else v)
            data[name].append(d)
    return data
