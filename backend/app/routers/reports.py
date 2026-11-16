# -*- coding: utf-8 -*-
"""گزارش‌ها: دفاتر روزنامه، کل، معین، تفصیلی، تراز آزمایشی، صورت‌های مالی و تسویه اعضا"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services import accounting
from ..services.financing import member_statement
from .helpers import require

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/journal")
def journal(date_from: str = "", date_to: str = "", voucher_no: str = "",
            account_code: str = "", tafsil_id: int | None = None,
            user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.journal_rows(db, date_from or None, date_to or None,
                                   voucher_no or None, account_code or None, tafsil_id)


@router.get("/general")
def general(date_from: str = "", date_to: str = "",
            user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.general_ledger(db, date_from or None, date_to or None)


@router.get("/moin/{code}")
def moin(code: str, date_from: str = "", date_to: str = "",
         user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.moin_ledger(db, code, date_from or None, date_to or None)


@router.get("/tafsil/{tid}")
def tafsil(tid: int, date_from: str = "", date_to: str = "",
           user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.tafsil_ledger(db, tid, date_from or None, date_to or None)


@router.get("/trial-balance")
def trial(date_from: str = "", date_to: str = "",
          user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.trial_balance(db, date_from or None, date_to or None)


@router.get("/pnl")
def pnl(date_from: str = "", date_to: str = "",
        user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.pnl(db, date_from or None, date_to or None)


@router.get("/balance-sheet")
def balance_sheet(as_of: str = "",
                  user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    return accounting.balance_sheet(db, as_of or None)


@router.get("/member-settlement")
def settlement(user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")), db: Session = Depends(get_db)):
    """گزارش تسویه اعضا برای مدیریت"""
    if user["role"] == "member":
        return [member_statement(db, user["member_id"])]
    out = []
    for m in db.execute(__import__("sqlalchemy").select(models.Member)
                        .where(models.Member.is_active == True)).scalars():  # noqa: E712
        out.append(member_statement(db, m.id))
    return out
