# -*- coding: utf-8 -*-
"""کیف پول اعضا — شارژ از درگاه بانک ملی یا اعلام واریز دستی، تسویه تعهدات از موجودی
بازگشت از درگاه: نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس ثبت می‌شود"""
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
from ..services.financing import (allocate_amount, auto_allocate,
                                  commitment_paid_actual, member_statement, open_commitments)
from ..jalali import today_iso
from .helpers import get_settings, guard_period, require

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


def wallet_balance(db: Session, member_id: int) -> int:
    """موجودی کیف پول = شارژهای تأییدشده − استفاده‌ها (تسویه/برداشت)"""
    txs = db.execute(select(models.WalletTx).where(
        models.WalletTx.member_id == member_id)).scalars().all()
    charges = sum(t.amount for t in txs if t.type == "charge" and t.status == "approved")
    used = sum(t.amount for t in txs if t.type in ("settle", "spend"))
    return charges - used


def wallet_dict(db: Session, w: models.WalletTx) -> dict:
    m = db.get(models.Member, w.member_id)
    commitment_no = ""
    if w.commitment_id:
        c = db.get(models.Commitment, w.commitment_id)
        if c:
            f = db.get(models.FundingRequest, c.funding_id)
            commitment_no = f.no if f else ""
    return {"id": w.id, "no": w.no, "wdate": w.wdate, "member_id": w.member_id,
            "member_name": m.full_name if m else "", "type": w.type, "amount": w.amount,
            "method": w.method, "gateway": w.gateway, "bank_id": w.bank_id,
            "tracking_no": w.tracking_no, "gateway_ref": w.gateway_ref, "note": w.note,
            "purpose": w.purpose, "commitment_id": w.commitment_id,
            "commitment_no": commitment_no, "status": w.status,
            "approved_by": w.approved_by, "voucher_id": w.voucher_id}


def post_wallet_charge(db: Session, w: models.WalletTx, user) -> models.OffsetCredit:
    """سند شارژ کیف پول: بدهکار بانک / بستانکار جاری عضو + ردیف اعتبار"""
    m = db.get(models.Member, w.member_id)
    taf = get_tafsil_for_member(db, w.member_id)
    acc_code = bank_account_code(db, w.bank_id)
    bt = get_tafsil_for_bank(db, w.bank_id) if w.bank_id else None
    v = post_voucher(db, vdate=w.wdate,
                     description=(f"شارژ کیف پول {w.no} — {m.full_name if m else ''}"
                                  + (f" (درگاه بانک ملی، مرجع {w.gateway_ref})" if w.gateway_ref else "")),
                     lines=[
                         {"account_code": acc_code, "tafsil_id": bt.id if bt else None,
                          "tafsil_name": bt.name if bt else ("" if acc_code != "1101" else "صندوق"),
                          "debit": w.amount, "description": "واریز به حساب شرکت"},
                         {"account_code": "2102", "tafsil_id": taf.id if taf else None,
                          "tafsil_name": m.full_name if m else "",
                          "credit": w.amount, "description": "شارژ کیف پول عضو — مطالبه عضو از شرکت"},
                     ],
                     source_type="wallet", source_id=w.id, idem_key=f"wallet:{w.id}", user=user)
    w.voucher_id = v.id
    cr = models.OffsetCredit(member_id=w.member_id, expense_id=None,
                             amount=w.amount, remaining=w.amount,
                             note=f"شارژ کیف پول {w.no}")
    db.add(cr)
    db.flush()
    return cr


@router.get("")
def get_wallet(member_id: int = 0, user: dict = Depends(require()),
               db: Session = Depends(get_db)):
    if user["role"] == "member":
        mid = user["member_id"]
        st = member_statement(db, mid)
        txs = db.execute(select(models.WalletTx).where(
            models.WalletTx.member_id == mid).order_by(models.WalletTx.id.desc())).scalars().all()
        return {
            "balance": wallet_balance(db, mid),
            "txs": [wallet_dict(db, w) for w in txs],
            "commitments": [c for c in st["commitments"] if c["remaining"] > 0],
        }
    q = db.execute(select(models.WalletTx).order_by(models.WalletTx.id.desc())).scalars().all()
    txs = [wallet_dict(db, w) for w in q]
    if member_id:
        txs = [w for w in txs if w["member_id"] == member_id]
    members = []
    for m in db.execute(select(models.Member)).scalars().all():
        pending = db.execute(select(models.WalletTx).where(
            models.WalletTx.member_id == m.id, models.WalletTx.type == "charge",
            models.WalletTx.status == "pending")).scalars().all()
        members.append({
            "member_id": m.id, "full_name": m.full_name, "code": m.code,
            "balance": wallet_balance(db, m.id),
            "pending": sum(w.amount for w in pending),
        })
    return {"balance": None, "txs": txs, "members": members}


class ChargeBody(BaseModel):
    member_id: int | None = None
    amount: int
    wdate: str
    method: str = "manual"
    bank_id: int | None = None
    tracking_no: str = ""
    note: str = ""
    commitment_id: int | None = None


@router.post("/charge")
def charge_wallet(body: ChargeBody, user: dict = Depends(require()),
                  db: Session = Depends(get_db)):
    guard_period(db, user)
    mid = user["member_id"] if user["role"] == "member" else body.member_id
    if not mid:
        raise HTTPException(400, "عضو باید مشخص شود")
    amount = int(body.amount or 0)
    if amount <= 0:
        raise HTTPException(400, "مبلغ شارژ باید بزرگ‌تر از صفر باشد")
    if not body.wdate:
        raise HTTPException(400, "تاریخ شارژ الزامی است")
    method = "gateway" if body.method == "gateway" else "manual"
    if method == "manual" and not body.bank_id:
        raise HTTPException(400, "برای اعلام واریز دستی، حساب بانکی باید انتخاب شود")
    w = models.WalletTx(
        no=next_number(db, "wallet", body.wdate, {"wallet": "WLT"}),
        wdate=body.wdate, member_id=mid, type="charge", amount=amount,
        method=method, gateway="melli" if method == "gateway" else None,
        bank_id=body.bank_id, tracking_no=body.tracking_no or "",
        note=body.note or ("شارژ کیف پول از درگاه بانک ملی" if method == "gateway"
                           else "اعلام شارژ کیف پول — واریز دستی"),
        purpose="commitment" if body.commitment_id else None,
        commitment_id=body.commitment_id,
        status="pending", created_by=user["username"])
    db.add(w)
    db.flush()
    log(db, user, "create", "wallet", w.id, {"no": w.no, "amount": amount, "method": method})
    db.commit()
    out = wallet_dict(db, w)
    if method == "gateway":
        # نقطه اتصال به وب‌سرویس بانک ملی — در استقرار واقعی url درگاه رسمی برگردانده می‌شود
        out["gateway_url"] = f"#/gateway?tx={w.id}"
        out["gateway_mode"] = "simulator"
    return out


@router.get("/tx/{tx_id}")
def get_tx(tx_id: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    w = db.get(models.WalletTx, tx_id)
    if not w:
        raise HTTPException(404, "تراکنش کیف پول یافت نشد")
    if user["role"] == "member" and w.member_id != user["member_id"]:
        raise HTTPException(403, "فقط تراکنش‌های خودتان قابل مشاهده است")
    st = get_settings(db)
    out = wallet_dict(db, w)
    out.update({"merchant": st.company_name, "order_no": w.no,
                "gateway_label": "بانک ملی ایران — درگاه پرداخت اینترنتی"})
    return out


class TxDecisionBody(BaseModel):
    decision: str | None = None  # reject
    bank_id: int | None = None
    note: str = ""


@router.post("/charges/{tx_id}/approve")
def approve_charge(tx_id: int, body: TxDecisionBody,
                   user: dict = Depends(require("finance", "admin")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    w = db.get(models.WalletTx, tx_id)
    if not w:
        raise HTTPException(404, "تراکنش کیف پول یافت نشد")
    if w.status != "pending":
        raise HTTPException(400, "این تراکنش در جریان بررسی است")
    if body.decision == "reject":
        w.status = "rejected"
        w.approved_by = user["username"]
        w.note += f" — رد توسط {user['username']}: {body.note or ''}"
        log(db, user, "reject", "wallet", w.id, {"no": w.no})
        db.commit()
        return {"ok": True, "status": "rejected"}
    if w.type != "charge":
        raise HTTPException(400, "فقط شارژ قابل تأیید است")
    w.status = "approved"
    w.approved_by = user["username"]
    cr = post_wallet_charge(db, w, user)
    log(db, user, "approve", "wallet", w.id,
        {"no": w.no, "amount": w.amount, "voucher": w.voucher_id})
    db.commit()
    return {"ok": True, "status": "approved", "balance": wallet_balance(db, w.member_id),
            "credit_id": cr.id, "voucher_id": w.voucher_id}


class SettleBody(BaseModel):
    member_id: int | None = None
    amount: int | None = None


@router.post("/settle")
def settle_wallet(body: SettleBody, user: dict = Depends(require()),
                  db: Session = Depends(get_db)):
    guard_period(db, user)
    mid = user["member_id"] if user["role"] == "member" else body.member_id
    if not mid:
        raise HTTPException(400, "عضو باید مشخص شود")
    balance = wallet_balance(db, mid)
    if balance <= 0:
        raise HTTPException(400, "موجودی کیف پول برای تسویه صفر است")
    open_list = open_commitments(db, mid)
    left = min(int(body.amount), balance) if body.amount else balance
    if left <= 0:
        raise HTTPException(400, "مبلغ تسویه نامعتبر است")
    today = today_iso()
    w = models.WalletTx(
        no=next_number(db, "wallet", today, {"wallet": "WLT"}),
        wdate=today, member_id=mid, type="settle", amount=left,
        method="wallet", gateway=None, bank_id=None, tracking_no="",
        note="تسویه تعهدات مصوب از موجودی کیف پول",
        purpose=None, commitment_id=None, status="approved",
        approved_by=user["username"], created_by=user["username"])
    db.add(w)
    db.flush()
    # اعتبارِ «شارژ کیف پول» عضو به ترتیب مصرف می‌شود
    credits = db.execute(select(models.OffsetCredit).where(
        models.OffsetCredit.member_id == mid,
        models.OffsetCredit.remaining > 0,
        models.OffsetCredit.note.like("شارژ کیف پول%")).order_by(models.OffsetCredit.id)).scalars().all()
    allocated_total = 0
    for c in open_list:
        if left <= 0:
            break
        remaining_c = c.amount - commitment_paid_actual(db, c)
        if remaining_c <= 0:
            continue
        wallet_credit = next((cr for cr in credits if cr.remaining > 0), None)
        if not wallet_credit:
            break
        take = min(left, remaining_c, wallet_credit.remaining)
        allocate_amount(db, commitment=c, amount=take, credit_id=wallet_credit.id, user=user)
        wallet_credit.remaining -= take
        left -= take
        allocated_total += take
    if allocated_total <= 0:
        db.rollback()
        raise HTTPException(400, "تعهد باز قابل تسویه یافت نشد")
    w.amount = allocated_total
    log(db, user, "settle", "wallet", w.id, {"no": w.no, "amount": allocated_total})
    db.commit()
    return {"ok": True, "allocated": allocated_total, "balance": wallet_balance(db, mid),
            "tx": wallet_dict(db, w)}


class GatewayVerifyBody(BaseModel):
    tx_id: int
    result: str  # ok | cancel | failed
    ref: str = ""


@router.post("/gateway/verify")
def gateway_verify(body: GatewayVerifyBody, user: dict = Depends(require()),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    w = db.get(models.WalletTx, body.tx_id)
    if not w:
        raise HTTPException(404, "تراکنش کیف پول یافت نشد")
    if user["role"] == "member" and w.member_id != user["member_id"]:
        raise HTTPException(403, "دسترسی مجاز نیست")
    if w.status != "pending":
        raise HTTPException(400, "این تراکنش قبلاً نتیجه‌گیری شده است")
    if w.method != "gateway":
        raise HTTPException(400, "این تراکنش از طریق درگاه آغاز نشده است")
    if body.result != "ok":
        w.status = "rejected" if body.result == "cancel" else "failed"
        w.note += " — انصراف کاربر از پرداخت" if body.result == "cancel" else " — پرداخت ناموفق در بانک"
        log(db, user, "update", "wallet", w.id, {"no": w.no, "result": body.result})
        db.commit()
        return {"ok": False, "status": w.status,
                "message": "پرداخت لغو شد" if w.status == "rejected" else "پرداخت ناموفق بود"}
    if not body.ref:
        raise HTTPException(400, "شماره مرجع بانکی برای تأیید الزامی است")
    # در استقرار واقعی: اینجا Verify وب‌سرویس بانک ملی (مطابقت مبلغ و توکن) فراخوانی می‌شود
    w.status = "approved"
    w.gateway_ref = body.ref
    w.approved_by = "gateway-melli"
    w.approved_at = datetime.now()
    cr = post_wallet_charge(db, w, user)
    allocated = 0
    if w.commitment_id:
        # پرداخت مستقیم هزینه/تعهد از کارتابل: بلافاصله از کیف پول به تعهد تخصیص می‌یابد
        target = db.get(models.Commitment, w.commitment_id)
        if target:
            take = min(target.amount - commitment_paid_actual(db, target), cr.remaining)
            if take > 0:
                allocated = allocate_amount(db, commitment=target, amount=take,
                                            credit_id=cr.id, user=user)
                cr.remaining -= allocated
            if allocated > 0:
                s = models.WalletTx(
                    no=next_number(db, "wallet", today_iso(), {"wallet": "WLT"}),
                    wdate=today_iso(), member_id=w.member_id, type="settle",
                    amount=allocated, method="wallet", gateway=None, bank_id=None,
                    tracking_no="", gateway_ref=body.ref,
                    note=f"تسویه تعهد مصوبه با شارژ {w.no} — پرداخت آنلاین بانک ملی",
                    purpose=None, commitment_id=target.id, status="approved",
                    approved_by=user["username"], created_by=user["username"])
                db.add(s)
                db.flush()
    log(db, user, "approve", "wallet", w.id,
        {"no": w.no, "amount": w.amount, "ref": body.ref, "allocated": allocated})
    db.commit()
    return {
        "ok": True, "status": "approved", "ref": body.ref, "amount": w.amount,
        "allocated": allocated, "balance": wallet_balance(db, w.member_id),
        "message": (f"پرداخت موفق — مبلغ به تعهد مصوب تخصیص یافت ({allocated:,} ریال)"
                    if allocated > 0 else "شارژ کیف پول با موفقیت انجام شد"),
    }
