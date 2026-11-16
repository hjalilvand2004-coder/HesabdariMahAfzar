# -*- coding: utf-8 -*-
"""خدمات اعضا و جبران خدمات — ثبت، گردش تأیید مدیرعامل، تهاتر یا پرداخت نقدی با سند خودکار"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import (log, next_number, post_voucher,
                                   get_tafsil_for_member, get_tafsil_for_bank,
                                   bank_account_code)
from ..services.financing import auto_allocate
from ..jalali import today_iso
from .helpers import get_settings, guard_period, require

router = APIRouter(prefix="/api/services", tags=["services"])

STYPE_LABELS = {"tech": "فنی و نرم‌افزاری", "legal": "حقوقی و قراردادی",
                "accounting": "حسابداری و مالی", "design": "طراحی و گرافیک",
                "consult": "مشاوره", "other": "سایر"}


def service_dict(db: Session, s: models.Service) -> dict:
    m = db.get(models.Member, s.member_id)
    return {"id": s.id, "no": s.no, "member_id": s.member_id,
            "member_name": m.full_name if m else "", "member_code": m.code if m else "",
            "sdate": s.sdate, "stype": s.stype, "stype_label": STYPE_LABELS.get(s.stype, s.stype),
            "title": s.title, "description": s.description,
            "qty": s.qty, "unit": s.unit, "unit_price": s.unit_price, "amount": s.amount,
            "calc_note": s.calc_note, "status": s.status,
            "comp_method": s.comp_method, "comp_date": s.comp_date, "comp_note": s.comp_note,
            "voucher_id": s.voucher_id, "credit_id": s.credit_id,
            "created_by": s.created_by, "approved_by": s.approved_by}


class ServiceBody(BaseModel):
    member_id: int
    sdate: str
    stype: str = "other"
    title: str
    description: str = ""
    qty: float | int
    unit: str = "ساعت"
    unit_price: int
    calc_note: str = ""


def _validate(body: ServiceBody):
    if not body.member_id:
        raise HTTPException(400, "عضو ارائه‌دهنده خدمت باید مشخص شود")
    if not (body.title or "").strip():
        raise HTTPException(400, "عنوان خدمت الزامی است")
    if not body.sdate:
        raise HTTPException(400, "تاریخ ارائه خدمت الزامی است")
    amount = int(float(body.qty) * body.unit_price)
    if amount <= 0:
        raise HTTPException(400, "مبلغ خدمت باید بزرگ‌تر از صفر باشد (تعداد × نرخ)")


@router.get("")
def list_services(status: str = "", member_id: int = 0,
                  user: dict = Depends(require()), db: Session = Depends(get_db)):
    rows = db.execute(select(models.Service).order_by(models.Service.id.desc())).scalars().all()
    if user["role"] == "member":
        rows = [s for s in rows if s.member_id == user["member_id"]]
    if status:
        rows = [s for s in rows if s.status == status]
    if member_id:
        rows = [s for s in rows if s.member_id == member_id]
    return [service_dict(db, s) for s in rows]


@router.post("")
def create_service(body: ServiceBody, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    _validate(body)
    amount = int(float(body.qty) * body.unit_price)
    s = models.Service(
        no=next_number(db, "service", body.sdate, {"service": "SV"}),
        member_id=body.member_id, sdate=body.sdate,
        stype=body.stype or "other", title=body.title.strip(),
        description=body.description or "", qty=int(float(body.qty)),
        unit=body.unit or "ساعت", unit_price=body.unit_price, amount=amount,
        calc_note=body.calc_note or "", status="draft",
        created_by=user["username"])
    db.add(s)
    db.flush()
    log(db, user, "create", "service", s.id, {"no": s.no, "amount": amount})
    db.commit()
    return service_dict(db, s)


@router.patch("/{sid}")
def update_service(sid: int, body: ServiceBody,
                   user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    s = db.get(models.Service, sid)
    if not s:
        raise HTTPException(404, "خدمت یافت نشد")
    if s.status != "draft":
        raise HTTPException(400, "فقط پیش‌نویس خدمت قابل ویرایش است")
    _validate(body)
    s.member_id = body.member_id
    s.sdate = body.sdate
    s.stype = body.stype or "other"
    s.title = body.title.strip()
    s.description = body.description or ""
    s.qty = int(float(body.qty))
    s.unit = body.unit or "ساعت"
    s.unit_price = body.unit_price
    s.amount = int(float(body.qty) * body.unit_price)
    s.calc_note = body.calc_note or ""
    log(db, user, "update", "service", s.id, {"no": s.no, "amount": s.amount})
    db.commit()
    return service_dict(db, s)


@router.delete("/{sid}")
def delete_service(sid: int, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    s = db.get(models.Service, sid)
    if not s:
        raise HTTPException(404, "خدمت یافت نشد")
    if s.status != "draft":
        raise HTTPException(400, "فقط پیش‌نویس قابل حذف است")
    db.delete(s)
    log(db, user, "delete", "service", sid, {})
    db.commit()
    return {"ok": True}


@router.post("/{sid}/submit")
def submit_service(sid: int, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    s = db.get(models.Service, sid)
    if not s:
        raise HTTPException(404, "خدمت یافت نشد")
    if s.status not in ("draft", "rejected"):
        raise HTTPException(400, "این خدمت در جریان بررسی است")
    s.status = "pending"
    log(db, user, "submit", "service", s.id, {"no": s.no})
    db.commit()
    return {"ok": True, "status": s.status}


class ApproveBody(BaseModel):
    comp_method: str = "credit"
    bank_id: int | None = None
    comp_date: str = ""
    note: str = ""
    decision: str | None = None  # reject


@router.post("/{sid}/approve")
def approve_service(sid: int, body: ApproveBody,
                    user: dict = Depends(require("ceo")),
                    db: Session = Depends(get_db)):
    guard_period(db, user)
    s = db.get(models.Service, sid)
    if not s:
        raise HTTPException(404, "خدمت یافت نشد")
    if s.status != "pending":
        raise HTTPException(400, "فقط خدمت «در انتظار تأیید» قابل تصمیم‌گیری است")
    m = db.get(models.Member, s.member_id)

    if body.decision == "reject":
        s.status = "rejected"
        s.comp_note = f"رد توسط {user['username']}: {body.note or ''}"
        log(db, user, "reject", "service", s.id, {"note": body.note})
        db.commit()
        return {"ok": True, "status": "rejected"}

    method = body.comp_method or "credit"
    if method not in ("credit", "cash"):
        raise HTTPException(400, "روش جبران نامعتبر است")
    taf = get_tafsil_for_member(db, s.member_id)
    if method == "credit":
        if not taf:
            raise HTTPException(400, "تفصیلی عضو یافت نشد")
        lines = [
            {"account_code": "51042", "debit": s.amount,
             "description": f"هزینه جبران خدمات عضو — {s.title}", "project_id": None},
            {"account_code": "2102", "tafsil_id": taf.id, "tafsil_name": m.full_name if m else "",
             "credit": s.amount, "description": "اعتبار جبران خدمات به جاری عضو منظور شد"},
        ]
    else:
        if not body.bank_id:
            raise HTTPException(400, "برای پرداخت نقدی، حساب بانکی/صندوق باید انتخاب شود")
        acc = get_tafsil_for_bank(db, body.bank_id)
        code = bank_account_code(db, body.bank_id)
        lines = [
            {"account_code": "51042", "debit": s.amount,
             "description": f"هزینه جبران خدمات عضو — {s.title}", "project_id": None},
            {"account_code": code, "tafsil_id": acc.id if acc else None,
             "tafsil_name": acc.name if acc else ("صندوق" if code == "1101" else ""),
             "credit": s.amount, "description": "پرداخت نقدی جبران خدمات"},
        ]
    v = post_voucher(db, vdate=body.comp_date or s.sdate,
                     description=f"جبران خدمات {s.no} — {m.full_name if m else ''} ({s.title})",
                     lines=lines, source_type="service", source_id=s.id,
                     idem_key=f"service:{s.id}", user=user)
    s.voucher_id = v.id
    s.status = "compensated"
    s.comp_method = method
    s.comp_date = body.comp_date or s.sdate
    s.comp_note = body.note or ("جبران از محل اعتبار حساب عضو" if method == "credit" else "پرداخت نقدی جبران خدمات")
    s.approved_by = user["username"]
    s.approved_at = datetime.now()
    if method == "credit":
        cr = models.OffsetCredit(member_id=s.member_id, expense_id=None,
                                 amount=s.amount, remaining=s.amount,
                                 note=f"جبران خدمات {s.no} — {s.title}")
        db.add(cr)
        db.flush()
        s.credit_id = cr.id
        st = get_settings(db)
        if st.auto_offset:
            cr.remaining = auto_allocate(db, member_id=s.member_id, amount=s.amount,
                                         credit_id=cr.id, user=user)
    log(db, user, "approve", "service", s.id,
        {"no": s.no, "amount": s.amount, "method": method})
    db.commit()
    return service_dict(db, s)


def _bank_moin_code(db: Session, bank_id: int) -> str:
    """کد معین بانک (مطابق bank_account_code در سرویس حسابداری)"""
    return bank_account_code(db, bank_id)
