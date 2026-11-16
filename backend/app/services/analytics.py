# -*- coding: utf-8 -*-
"""تحلیل‌های قاعده‌محور و قطعی (بدون مدل زبانی) — با فرض‌های شفاف و ارجاع به داده"""
from __future__ import annotations

from datetime import date as _date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..services.accounting import _base_query, cash_balance
from ..services.financing import commitment_paid_actual
from ..jalali import iso_to_jalali, today_iso


def _month_key(iso: str) -> str:
    jy, jm, _ = iso_to_jalali(iso)
    return f"{jy}-{jm:02d}"


def _acc_name_map(db: Session) -> dict:
    return {a.code: a.name for a in db.execute(select(models.Account)).scalars()}


def run_analytics(db: Session) -> list[dict]:
    items: list[dict] = []
    today = today_iso()
    # --- ۱) رشد غیرعادی هزینه به تفکیک ماه شمسی و نوع هزینه
    cat_month: dict[str, dict[str, int]] = {}
    for l, v in _base_query(db, None, None):
        if l.account_code.startswith("5") and l.debit > 0:
            cat_month.setdefault(l.account_code, {})
            mk = _month_key(v.vdate)
            cat_month[l.account_code][mk] = cat_month[l.account_code].get(mk, 0) + l.debit
    name_map = _acc_name_map(db)
    current_mk = _month_key(today)
    for code, months in cat_month.items():
        keys = sorted(months)
        cur = months.get(current_mk, 0)
        prev = [months[k] for k in keys if k < current_mk][-3:]
        if cur > 0 and prev and len(prev) >= 2:
            avg = sum(prev) / len(prev)
            if avg > 0 and cur >= 20_000_000 and cur > 2 * avg:
                items.append({
                    "type": "growth", "severity": "warning",
                    "title": f"رشد غیرعادی هزینه «{name_map.get(code, code)}»",
                    "text": f"هزینه این ماه {cur:,} ریال است که بیش از دو برابر میانگین سه ماه گذشته ({avg:,.0f} ریال) می‌باشد.",
                    "refs": [f"کد حساب {code}", "دفتر معین"], "assumptions": "آستانه: دو برابر میانگین ۳ ماه اخیر و حداقل ۲۰ میلیون ریال",
                })
    # --- ۲) موارد مشکوک به ثبت تکراری
    exps = db.execute(select(models.Expense).where(
        models.Expense.appr_status == "approved").order_by(models.Expense.exp_date)).scalars().all()
    seen_pairs = set()
    from datetime import date as D
    for i in range(len(exps)):
        for j in range(i + 1, len(exps)):
            a, b = exps[i], exps[j]
            if a.party_name and a.party_name == b.party_name and a.total_amount == b.total_amount:
                try:
                    dd = abs((D.fromisoformat(a.exp_date) - D.fromisoformat(b.exp_date)).days)
                except Exception:
                    continue
                if dd <= 45:
                    pair = tuple(sorted((a.id, b.id)))
                    if pair not in seen_pairs:
                        seen_pairs.add(pair)
                        items.append({
                            "type": "duplicate", "severity": "warning",
                            "title": "مورد مشکوک به ثبت تکراری",
                            "text": f"هزینه‌های {a.no} و {b.no} با مبلغ یکسان ({a.total_amount:,} ریال) و طرف حساب یکسان «{a.party_name}» در فاصله {dd} روز ثبت شده‌اند؛ صحت آن‌ها بررسی شود.",
                            "refs": [a.no, b.no], "assumptions": "مبلغ و طرف حساب یکسان در بازه ۴۵ روز",
                        })
    # --- ۳) پیش‌بینی کسری نقدینگی (با فرض‌های اعلام‌شده)
    cash = sum(cash_balance(db).values())
    monthly_net: dict[str, int] = {}
    for l, v in _base_query(db, None, None):
        if l.account_code in ("1101",) or l.account_code.startswith("1102"):
            mk = _month_key(v.vdate)
            monthly_net[mk] = monthly_net.get(mk, 0) + l.debit - l.credit
    last3 = [monthly_net[k] for k in sorted(monthly_net)][-3:]
    if cash >= 0 and last3 and sum(1 for x in last3 if x < 0) >= 2:
        avg_burn = sum(last3) / len(last3)
        if avg_burn < 0:
            months_left = int(cash // abs(avg_burn)) if avg_burn < 0 else None
            items.append({
                "type": "cash_forecast", "severity": "danger" if months_left is not None and months_left <= 2 else "warning",
                "title": "پیش‌بینی کسری نقدینگی",
                "text": (f"میانگین خالص خروج نقد سه ماه اخیر {avg_burn:,.0f} ریال در ماه و موجودی نقد و بانک {cash:,} ریال است؛ "
                         f"با ادامه همین روند، نقدینگی حدوداً تا {months_left} ماه آینده به پایان می‌رسد."
                         if months_left is not None and months_left > 0 else
                         "با روند فعلی، کسری نقدینگی در همین ماه رخ می‌دهد؛ اقدام تأمین مالی لازم است."),
                "refs": ["حساب ۱۱۰۱ صندوق", "حساب ۱۱۰۲ بانک‌ها"],
                "assumptions": "فرض: تداوم میانگین جریان نقد سه ماه اخیر و عدم دریافت جدید",
            })
    # --- ۴) سررسیدهای نزدیک و گذشته تعهدات اعضا
    for c in db.execute(select(models.Commitment).join(models.FundingRequest,
            models.Commitment.funding_id == models.FundingRequest.id).where(
            models.FundingRequest.status == "approved")).scalars():
        paid = commitment_paid_actual(db, c)
        remaining = c.amount - paid
        if remaining <= 0 or not c.funding.due_date:
            continue
        try:
            days = (D.fromisoformat(c.funding.due_date) - D.fromisoformat(today)).days
        except Exception:
            continue
        if days <= 15:
            m = db.get(models.Member, c.member_id)
            overdue = days < 0
            items.append({
                "type": "due", "severity": "danger" if overdue else "info",
                "title": "سررسید گذشته تعهد عضو" if overdue else "سررسید نزدیک تعهد عضو",
                "text": f"تعهد {m.full_name if m else ''} در درخواست «{c.funding.title}»: مانده {remaining:,} ریال، "
                        f"سررسید {c.funding.due_date} ({'گذشته' if overdue else f'{days} روز مانده'}).",
                "refs": [c.funding.no], "assumptions": "",
            })
    return items
