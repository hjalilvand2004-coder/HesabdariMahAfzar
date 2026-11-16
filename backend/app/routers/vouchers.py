# -*- coding: utf-8 -*-
"""اسناد حسابداری: ثبت دستی، تأیید، ابطال با سند معکوس"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import confirm_voucher, log, next_number, post_voucher, reverse_voucher
from .helpers import guard_period, require, voucher_dict

router = APIRouter(prefix="/api/vouchers", tags=["vouchers"])


@router.get("")
def list_vouchers(status: str = "", date_from: str = "", date_to: str = "",
                  no: str = "", source_type: str = "",
                  user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")),
                  db: Session = Depends(get_db)):
    rows = db.execute(select(models.Voucher).order_by(models.Voucher.id.desc())).scalars().all()
    if status:
        rows = [v for v in rows if v.status == status]
    if source_type:
        rows = [v for v in rows if v.source_type == source_type]
    if date_from:
        rows = [v for v in rows if v.vdate >= date_from]
    if date_to:
        rows = [v for v in rows if v.vdate <= date_to]
    if no:
        rows = [v for v in rows if no.lower() in v.no.lower()]
    return [voucher_dict(db, v) for v in rows]


class VoucherBody(BaseModel):
    date: str
    description: str
    status: str = "draft"  # draft | confirmed
    lines: list[dict]


@router.post("")
def create(body: VoucherBody, user: dict = Depends(require("finance", "accountant", "admin")),
           db: Session = Depends(get_db)):
    guard_period(db, user)
    v = post_voucher(db, vdate=body.date, description=body.description,
                     lines=body.lines, source_type="manual", idem_key=None,
                     user=user, confirm=(body.status == "confirmed"))
    db.commit()
    return voucher_dict(db, v)


@router.get("/{vid}")
def get_one(vid: int, user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")),
            db: Session = Depends(get_db)):
    v = db.get(models.Voucher, vid)
    if not v:
        raise HTTPException(404, "سند یافت نشد")
    return voucher_dict(db, v)


@router.post("/{vid}/confirm")
def confirm(vid: int, user: dict = Depends(require("finance", "admin")),
            db: Session = Depends(get_db)):
    guard_period(db, user)
    v = db.get(models.Voucher, vid)
    if not v:
        raise HTTPException(404, "سند یافت نشد")
    confirm_voucher(db, v, user)
    db.commit()
    return voucher_dict(db, v)


@router.post("/{vid}/reverse")
def reverse(vid: int, body: dict, user: dict = Depends(require("finance", "admin")),
            db: Session = Depends(get_db)):
    guard_period(db, user)
    v = db.get(models.Voucher, vid)
    if not v:
        raise HTTPException(404, "سند یافت نشد")
    rv = reverse_voucher(db, v, user, body.get("reason", ""))
    db.commit()
    return voucher_dict(db, rv)
