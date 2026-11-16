# -*- coding: utf-8 -*-
"""درخواست‌های تأمین مالی: تقسیم بین اعضا، تعهدات، تأیید مصوبه"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import log, next_number
from ..services.financing import calc_split, member_share_bp_at
from .helpers import funding_dict, get_settings, guard_period, require

router = APIRouter(prefix="/api/funding", tags=["funding"])


@router.get("")
def list_funding(status: str = "", user: dict = Depends(require()),
                 db: Session = Depends(get_db)):
    if user["role"] == "member":
        # اعضا فقط درخواست‌های مشمول خودشان را می‌بینند
        out = []
        for f in db.execute(select(models.FundingRequest).order_by(models.FundingRequest.id.desc())).scalars():
            if f.status == "approved" and user["member_id"] in (f.member_ids or []):
                out.append(funding_dict(db, f))
        return out
    rows = db.execute(select(models.FundingRequest).order_by(models.FundingRequest.id.desc())).scalars().all()
    if status:
        rows = [f for f in rows if f.status == status]
    return [funding_dict(db, f) for f in rows]


class PreviewBody(BaseModel):
    amount: int
    method: str
    member_ids: list[int]
    percents: dict = {}
    fixed_amounts: dict = {}
    base_date: str = ""


@router.post("/preview")
def preview(body: PreviewBody, user: dict = Depends(require()),
            db: Session = Depends(get_db)):
    """محاسبه زنده تقسیم مبلغ در فرم — بدون ذخیره‌سازی"""
    rows = calc_split(db, amount=body.amount, method=body.method,
                      member_ids=body.member_ids, percents=body.percents,
                      fixed_amounts=body.fixed_amounts, base_date=body.base_date or None)
    out = []
    for r in rows:
        m = db.get(models.Member, r["member_id"])
        out.append({"member_id": r["member_id"], "member_name": m.full_name if m else "",
                    "share_bp": r["share_bp"], "amount": r["amount"]})
    return {"rows": out, "total": sum(r["amount"] for r in out)}


class FundingBody(BaseModel):
    title: str
    description: str = ""
    amount: int
    method: str = "share"
    percents: dict = {}
    fixed_amounts: dict = {}
    member_ids: list[int] = []
    base_date: str = ""
    due_date: str = ""
    ftype: str = "current"
    doc_ref: str = ""
    project_id: int | None = None
    note: str = ""


@router.post("")
def create(body: FundingBody, user: dict = Depends(require("admin", "finance", "accountant")),
           db: Session = Depends(get_db)):
    guard_period(db, user)
    if body.amount <= 0:
        raise HTTPException(400, "مبلغ موردنیاز باید مثبت باشد")
    if not body.member_ids:
        raise HTTPException(400, "اعضای مشمول را انتخاب کنید")
    calc_split(db, amount=body.amount, method=body.method, member_ids=body.member_ids,
               percents=body.percents, fixed_amounts=body.fixed_amounts,
               base_date=body.base_date or None)  # اعتبارسنجی قبل از ذخیره
    f = models.FundingRequest(
        no=next_number(db, "funding", _today(), {"funding": "F"}),
        title=body.title, description=body.description, amount=body.amount,
        split_method=body.method, percents=body.percents, fixed_amounts=body.fixed_amounts,
        member_ids=body.member_ids, base_date=body.base_date, due_date=body.due_date,
        ftype=body.ftype, doc_ref=body.doc_ref, project_id=body.project_id,
        status="draft", created_by=user["username"], note=body.note)
    db.add(f)
    db.flush()
    log(db, user, "create", "funding", f.id, {"no": f.no, "amount": f.amount, "method": f.split_method})
    db.commit()
    return funding_dict(db, f)


def _today() -> str:
    from ..jalali import today_iso
    return today_iso()


@router.get("/{fid}")
def get_one(fid: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    f = db.get(models.FundingRequest, fid)
    if not f:
        raise HTTPException(404, "درخواست یافت نشد")
    if user["role"] == "member" and user["member_id"] not in (f.member_ids or []):
        raise HTTPException(403, "دسترسی مجاز نیست")
    return funding_dict(db, f, detail=True)


@router.patch("/{fid}")
def update(fid: int, body: FundingBody,
           user: dict = Depends(require("admin", "finance", "accountant")),
           db: Session = Depends(get_db)):
    guard_period(db, user)
    f = db.get(models.FundingRequest, fid)
    if not f:
        raise HTTPException(404, "درخواست یافت نشد")
    if f.status == "approved":
        raise HTTPException(400, "مصوبه تأییدشده قابل ویرایش نیست")
    for k, v in body.model_dump().items():
        setattr(f, k, v)
    calc_split(db, amount=f.amount, method=f.split_method, member_ids=f.member_ids,
               percents=f.percents, fixed_amounts=f.fixed_amounts,
               base_date=f.base_date or None)
    log(db, user, "update", "funding", fid, {"title": f.title, "amount": f.amount})
    db.commit()
    return funding_dict(db, f, detail=True)


@router.post("/{fid}/submit")
def submit(fid: int, user: dict = Depends(require("admin", "finance", "accountant")),
           db: Session = Depends(get_db)):
    f = db.get(models.FundingRequest, fid)
    if not f or f.status not in ("draft", "rejected"):
        raise HTTPException(400, "وضعیت درخواست برای ارسال مناسب نیست")
    f.status = "pending"
    log(db, user, "submit", "funding", fid, {"no": f.no})
    db.commit()
    return {"ok": True}


@router.post("/{fid}/approve")
def approve(fid: int, body: dict, user: dict = Depends(require("ceo")),
            db: Session = Depends(get_db)):
    """تأیید مصوبه: تعهد هر عضو با کنترل گرد کردن دقیقاً محاسبه و ثبت می‌شود"""
    guard_period(db, user)
    f = db.get(models.FundingRequest, fid)
    if not f or f.status != "pending":
        raise HTTPException(400, "فقط درخواست «در انتظار تأیید» قابل تصمیم‌گیری است")
    decision = body.get("decision", "approve")
    if decision == "reject":
        f.status = "rejected"
        f.note = (f.note + "\n" if f.note else "") + f"رد توسط {user['username']}: {body.get('note', '')}"
        log(db, user, "reject", "funding", fid, {"note": body.get("note", "")})
        db.commit()
        return {"ok": True, "status": "rejected"}
    rows = calc_split(db, amount=f.amount, method=f.split_method, member_ids=f.member_ids,
                      percents=f.percents, fixed_amounts=f.fixed_amounts,
                      base_date=f.base_date or None)
    old = db.execute(select(models.Commitment).where(models.Commitment.funding_id == f.id)).scalars().all()
    for c in old:
        db.delete(c)
    from ..services.financing import create_commitments
    create_commitments(db, f, rows)
    f.status = "approved"
    f.approved_by = user["username"]
    from datetime import datetime
    f.approved_at = datetime.now()
    log(db, user, "approve", "funding", fid,
        {"no": f.no, "amount": f.amount, "rows": rows})
    db.commit()
    return funding_dict(db, f, detail=True)
