# -*- coding: utf-8 -*-
"""پرداخت‌های اعضا: اعلام پرداخت ← تأیید وصول ← تخصیص به تعهد ← سند خودکار"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import (bank_account_code, get_tafsil_for_bank,
                                   get_tafsil_for_member, log, next_number, post_voucher)
from ..services import financing
from .helpers import get_settings, guard_period, payment_dict, require

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.get("")
def list_payments(status: str = "", member_id: int | None = None,
                  user: dict = Depends(require()), db: Session = Depends(get_db)):
    rows = db.execute(select(models.Payment).order_by(models.Payment.id.desc())).scalars().all()
    if user["role"] == "member":
        rows = [p for p in rows if p.member_id == user["member_id"]]
    if status:
        rows = [p for p in rows if p.status == status]
    if member_id:
        rows = [p for p in rows if p.member_id == member_id]
    return [payment_dict(db, p) for p in rows]


class DeclareBody(BaseModel):
    pay_date: str
    member_id: int | None = None
    amount: int
    method: str = "transfer"
    bank_id: int | None = None
    tracking_no: str = ""
    receipt_ref: str = ""
    funding_id: int | None = None
    note: str = ""


@router.post("")
def declare(body: DeclareBody, user: dict = Depends(require()),
            db: Session = Depends(get_db)):
    """اعلام پرداخت توسط عضو یا ثبت توسط حسابداری — هنوز وصول نشده است"""
    guard_period(db, user)
    member_id = body.member_id
    if user["role"] == "member":
        if not user["member_id"]:
            raise HTTPException(403, "کاربر شما به عضوی متصل نیست")
        member_id = user["member_id"]
    if not member_id:
        raise HTTPException(400, "پرداخت‌کننده باید مشخص شود")
    if body.amount <= 0:
        raise HTTPException(400, "مبلغ باید مثبت باشد")
    m = db.get(models.Member, member_id)
    if not m:
        raise HTTPException(404, "عضو یافت نشد")
    p = models.Payment(
        no=next_number(db, "payment", body.pay_date, {"payment": "P"}),
        pay_date=body.pay_date, member_id=member_id, amount=body.amount,
        method=body.method, bank_id=body.bank_id, tracking_no=body.tracking_no,
        receipt_ref=body.receipt_ref, funding_id=body.funding_id, note=body.note,
        status="declared", declared_by=user["username"])
    db.add(p)
    db.flush()
    log(db, user, "declare", "payment", p.id, {"no": p.no, "amount": p.amount})
    db.commit()
    return payment_dict(db, p)


class ApproveBody(BaseModel):
    decision: str = "approve"  # approve | reject
    note: str = ""


@router.post("/{pid}/approve")
def approve(pid: int, body: ApproveBody,
            user: dict = Depends(require("finance", "admin")),
            db: Session = Depends(get_db)):
    """تأیید وصول: سند حسابداری خودکار + تخصیص خودکار به تعهدات (FIFO)"""
    guard_period(db, user)
    p = db.get(models.Payment, pid)
    if not p:
        raise HTTPException(404, "پرداخت یافت نشد")
    if p.status != "declared":
        raise HTTPException(400, "فقط پرداخت «اعلام‌شده» قابل تأیید است")
    if body.decision == "reject":
        p.status = "rejected"
        p.note = (p.note + "\n" if p.note else "") + f"رد توسط {user['username']}: {body.note}"
        log(db, user, "reject", "payment", pid, {"note": body.note})
        db.commit()
        return {"ok": True, "status": "rejected"}
    p.status = "approved"
    p.approved_by = user["username"]
    from datetime import datetime
    p.approved_at = datetime.now()
    _post_payment_voucher(db, p, user)
    s = get_settings(db)
    if s.auto_offset:
        financing.auto_allocate(db, member_id=p.member_id, amount=p.amount,
                                payment_id=p.id, funding_id=p.funding_id, user=user)
    db.commit()
    return payment_dict(db, p)


def _post_payment_voucher(db: Session, p: models.Payment, user):
    """سند وصول: بدهکار بانک/صندوق، بستانکار بر اساس نوع تأمین مالی"""
    acc = "1101" if p.method == "cash" else bank_account_code(db, p.bank_id)
    bt = get_tafsil_for_bank(db, p.bank_id) if (p.method != "cash" and p.bank_id) else None
    m = db.get(models.Member, p.member_id)
    taf = get_tafsil_for_member(db, p.member_id)
    ftype = "current"
    if p.funding_id:
        f = db.get(models.FundingRequest, p.funding_id)
        ftype = f.ftype if f else "current"
    cr_code = {"current": "2102", "loan": "2103", "capital": "3101"}.get(ftype, "2102")
    lines = [
        {"account_code": acc, "tafsil_id": bt.id if bt else None,
         "tafsil_name": bt.name if bt else ("صندوق" if acc == "1101" else ""),
         "debit": p.amount, "description": f"وصول {p.no} از {m.full_name}"},
        {"account_code": cr_code, "tafsil_id": taf.id if taf else None,
         "tafsil_name": m.full_name if m else "", "credit": p.amount,
         "description": {"current": "جاری عضو", "loan": "وام عضو به شرکت",
                         "capital": "افزایش سرمایه"}[ftype]},
    ]
    v = post_voucher(db, vdate=p.pay_date, description=f"وصول پرداخت {p.no} — {m.full_name}",
                     lines=lines, source_type="payment", source_id=p.id,
                     idem_key=f"pay:{p.id}", user=user)
    p.voucher_id = v.id
    return v


class AllocBody(BaseModel):
    target: str = "payment"   # payment | credit
    id: int
    commitment_id: int
    amount: int


@router.post("/allocate")
def allocate(body: AllocBody, user: dict = Depends(require("finance", "admin", "accountant")),
             db: Session = Depends(get_db)):
    """تخصیص دستی مبلغ به یک تعهد مشخص"""
    guard_period(db, user)
    c = db.get(models.Commitment, body.commitment_id)
    if not c:
        raise HTTPException(404, "تعهد یافت نشد")
    taken = financing.allocate_amount(db, commitment=c, amount=body.amount,
                                      payment_id=body.id if body.target == "payment" else None,
                                      credit_id=body.id if body.target == "credit" else None,
                                      user=user)
    db.commit()
    return {"allocated": taken}


class AutoAllocBody(BaseModel):
    target: str = "payment"
    id: int


@router.post("/auto-allocate")
def auto_allocate(body: AutoAllocBody,
                  user: dict = Depends(require("finance", "admin", "accountant")),
                  db: Session = Depends(get_db)):
    """تخصیص خودکار FIFO مبلغ باقی‌مانده به تعهدهای باز عضو"""
    guard_period(db, user)
    if body.target == "payment":
        p = db.get(models.Payment, body.id)
        if not p:
            raise HTTPException(404, "پرداخت یافت نشد")
        alloc = sum(a.amount for a in db.execute(select(models.Allocation).where(
            models.Allocation.payment_id == p.id)).scalars())
        left = financing.auto_allocate(db, member_id=p.member_id, amount=p.amount - alloc,
                                       payment_id=p.id, funding_id=p.funding_id, user=user)
    else:
        cr = db.get(models.OffsetCredit, body.id)
        if not cr:
            raise HTTPException(404, "اعتبار یافت نشد")
        left = financing.auto_allocate(db, member_id=cr.member_id, amount=cr.remaining,
                                       credit_id=cr.id, user=user)
        cr.remaining = left
    db.commit()
    return {"unallocated": left}
