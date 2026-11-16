# -*- coding: utf-8 -*-
"""ابزارهای مشترک روترها: احراز هویت، کنترل نقش، سریالایز و کنترل دوره مالی"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..security import decode_token, ROLE_LABELS
from ..services.accounting import log  # noqa: F401 — بازصادرات برای روترها


def _secret(db: Session) -> str:
    s = db.execute(select(models.Setting).where(models.Setting.id == 1)).scalar_one_or_none()
    return s.secret if s else ""


def get_current_user(authorization: str | None = Header(default=None),
                     db: Session = Depends(get_db)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "ورود لازم است")
    payload = decode_token(authorization[7:], _secret(db))
    if not payload:
        raise HTTPException(401, "نشست نامعتبر یا منقضی است")
    user = db.get(models.User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(401, "کاربر غیرفعال است")
    return {"id": user.id, "username": user.username, "full_name": user.full_name,
            "role": user.role, "member_id": user.member_id}


def require(*roles: str):
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if roles and user["role"] not in roles:
            raise HTTPException(403, "این عملیات با نقش شما مجاز نیست")
        return user
    return dep


def get_settings(db: Session) -> models.Setting:
    s = db.execute(select(models.Setting).where(models.Setting.id == 1)).scalar_one_or_none()
    if s is None:
        s = models.Setting(id=1)
        db.add(s)
        db.flush()
    return s


def guard_period(db: Session, user: dict):
    """در دوره بسته فقط مدیر سامانه مجاز به تغییر است"""
    s = get_settings(db)
    if s.period_closed and user["role"] != "admin":
        raise HTTPException(403, "دوره مالی بسته است؛ ثبت یا تغییر با مجوز ویژه (مدیر سامانه) امکان‌پذیر است")


def role_label(role: str) -> str:
    return ROLE_LABELS.get(role, role)


# ---------------- سریالایز ----------------

def member_dict(m: models.Member) -> dict:
    return {"id": m.id, "code": m.code, "full_name": m.full_name, "kind": m.kind,
            "national_id": m.national_id, "phone": m.phone, "email": m.email,
            "bank_account": m.bank_account, "note": m.note, "is_active": m.is_active}


def share_dict(s: models.Share) -> dict:
    return {"id": s.id, "member_id": s.member_id, "percent_bp": s.percent_bp,
            "from_date": s.from_date, "to_date": s.to_date,
            "doc_ref": s.doc_ref, "note": s.note}


def account_dict(a: models.Account) -> dict:
    return {"id": a.id, "code": a.code, "name": a.name, "level": a.level,
            "parent_code": a.parent_code, "acc_type": a.acc_type,
            "nature": a.nature, "is_active": a.is_active}


def bank_dict(b: models.BankAccount, tafsil_name: str = "") -> dict:
    return {"id": b.id, "name": b.name, "bank_name": b.bank_name,
            "account_no": b.account_no, "kind": b.kind, "is_active": b.is_active,
            "tafsil_name": tafsil_name}


def project_dict(p: models.Project) -> dict:
    return {"id": p.id, "name": p.name, "is_active": p.is_active}


def expense_dict(db: Session, e: models.Expense, with_atts: bool = True) -> dict:
    proj = db.get(models.Project, e.project_id) if e.project_id else None
    payer = db.get(models.Member, e.payer_member_id) if e.payer_member_id else None
    atts = []
    if with_atts:
        for a in db.execute(select(models.Attachment).where(
                models.Attachment.entity_type == "expense",
                models.Attachment.entity_id == e.id)).scalars():
            atts.append(attachment_dict(a))
    return {"id": e.id, "no": e.no, "exp_date": e.exp_date, "entry_date": e.entry_date,
            "title": e.title, "description": e.description,
            "base_amount": e.base_amount, "tax_amount": e.tax_amount,
            "total_amount": e.total_amount, "party_name": e.party_name,
            "category_code": e.category_code,
            "category_name": _acc(db, e.category_code),
            "project_id": e.project_id, "project_name": proj.name if proj else "",
            "payer_type": e.payer_type, "payer_member_id": e.payer_member_id,
            "payer_name": payer.full_name if payer else "",
            "paid_via": e.paid_via, "bank_id": e.bank_id,
            "pay_status": e.pay_status, "paid_amount": e.paid_amount,
            "appr_status": e.appr_status, "invoice_no": e.invoice_no,
            "asset_kind": e.asset_kind, "note": e.note,
            "created_by": e.created_by, "approved_by": e.approved_by,
            "attachments": atts}


def attachment_dict(a: models.Attachment) -> dict:
    return {"id": a.id, "entity_type": a.entity_type, "entity_id": a.entity_id,
            "name": a.name, "size": a.size, "mime": a.mime,
            "uploaded_by": a.uploaded_by, "has_data": bool(a.path)}


def funding_dict(db: Session, f: models.FundingRequest, detail: bool = False) -> dict:
    proj = db.get(models.Project, f.project_id) if f.project_id else None
    rows = []
    collected = 0
    if detail:
        from ..services.financing import commitment_paid_actual
        for c in db.execute(select(models.Commitment).where(
                models.Commitment.funding_id == f.id).order_by(models.Commitment.id)).scalars():
            m = db.get(models.Member, c.member_id)
            paid = commitment_paid_actual(db, c)
            collected += paid
            rows.append({"id": c.id, "member_id": c.member_id, "member_name": m.full_name if m else "",
                         "share_bp": c.share_bp, "amount": c.amount, "paid": paid,
                         "remaining": max(c.amount - paid, 0), "settled": paid >= c.amount})
    return {"id": f.id, "no": f.no, "title": f.title, "description": f.description,
            "amount": f.amount, "split_method": f.split_method,
            "percents": f.percents, "fixed_amounts": f.fixed_amounts,
            "member_ids": f.member_ids, "base_date": f.base_date, "due_date": f.due_date,
            "ftype": f.ftype, "doc_ref": f.doc_ref, "project_id": f.project_id,
            "project_name": proj.name if proj else "",
            "status": f.status, "created_by": f.created_by, "approved_by": f.approved_by,
            "note": f.note, "commitments": rows,
            "collected": collected, "progress": int(collected * 100 / f.amount) if f.amount else 0}


def payment_dict(db: Session, p: models.Payment) -> dict:
    m = db.get(models.Member, p.member_id)
    f = db.get(models.FundingRequest, p.funding_id) if p.funding_id else None
    bank = db.get(models.BankAccount, p.bank_id) if p.bank_id else None
    alloc = sum(a.amount for a in db.execute(select(models.Allocation).where(
        models.Allocation.payment_id == p.id)).scalars())
    return {"id": p.id, "no": p.no, "pay_date": p.pay_date,
            "member_id": p.member_id, "member_name": m.full_name if m else "",
            "amount": p.amount, "method": p.method,
            "bank_id": p.bank_id, "bank_name": bank.name if bank else "",
            "tracking_no": p.tracking_no, "receipt_ref": p.receipt_ref,
            "funding_id": p.funding_id, "funding_no": f.no if f else "",
            "note": p.note, "status": p.status,
            "declared_by": p.declared_by, "approved_by": p.approved_by,
            "allocated": alloc, "unallocated": (p.amount - alloc) if p.status == "approved" else 0}


def voucher_dict(db: Session, v: models.Voucher) -> dict:
    return {"id": v.id, "no": v.no, "date": v.vdate, "description": v.description,
            "status": v.status, "source_type": v.source_type, "source_id": v.source_id,
            "reversal_of": v.reversal_of, "created_by": v.created_by,
            "confirmed_by": v.confirmed_by,
            "total_debit": sum(l.debit for l in v.lines),
            "total_credit": sum(l.credit for l in v.lines),
            "lines": [{
                "id": l.id, "account_code": l.account_code,
                "account_name": _acc(db, l.account_code),
                "tafsil_id": l.tafsil_id, "tafsil_name": l.tafsil_name,
                "debit": l.debit, "credit": l.credit,
                "description": l.description, "project_id": l.project_id,
            } for l in v.lines]}


def audit_dict(a: models.AuditLog) -> dict:
    return {"id": a.id, "ts": a.ts.isoformat() if a.ts else "", "username": a.username,
            "action": a.action, "entity": a.entity, "entity_id": a.entity_id,
            "details": a.details}


def _acc(db: Session, code: str) -> str:
    acc = db.execute(select(models.Account).where(models.Account.code == code)).scalar_one_or_none()
    return acc.name if acc else code
