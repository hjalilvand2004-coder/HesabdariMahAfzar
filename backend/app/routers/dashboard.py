# -*- coding: utf-8 -*-
"""داشبورد مدیریتی، تحلیل‌های هوشمند قاعده‌محور و ردپای حسابرسی"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services import analytics, accounting
from ..services.accounting import cash_balance, journal_rows
from ..services.financing import commitment_paid_actual
from ..jalali import iso_to_jalali, today_iso, fiscal_year_range, current_jyear
from .helpers import audit_dict, get_settings, member_dict, require

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")),
              db: Session = Depends(get_db)):
    s = get_settings(db)
    fstart, fend = s.fiscal_start, s.fiscal_end
    today = today_iso()
    jy = iso_to_jalali(today)[0]

    # درآمد و هزینه سال مالی
    pnl_year = accounting.pnl(db, fstart, fend)
    cash = accounting.cash_balance(db, None)
    cash_total = sum(cash.values())

    # تأمین مالی
    fundings = db.execute(select(models.FundingRequest).where(
        models.FundingRequest.status == "approved")).scalars().all()
    approved_amount = sum(f.amount for f in fundings)
    collected = sum(commitment_paid_actual(db, c)
                    for f in fundings
                    for c in db.execute(select(models.Commitment).where(
                        models.Commitment.funding_id == f.id)).scalars())
    commitments_remaining = 0
    for f in fundings:
        for c in db.execute(select(models.Commitment).where(
                models.Commitment.funding_id == f.id)).scalars():
            commitments_remaining += max(c.amount - commitment_paid_actual(db, c), 0)

    # هزینه‌های پرداخت‌نشده (بدهی به فروشندگان)
    unpaid = sum(e.total_amount - e.paid_amount for e in db.execute(
        select(models.Expense).where(models.Expense.appr_status == "approved",
                                     models.Expense.payer_type == "company")).scalars())

    # مانده تعهد هر عضو
    members_rows = []
    for m in db.execute(select(models.Member).where(models.Member.is_active == True)).scalars():  # noqa: E712
        st = None
        comms = db.execute(select(models.Commitment).join(models.FundingRequest,
                models.Commitment.funding_id == models.FundingRequest.id).where(
                models.Commitment.member_id == m.id,
                models.FundingRequest.status == "approved")).scalars().all()
        total = sum(c.amount for c in comms)
        paid = sum(commitment_paid_actual(db, c) for c in comms)
        share_bp = 0
        for sh in db.execute(select(models.Share).where(models.Share.member_id == m.id)
                             .order_by(models.Share.from_date)).scalars():
            share_bp = sh.percent_bp
        members_rows.append({
            "id": m.id, "name": m.full_name, "share_bp": share_bp,
            "commitment": total, "paid": paid, "remaining": max(total - paid, 0)})

    # سری ماهانه ۶ ماه اخیر (درآمد/هزینه)
    series = {}
    for l, v in accounting._base_query(db, None, None):
        jyy, jm, _ = iso_to_jalali(v.vdate)
        key = f"{jyy}-{jm:02d}"
        d = series.setdefault(key, {"income": 0, "expense": 0})
        if l.account_code.startswith("4"):
            d["income"] += l.credit - l.debit
        elif l.account_code.startswith("5"):
            d["expense"] += l.debit - l.credit
    months_sorted = sorted(series)[-6:]
    monthly = [{"month": mk, "income": series[mk]["income"], "expense": series[mk]["expense"]}
               for mk in months_sorted]

    # هزینه به تفکیک نوع (سال مالی)
    by_cat = {}
    for l, v in accounting._base_query(db, fstart, fend):
        if l.account_code.startswith("5") and l.debit > 0:
            acc = db.execute(select(models.Account).where(
                models.Account.code == l.account_code)).scalar_one_or_none()
            name = acc.name if acc else l.account_code
            col = code_group(name)
            by_cat.setdefault(col["code"], {**col, "amount": 0})
            by_cat[col["code"]]["amount"] += l.debit
    categories = sorted(by_cat.values(), key=lambda x: -x["amount"])

    # هزینه به تفکیک پروژه
    by_project = {}
    for l, v in accounting._base_query(db, fstart, fend):
        if l.debit > 0 and l.project_id:
            p = db.get(models.Project, l.project_id)
            name = p.name if p else "بدون پروژه"
            by_project.setdefault(name, 0)
            by_project[name] += l.debit
    projects = [{"name": k, "amount": v} for k, v in sorted(by_project.items(), key=lambda x: -x[1])]

    # هشدارها
    alerts = [a for a in analytics.run_analytics(db) if a["type"] in ("due", "cash_forecast")][:4]

    recent = [audit_dict(a) for a in db.execute(
        select(models.AuditLog).order_by(models.AuditLog.id.desc()).limit(10)).scalars()]

    # خلاصه خدمات اعضا و جبران خدمات
    svc_rows = db.execute(select(models.Service)).scalars().all()
    pending_svc = [s for s in svc_rows if s.status in ("draft", "pending")]

    # فهرست مصوبه‌های تأمین مالی برای دریل‌داون داشبورد
    fundings_out = []
    for f in fundings:
        f_collected = 0
        for c in db.execute(select(models.Commitment).where(
                models.Commitment.funding_id == f.id)).scalars():
            f_collected += commitment_paid_actual(db, c)
        fundings_out.append({
            "id": f.id, "no": f.no, "title": f.title, "amount": f.amount,
            "collected": f_collected, "remaining": max(f.amount - f_collected, 0),
            "progress": int(f_collected * 100 / f.amount) if f.amount else 0,
            "due_date": f.due_date or "",
        })
    fundings_out.sort(key=lambda x: -x["id"])

    return {
        "cash_total": cash_total, "cash_detail": [{"code": k, "amount": v} for k, v in cash.items()],
        "pnl_year": pnl_year,
        "funding": {"approved_amount": approved_amount, "collected": collected,
                    "remaining": commitments_remaining},
        "fundings": fundings_out,
        "services": {
            "pending_count": len(pending_svc),
            "pending_amount": sum(s.amount for s in pending_svc),
            "compensated_amount": sum(s.amount for s in svc_rows if s.status == "compensated"),
        },
        "unpaid_expenses": unpaid,
        "members": members_rows,
        "monthly": monthly, "categories": categories[:7], "projects": projects,
        "alerts": alerts, "recent_activity": recent,
        "fiscal": {"label": s.fiscal_label, "start": fstart, "end": fend,
                   "closed": s.period_closed},
        "today_jalali": jy,
    }


def code_group(name: str) -> dict:
    return {"code": name[:30], "name": name}


@router.get("/analytics")
def get_analytics(user: dict = Depends(require("admin", "finance", "accountant", "ceo", "auditor")),
                  db: Session = Depends(get_db)):
    return analytics.run_analytics(db)


@router.get("/audit")
def audit_log(entity: str = "", username: str = "",
              user: dict = Depends(require("admin", "finance", "auditor")),
              db: Session = Depends(get_db)):
    rows = db.execute(select(models.AuditLog).order_by(models.AuditLog.id.desc()).limit(500)).scalars().all()
    if entity:
        rows = [r for r in rows if r.entity == entity]
    if username:
        rows = [r for r in rows if username.lower() in r.username.lower()]
    return [audit_dict(a) for a in rows]
