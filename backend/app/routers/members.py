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
