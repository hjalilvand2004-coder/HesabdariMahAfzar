# -*- coding: utf-8 -*-
"""اعضا، سهامداران و تاریخچه سهام + وضعیت حساب هر عضو"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.financing import member_statement, member_share_bp_at
from .helpers import log, member_dict, require, share_dict

router = APIRouter(prefix="/api/members", tags=["members"])


@router.get("")
def list_members(user: dict = Depends(require()), db: Session = Depends(get_db)):
    """کاربر نقش عضو فقط خودش را می‌بیند"""
    q = select(models.Member).order_by(models.Member.id)
    if user["role"] == "member":
        q = q.where(models.Member.id == user["member_id"])
    out = []
    for m in db.execute(q).scalars():
        d = member_dict(m)
        d["share_now_bp"] = member_share_bp_at(db, m.id, None)
        out.append(d)
    return out


class MemberBody(BaseModel):
    code: str
    full_name: str
    kind: str = "person"
    national_id: str = ""
    phone: str = ""
    email: str = ""
    bank_account: str = ""
    note: str = ""
    is_active: bool = True


@router.post("")
def create_member(body: MemberBody, user: dict = Depends(require("admin", "finance")),
                  db: Session = Depends(get_db)):
    if db.execute(select(models.Member).where(models.Member.code == body.code)).scalar_one_or_none():
        raise HTTPException(400, "کد عضو تکراری است")
    m = models.Member(**body.model_dump())
    db.add(m)
    db.flush()
    db.add(models.Tafsil(ttype="member", name=m.full_name, ref_id=m.id))
    log(db, user, "create", "member", m.id, {"code": m.code, "name": m.full_name})
    db.commit()
    return member_dict(m)


@router.patch("/{mid}")
def update_member(mid: int, body: MemberBody, user: dict = Depends(require("admin", "finance")),
                  db: Session = Depends(get_db)):
    m = db.get(models.Member, mid)
    if not m:
        raise HTTPException(404, "عضو یافت نشد")
    before = member_dict(m)
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    taf = db.execute(select(models.Tafsil).where(models.Tafsil.ttype == "member",
                                                 models.Tafsil.ref_id == mid)).scalar_one_or_none()
    if taf:
        taf.name = m.full_name
    log(db, user, "update", "member", mid, {"before": before, "after": body.model_dump()})
    db.commit()
    return member_dict(m)


@router.get("/{mid}/statement")
def statement(mid: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    if user["role"] == "member" and user["member_id"] != mid:
        raise HTTPException(403, "فقط وضعیت حساب خودتان قابل مشاهده است")
    return member_statement(db, mid)


# ---------------- تاریخچه سهام ----------------

@router.get("/{mid}/shares")
def list_shares(mid: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    if user["role"] == "member" and user["member_id"] != mid:
        raise HTTPException(403, "دسترسی مجاز نیست")
    return [share_dict(s) for s in db.execute(
        select(models.Share).where(models.Share.member_id == mid)
        .order_by(models.Share.from_date)).scalars()]


class ShareBody(BaseModel):
    percent_bp: int  # ده‌هزارک: 5000 = 50%
    from_date: str
    to_date: str | None = None
    doc_ref: str = ""
    note: str = ""


@router.post("/{mid}/shares")
def add_share(mid: int, body: ShareBody, user: dict = Depends(require("admin", "finance")),
              db: Session = Depends(get_db)):
    m = db.get(models.Member, mid)
    if not m:
        raise HTTPException(404, "عضو یافت نشد")
    if body.percent_bp <= 0 or body.percent_bp > 10000:
        raise HTTPException(400, "درصد سهم باید بین ۰ و ۱۰۰ باشد")
    if body.to_date and body.to_date < body.from_date:
        raise HTTPException(400, "تاریخ پایان باید پس از تاریخ شروع باشد")
    if body.from_date <= (max((s.to_date or "0000") for s in m.shares) if m.shares else "0000"):
        raise HTTPException(400, "سهم جدید باید پس از دوره قبلی شروع شود")
    s = models.Share(member_id=mid, percent_bp=body.percent_bp, from_date=body.from_date,
                     to_date=body.to_date, doc_ref=body.doc_ref, note=body.note)
    db.add(s)
    log(db, user, "create", "share", None, {"member": m.full_name,
                                            "percent": body.percent_bp / 100,
                                            "from": body.from_date})
    db.commit()
    return share_dict(s)


@router.delete("/{mid}/shares/{sid}")
def delete_share(mid: int, sid: int, user: dict = Depends(require("admin", "finance")),
                 db: Session = Depends(get_db)):
    s = db.get(models.Share, sid)
    if not s or s.member_id != mid:
        raise HTTPException(404, "رکورد سهم یافت نشد")
    db.delete(s)
    log(db, user, "delete", "share", sid, {"member_id": mid})
    db.commit()
    return {"ok": True}


@router.get("/{mid}/timeline")
def member_timeline(mid: int, user: dict = Depends(require()), db: Session = Depends(get_db)):
    """تایم‌لاین رویدادهای مالی یک عضو — برای پروفایل شخص"""
    if user["role"] == "member" and user["member_id"] != mid:
        raise HTTPException(403, "دسترسی مجاز نیست")
    return _timeline(db, mid)


def _timeline(db: Session, mid: int) -> list[dict]:
    from ..services.financing import commitment_paid_actual
    out: list[dict] = []
    for p in db.execute(select(models.Payment).where(
            models.Payment.member_id == mid)).scalars():
        out.append({
            "date": p.pay_date, "ts": p.created_at.isoformat() if p.created_at else "",
            "kind": "payment",
            "title": f"پرداخت {p.no}" + (f" — پیگیری {p.tracking_no}" if p.tracking_no else ""),
            "amount": p.amount, "status": p.status,
        })
    for c in db.execute(select(models.OffsetCredit).where(
            models.OffsetCredit.member_id == mid)).scalars():
        e = db.get(models.Expense, c.expense_id) if c.expense_id else None
        out.append({
            "date": (e.exp_date if e else (c.created_at.date().isoformat() if c.created_at else "")),
            "ts": c.created_at.isoformat() if c.created_at else "", "kind": "credit",
            "title": (f"اعتبار بابت پرداخت هزینه {e.no} از حساب شخصی" if e else (c.note or "اعتبار تهاتر")),
            "amount": c.amount, "status": "approved",
        })
    for s in db.execute(select(models.Service).where(
            models.Service.member_id == mid)).scalars():
        out.append({
            "date": s.comp_date or s.sdate, "ts": s.created_at.isoformat() if s.created_at else "",
            "kind": "service", "title": f"خدمات {s.no} — {s.title}",
            "amount": s.amount, "status": s.status,
        })
    comms = db.execute(
        select(models.Commitment).join(models.FundingRequest,
            models.Commitment.funding_id == models.FundingRequest.id).where(
            models.Commitment.member_id == mid,
            models.FundingRequest.status == "approved")).scalars().all()
    for c in comms:
        f = c.funding
        paid = commitment_paid_actual(db, c)
        out.append({
            "date": (f.approved_at.date().isoformat() if f.approved_at else (f.base_date or "")),
            "ts": (f.approved_at.isoformat() if f.approved_at else (f.created_at.isoformat() if f.created_at else "")),
            "kind": "commitment",
            "title": f"تعهد مصوبه {f.no} — {f.title} (سهم {(c.share_bp / 100):g}٪)".replace("٪", "٪"),
            "amount": c.amount,
            "status": "paid" if paid >= c.amount else ("partial" if paid > 0 else "unpaid"),
        })
    allocs = db.execute(select(models.Allocation).join(models.Commitment,
        models.Allocation.commitment_id == models.Commitment.id).where(
        models.Commitment.member_id == mid)).scalars().all()
    for a in allocs:
        c = db.get(models.Commitment, a.commitment_id)
        f = db.get(models.FundingRequest, c.funding_id) if c else None
        src = None
        if a.payment_id:
            src = db.get(models.Payment, a.payment_id)
        elif a.credit_id:
            src = db.get(models.OffsetCredit, a.credit_id)
        out.append({
            "date": ((src.pay_date if hasattr(src, "pay_date") else "") if src else
                     (src.created_at.date().isoformat() if src and src.created_at else "")),
            "ts": a.created_at.isoformat() if a.created_at else "", "kind": "allocate",
            "title": f"تهاتر {a.amount:,} ریال با تعهد مصوبه {f.no if f else ''}",
            "amount": a.amount, "status": "approved",
        })
    for w in db.execute(select(models.WalletTx).where(
            models.WalletTx.member_id == mid)).scalars():
        label = {"charge": f"کیف پول {w.no} — شارژ" + (" از درگاه بانک ملی" if w.method == "gateway" else ""),
                 "settle": f"کیف پول {w.no} — تسویه تعهدات",
                 "spend": f"کیف پول {w.no} — برداشت"}.get(w.type, f"کیف پول {w.no}")
        out.append({
            "date": w.wdate, "ts": w.created_at.isoformat() if w.created_at else "",
            "kind": "wallet", "title": label, "amount": w.amount, "status": w.status,
        })
    out.sort(key=lambda x: ((x.get("date") or ""), (x.get("ts") or "")), reverse=True)
    return out[:120]
