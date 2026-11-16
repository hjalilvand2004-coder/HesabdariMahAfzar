# -*- coding: utf-8 -*-
"""هزینه‌ها: ثبت، ارسال برای تأیید، تأیید مدیریتی با تولید خودکار سند، تسویه فروشنده، پیوست‌ها"""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, UPLOAD_DIR
from .. import models
from ..services.accounting import (bank_account_code, get_or_create_party_tafsil,
                                   get_tafsil_for_bank, get_tafsil_for_member, log, next_number,
                                   post_voucher)
from ..services import financing
from .helpers import (attachment_dict, expense_dict, get_settings, guard_period, require)

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


@router.get("")
def list_expenses(q: str = "", status: str = "", pay_status: str = "",
                  date_from: str = "", date_to: str = "", project_id: int | None = None,
                  member_id: int | None = None,
                  user: dict = Depends(require()), db: Session = Depends(get_db)):
    s = get_settings(db)
    rows = db.execute(select(models.Expense).order_by(models.Expense.id.desc())).scalars().all()
    if user["role"] == "member":  # محدوده اطلاعات اعضا
        if s.member_sees_all_expenses:
            pass
        elif user["member_id"]:
            rows = [r for r in rows if r.payer_member_id == user["member_id"]]
        else:
            return []
    out = []
    for e in rows:
        if q and not (q in e.title or q in e.party_name or q in e.no or q in e.invoice_no):
            continue
        if status and e.appr_status != status:
            continue
        if pay_status and e.pay_status != pay_status:
            continue
        if date_from and e.exp_date < date_from:
            continue
        if date_to and e.exp_date > date_to:
            continue
        if project_id and e.project_id != project_id:
            continue
        if member_id and e.payer_member_id != member_id:
            continue
        out.append(expense_dict(db, e, with_atts=False))
    return out


@router.get("/dupcheck")
def dupcheck(invoice_no: str = "", party_name: str = "", total_amount: int = 0,
             user: dict = Depends(require("admin", "finance", "accountant")),
             db: Session = Depends(get_db)):
    """کنترل فاکتور/رسید تکراری"""
    hits = []
    for e in db.execute(select(models.Expense).where(
            models.Expense.appr_status != "rejected")).scalars():
        score = 0
        if invoice_no and e.invoice_no and e.invoice_no == invoice_no.strip():
            score += 2
        if party_name and e.party_name == party_name.strip() and \
                total_amount and e.total_amount == total_amount:
            score += 3
        elif party_name and e.party_name == party_name.strip() and total_amount and \
                abs(e.total_amount - total_amount) <= max(1, total_amount // 10000):
            score += 2
        if score >= 2:
            hits.append({"id": e.id, "no": e.no, "title": e.title, "date": e.exp_date,
                         "party_name": e.party_name, "invoice_no": e.invoice_no,
                         "total_amount": e.total_amount, "score": score})
    return {"duplicates": hits}


class ExpenseBody(BaseModel):
    exp_date: str
    title: str
    description: str = ""
    base_amount: int = 0
    tax_amount: int = 0
    party_name: str = ""
    category_code: str = "51091"
    project_id: int | None = None
    payer_type: str = "company"
    payer_member_id: int | None = None
    paid_via: str = "bank"
    bank_id: int | None = None
    pay_status: str = "unpaid"
    invoice_no: str = ""
    asset_kind: str = "expense"
    note: str = ""


def _total(body: ExpenseBody) -> int:
    return int(body.base_amount) + int(body.tax_amount)


@router.post("")
def create_expense(body: ExpenseBody, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    if _total(body) <= 0:
        raise HTTPException(400, "مبلغ هزینه باید بزرگ‌تر از صفر باشد")
    if body.payer_type == "member" and not body.payer_member_id:
        raise HTTPException(400, "پرداخت‌کننده عضو باید مشخص شود")
    if body.payer_type == "member":
        body.pay_status = "paid"
    e = models.Expense(
        no=next_number(db, "expense", body.exp_date, {"expense": "H"}),
        exp_date=body.exp_date, entry_date=_today(),
        title=body.title, description=body.description,
        base_amount=body.base_amount, tax_amount=body.tax_amount, total_amount=_total(body),
        party_name=body.party_name, category_code=body.category_code,
        project_id=body.project_id, payer_type=body.payer_type,
        payer_member_id=body.payer_member_id if body.payer_type == "member" else None,
        paid_via=body.paid_via, bank_id=body.bank_id,
        pay_status=body.pay_status, appr_status="draft",
        invoice_no=body.invoice_no, asset_kind=body.asset_kind, note=body.note,
        created_by=user["username"])
    db.add(e)
    db.flush()
    log(db, user, "create", "expense", e.id, {"no": e.no, "total": e.total_amount})
    db.commit()
    return expense_dict(db, e)


def _today() -> str:
    from ..jalali import today_iso
    return today_iso()


@router.get("/{eid}")
def get_expense(eid: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if user["role"] == "member" and e.payer_member_id != user["member_id"]:
        s = get_settings(db)
        if not s.member_sees_all_expenses:
            raise HTTPException(403, "دسترسی به این هزینه مجاز نیست")
    return expense_dict(db, e)


@router.patch("/{eid}")
def update_expense(eid: int, body: ExpenseBody,
                   user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if e.appr_status == "approved":
        raise HTTPException(400, "هزینه تأییدشده قابل ویرایش نیست؛ اصلاح فقط با سند ابطال/اصلاحی انجام می‌شود")
    before = {"title": e.title, "total_amount": e.total_amount, "payer": e.payer_type}
    e.exp_date = body.exp_date
    e.title = body.title
    e.description = body.description
    e.base_amount = body.base_amount
    e.tax_amount = body.tax_amount
    e.total_amount = _total(body)
    e.party_name = body.party_name
    e.category_code = body.category_code
    e.project_id = body.project_id
    e.payer_type = body.payer_type
    e.payer_member_id = body.payer_member_id if body.payer_type == "member" else None
    e.paid_via = body.paid_via
    e.bank_id = body.bank_id
    if body.payer_type == "member":
        e.pay_status = "paid"
    else:
        e.pay_status = body.pay_status if e.paid_amount == 0 else e.pay_status
    e.invoice_no = body.invoice_no
    e.asset_kind = body.asset_kind
    e.note = body.note
    log(db, user, "update", "expense", eid, {"before": before, "after": {"title": e.title,
        "total_amount": e.total_amount}})
    db.commit()
    return expense_dict(db, e)


@router.delete("/{eid}")
def delete_expense(eid: int, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if e.appr_status != "draft":
        raise HTTPException(400, "فقط پیش‌نویس قابل حذف است")
    db.delete(e)
    log(db, user, "delete", "expense", eid, {"no": e.no})
    db.commit()
    return {"ok": True}


@router.post("/{eid}/submit")
def submit(eid: int, user: dict = Depends(require("admin", "finance", "accountant")),
           db: Session = Depends(get_db)):
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if e.appr_status not in ("draft", "rejected"):
        raise HTTPException(400, "این هزینه در جریان تأیید است")
    e.appr_status = "pending"
    log(db, user, "submit", "expense", eid, {"no": e.no})
    db.commit()
    return {"ok": True, "status": e.appr_status}


class ApproveBody(BaseModel):
    decision: str  # approve | reject
    note: str = ""


@router.post("/{eid}/approve")
def approve(eid: int, body: ApproveBody,
            user: dict = Depends(require("ceo")),
            db: Session = Depends(get_db)):
    """تأیید مدیریتی — پس از تأیید، سند حسابداری به‌صورت خودکار تولید می‌شود"""
    guard_period(db, user)
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if e.appr_status != "pending":
        raise HTTPException(400, "فقط هزینه «در انتظار تأیید» قابل تصمیم‌گیری است")
    if body.decision == "reject":
        e.appr_status = "rejected"
        e.note = (e.note + "\n" if e.note else "") + f"رد توسط {user['username']}: {body.note}"
        log(db, user, "reject", "expense", eid, {"note": body.note})
        db.commit()
        return {"ok": True, "status": "rejected"}
    e.appr_status = "approved"
    e.approved_by = user["username"]
    from datetime import datetime
    e.approved_at = datetime.now()
    _post_expense_voucher(db, e, user)
    db.commit()
    return {"ok": True, "status": "approved"}


def _post_expense_voucher(db: Session, e: models.Expense, user):
    """سند هزینه: بدهکار = هزینه/دارایی، بستانکار = بانک/صندوق/پرداختنی/جاری عضو"""
    # سمت بدهکار
    if e.asset_kind == "asset":
        dr_code = "1301"
    elif e.asset_kind == "deposit":
        dr_code = "1201"
    else:
        dr_code = e.category_code
    dr_line = {"account_code": dr_code, "debit": e.total_amount,
               "description": f"{e.no} — {e.title}", "project_id": e.project_id}
    # سمت بستانکار
    desc = f"ثبت هزینه {e.no} — {e.title}"
    if e.payer_type == "member":
        m = db.get(models.Member, e.payer_member_id)
        taf = get_tafsil_for_member(db, e.payer_member_id)
        cr_line = {"account_code": "2102", "tafsil_id": taf.id if taf else None,
                   "tafsil_name": m.full_name if m else "", "credit": e.total_amount,
                   "description": f"پرداخت {m.full_name if m else ''} از حساب شخصی"}
        lines = [dr_line, cr_line]
    elif e.pay_status == "paid" and e.paid_amount >= e.total_amount:
        acc = bank_account_code(db, e.bank_id)
        bt = get_tafsil_for_bank(db, e.bank_id) if e.bank_id else None
        cr_line = {"account_code": acc, "tafsil_id": bt.id if bt else None,
                   "tafsil_name": bt.name if bt else ("صندوق" if acc == "1101" else ""),
                   "credit": e.total_amount, "description": "پرداخت از حساب شرکت"}
        lines = [dr_line, cr_line]
    else:
        pt = get_or_create_party_tafsil(db, e.party_name or "طرف حساب")
        cr_line = {"account_code": "2101", "tafsil_id": pt.id, "tafsil_name": pt.name,
                   "credit": e.total_amount, "description": f"بدهی به {pt.name}"}
        lines = [dr_line, cr_line]
    v = post_voucher(db, vdate=e.exp_date, description=desc, lines=lines,
                     source_type="expense", source_id=e.id, idem_key=f"exp:{e.id}", user=user)
    # اعتبار عضو بابت پرداخت شخصی + تهاتر اختیاری
    if e.payer_type == "member":
        cr = models.OffsetCredit(member_id=e.payer_member_id, expense_id=e.id,
                                 amount=e.total_amount, remaining=e.total_amount,
                                 note=f"هزینه {e.no} پرداخت‌شده توسط عضو")
        db.add(cr)
        db.flush()
        s = get_settings(db)
        if s.auto_offset:
            left = financing.auto_allocate(db, member_id=e.payer_member_id, amount=e.total_amount,
                                           credit_id=cr.id, user=user)
            cr.remaining = left
    return v


class SettleBody(BaseModel):
    amount: int
    date: str
    via: str = "bank"       # bank | cash
    bank_id: int | None = None
    note: str = ""


@router.post("/{eid}/settle")
def settle(eid: int, body: SettleBody,
           user: dict = Depends(require("admin", "finance", "accountant")),
           db: Session = Depends(get_db)):
    """تسویه بدهی هزینه نسیه به فروشنده (چند پرداخت به یک هزینه مجاز است)"""
    guard_period(db, user)
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if e.appr_status != "approved":
        raise HTTPException(400, "فقط هزینه تأییدشده قابل تسویه است")
    if e.payer_type == "member":
        raise HTTPException(400, "هزینه پرداخت‌شده توسط عضو نیازی به تسویه ندارد")
    remaining = e.total_amount - e.paid_amount
    if body.amount <= 0 or body.amount > remaining:
        raise HTTPException(400, f"مبلغ باید بین ۱ و {remaining:,} ریال باشد")
    pt = get_or_create_party_tafsil(db, e.party_name or "طرف حساب")
    acc = bank_account_code(db, body.bank_id if body.via == "bank" else None) if body.via == "bank" else "1101"
    bt = get_tafsil_for_bank(db, body.bank_id) if (body.via == "bank" and body.bank_id) else None
    seq = db.execute(select(models.Voucher.id).where(models.Voucher.idem_key.like(f"expsettle:{e.id}:%"))).all()
    key = f"expsettle:{e.id}:{len(seq) + 1}"
    post_voucher(db, vdate=body.date, description=f"تسویه هزینه {e.no} — {e.title}",
                 lines=[{"account_code": "2101", "tafsil_id": pt.id, "tafsil_name": pt.name,
                         "debit": body.amount, "description": f"پرداخت به {pt.name}"},
                        {"account_code": acc, "tafsil_id": bt.id if bt else None,
                         "tafsil_name": bt.name if bt else ("صندوق" if acc == "1101" else ""),
                         "credit": body.amount, "description": "پرداخت از حساب شرکت"}],
                 source_type="expense_settle", source_id=e.id, idem_key=key, user=user)
    e.paid_amount += body.amount
    e.pay_status = "paid" if e.paid_amount >= e.total_amount else "partial"
    log(db, user, "settle", "expense", eid, {"amount": body.amount, "date": body.date})
    db.commit()
    return expense_dict(db, e)


@router.post("/{eid}/attachments")
async def upload_attachment(eid: int, file: UploadFile = File(...),
                            user: dict = Depends(require("admin", "finance", "accountant", "member")),
                            db: Session = Depends(get_db)):
    e = db.get(models.Expense, eid)
    if not e:
        raise HTTPException(404, "هزینه یافت نشد")
    if user["role"] == "member" and e.payer_member_id != user["member_id"]:
        raise HTTPException(403, "دسترسی مجاز نیست")
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(400, "حجم فایل باید کمتر از ۸ مگابایت باشد")
    ext = os.path.splitext(file.filename or "")[1][:10]
    fname = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
        f.write(content)
    a = models.Attachment(entity_type="expense", entity_id=eid, name=file.filename or "file",
                          size=len(content), mime=file.content_type or "", path=fname,
                          uploaded_by=user["username"])
    db.add(a)
    db.flush()
    log(db, user, "upload", "attachment", a.id, {"expense": e.no, "name": a.name})
    db.commit()
    return attachment_dict(a)


@router.delete("/{eid}/attachments/{att_id}")
def delete_attachment(eid: int, att_id: int,
                      user: dict = Depends(require("admin", "finance", "accountant")),
                      db: Session = Depends(get_db)):
    a = db.get(models.Attachment, att_id)
    if not a or a.entity_id != eid:
        raise HTTPException(404, "پیوست یافت نشد")
    p = os.path.join(UPLOAD_DIR, a.path)
    if os.path.exists(p):
        os.remove(p)
    db.delete(a)
    db.commit()
    return {"ok": True}
