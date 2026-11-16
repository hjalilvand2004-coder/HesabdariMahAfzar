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


@router.get("/expense-drill")
def expense_drill(level: int = 1, cat: str = "", project: int = -1, month: str = "",
                  user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")),
                  db: Session = Depends(get_db)):
    """دریل‌داون هزینه‌ها — سه سطح: دسته ← پروژه ← اسناد (با فیلتر اختیاری ماه)"""
    from ..jalali import iso_to_jalali

    def _acc_name(code: str) -> str:
        return accounting._acc_name(db, code)

    rows = []
    for l, v in accounting._base_query(db, None, None):
        if l.debit <= 0:
            continue
        code = l.account_code
        if not (code.startswith("5") or code == "1301"):
            continue
        if month:
            jy, jm, _ = iso_to_jalali(v.vdate)
            if month != f"{jy}-{jm:02d}":
                continue
        rows.append((l, v))

    if level == 1:
        by_cat: dict[str, int] = {}
        for l, _v in rows:
            col = "1301" if l.account_code == "1301" else l.account_code[:4]
            by_cat[col] = by_cat.get(col, 0) + l.debit
        return {
            "scope": "category",
            "rows": [{"key": code, "label": _acc_name(code), "amount": amount}
                     for code, amount in sorted(by_cat.items(), key=lambda x: -x[1])],
            "total": sum(by_cat.values()),
        }

    rows = [(l, v) for (l, v) in rows
            if ("1301" if l.account_code == "1301" else l.account_code[:4]) == cat]
    if level == 2:
        by_proj: dict[int, int] = {}
        for l, _v in rows:
            key = l.project_id or 0
            by_proj[key] = by_proj.get(key, 0) + l.debit
        return {
            "scope": "project", "cat": cat,
            "rows": [{"key": int(pid),
                      "label": (db.get(models.Project, int(pid)).name
                                if int(pid) and db.get(models.Project, int(pid)) else
                                ("پروژه" if int(pid) else "بدون پروژه")),
                      "amount": amount}
                     for pid, amount in sorted(by_proj.items(), key=lambda x: -x[1])],
            "total": sum(l.debit for l, _v in rows),
        }

    rows = [(l, v) for (l, v) in rows if (l.project_id or 0) == project]
    rows.sort(key=lambda x: x[1].vdate, reverse=True)
    return {
        "scope": "rows", "cat": cat, "project": project,
        "rows": [{"voucher_no": v.no, "voucher_id": v.id, "date": v.vdate,
                  "desc": l.description or v.description,
                  "account": _acc_name(l.account_code), "amount": l.debit}
                 for l, v in rows],
        "total": sum(l.debit for l, _v in rows),
    }
