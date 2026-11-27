# -*- coding: utf-8 -*-
"""دستیار هوشمند مالیار — موتور قاعده‌محور تحلیل وضعیت حسابی کاربر.
راهنمایی و اقدامات پیشنهادی متناسب با نقش و سطح دسترسی هر کاربر؛
همیشه بر پایه داده واقعی سامانه (بدون عدد ساخته‌شده). قرارداد یکسان با نسخه پرتیبل.
"""
from __future__ import annotations

from datetime import date as _D

from sqlalchemy import select

from .. import models
from .analytics import run_analytics
from .accounting import pnl, cash_balance, trial_balance
from .financing import commitment_paid_actual, member_statement
from ..security import ROLE_LABELS

# آینه DEFAULT_ROLE_PERMS در frontend/src/lib/format.js — ماتریس قابل ویرایش در
# نسخه سرور در تنظیمات ذخیره نمی‌شود؛ بنابراین ماتریس پیش‌فرض استاندارد ملاک است.
DEFAULT_ROLE_PERMS = {
    "admin": ["dashboard", "analytics", "expenses", "funding", "payments", "wallet",
              "services", "members", "profiles", "accounts", "vouchers", "reports",
              "statements", "audit", "users", "settings", "my-account"],
    "finance": ["dashboard", "analytics", "expenses", "funding", "payments", "wallet",
                "services", "members", "profiles", "accounts", "vouchers", "reports",
                "statements", "audit", "settings"],
    "accountant": ["dashboard", "analytics", "expenses", "funding", "payments", "wallet",
                   "services", "members", "profiles", "accounts", "vouchers", "reports",
                   "statements", "settings"],
    "ceo": ["dashboard", "analytics", "expenses", "funding", "payments", "wallet",
            "services", "members", "profiles", "accounts", "vouchers", "reports",
            "statements", "settings"],
    "auditor": ["dashboard", "analytics", "members", "profiles", "accounts",
                "vouchers", "reports", "statements", "audit"],
    "member": ["my-account", "wallet"],
}

# متن نقش‌ها — مکمل ROLE_LABELS نسخه سرور
ROLE_GUIDE = {
    "admin": "شما مدیر سامانه هستید؛ علاوه بر کارتابل تأییدها، سلامت کاربران، ماتریس دسترسی، دوره مالی و پروفایل شرکت هم تحت راهنمایی شماست.",
    "ceo": "شما تصمیم‌گیر نهایی هزینه‌ها، مصوبه‌ها و جبران خدمات هستید؛ دستیار، کارتابل تأیید شما و وضعیت مالی کل شرکت را رصد می‌کند.",
    "finance": "شما مسئول وصول پرداخت‌ها، تأیید شارژ کیف پول و تسویه‌ها هستید؛ دستیار موارد در انتظار بررسی شما را پیگیری می‌کند.",
    "accountant": "شما مسئول ثبت و کامل‌کردن اسناد هستید؛ دستیار پیش‌نویس‌های ناتمام، بدهی فروشندگان و توازن دفاتر را نشان می‌دهد.",
    "auditor": "شما دسترسی فقط‌خواندنی دارید؛ دستیار وضعیت توازن دفاتر، موارد مشکوک و ردپای فعالیت‌ها را برای رسیدگی شما خلاصه می‌کند.",
    "member": "شما عضو و سهامدار هستید؛ دستیار وضعیت تعهد، پرداخت‌ها، اعتبار تهاتر و کیف پول شخصی شما را پیگیری می‌کند و فقط اطلاعات خودتان را نشان می‌دهد.",
}

CHIPS = {
    "ceo": ["چه چیزهایی در انتظار تأیید من است؟", "وضعیت سود و زیان شرکت؟", "هشدارهای مالی امروز؟", "وضعیت وصول تأمین مالی؟"],
    "admin": ["وضعیت کاربران و دسترسی‌ها؟", "چه چیزهایی در انتظار تأیید است؟", "وضعیت سود و زیان شرکت؟", "پروفایل شرکت کامل است؟"],
    "finance": ["اعلام‌های پرداخت در انتظار بررسی؟", "شارژهای کیف پول در انتظار تأیید؟", "وضعیت سود و زیان شرکت؟", "هشدارهای مالی امروز؟"],
    "accountant": ["هزینه‌های پیش‌نویس من؟", "بدهی به فروشندگان چقدر است؟", "وضعیت سود و زیان شرکت؟", "وضعیت تراز آزمایشی؟"],
    "auditor": ["خلاصه حسابرسی داده امروز؟", "وضعیت تراز آزمایشی؟", "موارد تکراری مشکوک؟", "وضعیت دوره مالی؟"],
    "member": ["وضعیت تعهد من؟", "موجودی کیف پول من؟", "چطور تعهدم را پرداخت کنم؟", "اعتبار تهاتر من چقدر است؟"],
}


def _fa(n) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return "0"


def _fmt(rial: int, unit: str = "toman") -> str:
    v = int(round(rial or 0))
    if unit == "rial":
        return f"{v:,} ریال"
    return f"{v // 10:,} تومان"


def _pct(a: int, b: int) -> int:
    return round(a * 100 / b) if b else 0


def _norm2(s: str) -> str:
    import re
    s = (s or "").replace("\u200c", " ")
    s = re.sub(r"[؟?!.,،؛:«»\"'\-()]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _has_any(q: str, words: list[str]) -> bool:
    return any(_norm2(w) in q for w in words)


def _day_diff(iso1: str, iso2: str) -> int:
    try:
        return (_D.fromisoformat(iso2) - _D.fromisoformat(iso1)).days
    except ValueError:
        return 0


# ---------------- اسنپ‌شات وضعیت شرکت ----------------

def company_snap(db) -> dict:
    s = db.execute(select(models.Setting).where(models.Setting.id == 1)).scalar_one_or_none()
    fiscal_label = s.fiscal_label if s else ""
    fstart = s.fiscal_start if s else None
    fend = s.fiscal_end if s else None
    unit = "rial" if (s and s.currency_display == "rial") else "toman"

    cash = sum(cash_balance(db, None).values())
    p = pnl(db, fstart, fend)
    profit = p["total_revenue"] - p["total_expense"]

    fundings = db.execute(select(models.FundingRequest).where(
        models.FundingRequest.status == "approved")).scalars().all()
    approved_amount = sum(f.amount for f in fundings)
    collected = 0
    funding_remaining = 0
    for f in fundings:
        for c in db.execute(select(models.Commitment).where(
                models.Commitment.funding_id == f.id)).scalars():
            paid = commitment_paid_actual(db, c)
            collected += paid
            funding_remaining += max(c.amount - paid, 0)

    approved_exp = db.execute(select(models.Expense).where(
        models.Expense.appr_status == "approved")).scalars().all()
    vendor_debt = sum(max(e.total_amount - e.paid_amount, 0)
                      for e in approved_exp if e.payer_type == "company")
    drafts = db.execute(select(models.Expense).where(models.Expense.appr_status == "draft")).scalars().all()
    pending_exp = db.execute(select(models.Expense).where(models.Expense.appr_status == "pending")).scalars().all()
    declared_pays = db.execute(select(models.Payment).where(models.Payment.status == "declared")).scalars().all()
    pending_wallet = db.execute(select(models.WalletTx).where(
        models.WalletTx.type == "charge", models.WalletTx.status == "pending")).scalars().all()
    pending_svc = db.execute(select(models.Service).where(
        models.Service.status.in_(("draft", "pending")))).scalars().all()
    pending_funding = db.execute(select(models.FundingRequest).where(
        models.FundingRequest.status == "pending")).scalars().all()

    alerts = run_analytics(db)
    tb = trial_balance(db, fstart, fend)
    tb_d = sum(r["move_debit"] for r in tb)
    tb_c = sum(r["move_credit"] for r in tb)

    users = db.execute(select(models.User).where(models.User.is_active == True)).scalars().all()  # noqa: E712
    return {
        "cash": cash, "profit": profit,
        "revenue": p["total_revenue"], "expense": p["total_expense"],
        "approved_amount": approved_amount, "collected": collected,
        "funding_remaining": funding_remaining,
        "vendor_debt": vendor_debt,
        "drafts": list(drafts), "pending_exp": list(pending_exp),
        "declared_pays": list(declared_pays), "pending_wallet": list(pending_wallet),
        "pending_svc": list(pending_svc), "pending_funding": list(pending_funding),
        "alerts": alerts,
        "dup_count": len([a for a in alerts if a["type"] == "duplicate"]),
        "cash_alert": next((a for a in alerts if a["type"] == "cash_forecast"), None),
        "due_alerts": [a for a in alerts if a["type"] == "due"],
        "tb_balanced": tb_d == tb_c, "tb_diff": tb_d - tb_c,
        "users_count": len(users),
        "period_closed": bool(s.period_closed) if s else False,
        "fiscal_label": fiscal_label,
        "settings": s,
        "unit": unit,
    }


def _snap_member(db, member_id: int) -> dict:
    st = member_statement(db, member_id)
    unpaid = [c for c in st["commitments"] if not c["settled"]]
    today = _D.today().isoformat()
    due = None
    for c in unpaid:
        if c.get("due_date"):
            days = _day_diff(today, c["due_date"])
            if due is None or days < due["days"]:
                due = {**c, "days": days}
    pending_wallet = db.execute(select(models.WalletTx).where(
        models.WalletTx.member_id == member_id,
        models.WalletTx.type == "charge",
        models.WalletTx.status == "pending")).scalars().all()
    t = st["totals"]
    return {
        "st": st, "unpaid_comms": unpaid, "due": due,
        "pending_wallet": list(pending_wallet),
        "committed": t["commitments"], "paid": t["commitments_paid"],
        "remaining": t["commitments_remaining"],
        "wallet_bal": t["wallet_balance"],
        "unallocated": max(t["unallocated_credit"], 0),
        "net": t["net_balance"],
    }


# ---------------- کارت‌های راهنمایی هر نقش ----------------

def _staff_insights(db, user, snap, perm) -> list[dict]:
    out = []
    role = user["role"]
    unit = snap["unit"]
    u = user
    is_ceo_like = role in ("ceo", "admin")
    is_fin = role in ("finance", "admin")
    is_acc = role in ("accountant", "admin")
    is_auditor = role == "auditor"

    if is_ceo_like:
        pend_sum = sum(e.total_amount for e in snap["pending_exp"])
        if snap["pending_exp"] or snap["pending_funding"] or snap["pending_svc"]:
            out.append({
                "id": "approvals", "severity": "warning", "icon": "checkCircle",
                "title": "کارتابل تأیید شما",
                "text": (f"در انتظار تصمیم شماست: {_fa(len(snap['pending_exp']))} هزینه "
                         f"(مبلغ {_fmt(pend_sum, unit)})، {_fa(len(snap['pending_funding']))} مصوبه تأمین مالی و "
                         f"{_fa(len(snap['pending_svc']))} خدمت عضو. تأیید فقط از سمت شما (مدیرعامل) انجام می‌شود و "
                         "تأخیر آن، روند پرداخت و تهاتر اعضا را متوقف می‌کند."),
                "actions": [
                    a for a in (
                        {"label": f"بررسی {_fa(len(snap['pending_exp']))} هزینه در انتظار تأیید", "path": "/expenses"}
                        if snap["pending_exp"] and perm("expenses") else None,
                        {"label": f"تصمیم درباره {_fa(len(snap['pending_funding']))} مصوبه تأمین مالی", "path": "/funding"}
                        if snap["pending_funding"] and perm("funding") else None,
                        {"label": f"بررسی {_fa(len(snap['pending_svc']))} خدمت عضو", "path": "/services"}
                        if snap["pending_svc"] and perm("services") else None,
                    ) if a
                ],
            })
        else:
            out.append({
                "id": "approvals", "severity": "success", "icon": "checkCircle",
                "title": "کارتابل تأیید شما خالی است",
                "text": "هیچ موردی در انتظار تأیید شما نیست؛ همه هزینه‌ها، مصوبه‌ها و خدمات تصمیم‌گرفته‌شده‌اند.",
                "actions": [],
            })

    if is_fin and perm("payments") and snap["declared_pays"]:
        dsum = sum(p.amount for p in snap["declared_pays"])
        out.append({
            "id": "declared-payments", "severity": "warning", "icon": "payments",
            "title": "اعلام‌های پرداخت در انتظار بررسی",
            "text": (f"{_fa(len(snap['declared_pays']))} اعلام پرداخت اعضا به‌مبلغ {_fmt(dsum, unit)} "
                     "منتظر رسیدگی شماست. تا وصول و تأیید، به تعهد عضو منظور نمی‌شود."),
            "actions": [{"label": "بررسی پرداخت‌ها", "path": "/payments"}] if perm("payments") else [],
        })

    if is_fin and perm("wallet") and snap["pending_wallet"]:
        wsum = sum(w.amount for w in snap["pending_wallet"])
        out.append({
            "id": "wallet-charges", "severity": "info", "icon": "wallet",
            "title": "شارژ دستی کیف پول در انتظار تأیید",
            "text": (f"{_fa(len(snap['pending_wallet']))} اعلام شارژ دستی کیف پول به‌مبلغ {_fmt(wsum, unit)} "
                     "در انتظار تأیید مالی است؛ پس از تأیید، اسناد و اعتبار عضو خودکار صادر می‌شود."),
            "actions": [{"label": "کیف پول اعضا", "path": "/wallet"}] if perm("wallet") else [],
        })

    if is_acc and perm("expenses") and snap["drafts"]:
        dsum = sum(e.total_amount for e in snap["drafts"])
        out.append({
            "id": "draft-expenses", "severity": "info", "icon": "expenses",
            "title": "هزینه‌های پیش‌نویس ناتمام",
            "text": (f"{_fa(len(snap['drafts']))} هزینه در حالت پیش‌نویس (مبلغ {_fmt(dsum, unit)}) ثبت شده اما "
                     "هنوز برای تأیید ارسال نشده است؛ پس از تکمیل مدارک، «ارسال برای تأیید» را بزنید."),
            "actions": [{"label": "هزینه‌های پیش‌نویس", "path": "/expenses"}],
        })

    if perm("expenses") and snap["vendor_debt"] > 0:
        out.append({
            "id": "vendor-debt", "severity": "warning", "icon": "bank",
            "title": "بدهی به فروشندگان",
            "text": (f"مجموع {_fmt(snap['vendor_debt'], unit)} بابت هزینه‌های تأییدشده و پرداخت‌نشده به "
                     "فروشندگان ثبت شده است؛ تسویه هر قلم از صفحه هزینه‌ها انجام می‌شود."),
            "actions": [{"label": "هزینه‌های پرداخت‌نشده", "path": "/expenses"}],
        })

    if perm("dashboard"):
        pnl_sev = "success" if snap["profit"] >= 0 else "warning"
        p_word = "سود" if snap["profit"] >= 0 else "زیان"
        out.append({
            "id": "pnl", "severity": pnl_sev, "icon": "pie",
            "title": f"وضعیت مالی سال {snap['fiscal_label']}",
            "text": (f"درآمد {_fmt(snap['revenue'], unit)} در برابر هزینه {_fmt(snap['expense'], unit)} — "
                     f"{p_word} دوره {_fmt(abs(snap['profit']), unit)} و موجودی نقد و بانک {_fmt(snap['cash'], unit)} است."),
            "actions": [{"label": "صورت‌های مالی", "path": "/statements"}] if perm("statements") else [],
        })
        if snap["cash_alert"]:
            out.append({
                "id": "alert-cash",
                "severity": "danger" if snap["cash_alert"]["severity"] == "danger" else "warning",
                "icon": "alert",
                "title": snap["cash_alert"]["title"], "text": snap["cash_alert"]["text"],
                "actions": [{"label": "تحلیل‌های هوشمند", "path": "/analytics"}] if perm("analytics") else [],
            })

    if perm("funding") and snap["approved_amount"] > 0:
        out.append({
            "id": "funding-progress", "severity": "info", "icon": "funding",
            "title": "پیشرفت وصول تأمین مالی",
            "text": (f"از مجموع مصوبه‌های تأییدشده ({_fmt(snap['approved_amount'], unit)}) تاکنون "
                     f"{_fmt(snap['collected'], unit)} ({_fa(_pct(snap['collected'], snap['approved_amount']))}٪) وصول و "
                     f"{_fmt(snap['funding_remaining'], unit)} باقی مانده است."),
            "actions": [{"label": "تأمین مالی اعضا", "path": "/funding"}],
        })

    if perm("members") and snap["due_alerts"]:
        out.append({
            "id": "alert-due",
            "severity": "danger" if any(a["severity"] == "danger" for a in snap["due_alerts"]) else "warning",
            "icon": "clock",
            "title": "سررسید تعهد اعضا",
            "text": " ".join(a["text"] for a in snap["due_alerts"][:2]),
            "actions": [{"label": "اعضا و سهامداران", "path": "/members"}],
        })

    if perm("analytics") and (is_auditor or snap["dup_count"] > 0):
        out.append({
            "id": "alert-dup", "severity": "info" if is_auditor else "warning", "icon": "audit",
            "title": "خلاصه حسابرسی داده" if is_auditor else "موارد مشکوک به ثبت تکراری",
            "text": (
                (f"{_fa(snap['dup_count'])} جفت هزینه با مبلغ و طرف‌حساب یکسان در بازه کمتر از ۴۵ روز ثبت شده و "
                 "نیازمند رسیدگی است. " if snap["dup_count"] > 0 else "مورد مشکوکی به ثبت تکراری یافت نشد. ")
                + ("تراز آزمایشی متوازن است" if snap["tb_balanced"] else "تراز آزمایشی نامتوازن است")
                + "؛ گزارش‌ها در «دفاتر و گزارش‌ها» قابل رسیدگی است."
            ) if is_auditor else (
                f"{_fa(snap['dup_count'])} جفت هزینه با مبلغ و طرف‌حساب یکسان در فاصله کوتاه ثبت شده است؛ "
                "قبل از تأیید، اصالت آن‌ها بررسی شود."
            ),
            "actions": [{"label": "تحلیل‌های هوشمند", "path": "/analytics"}],
        })

    if snap["period_closed"]:
        out.append({
            "id": "period", "severity": "danger", "icon": "lock",
            "title": "دوره مالی بسته است",
            "text": "ثبت و ویرایش اسناد دوره بسته برای همه نقش‌ها (به‌جز مدیر سامانه) مسدود است. "
                    "در صورت نیاز به اصلاح، با مدیر سامانه هماهنگ کنید.",
            "actions": [{"label": "تنظیمات دوره", "path": "/settings"}] if role == "admin" else [],
        })

    if role == "admin":
        s = snap["settings"]
        incomplete = (not s) or (not s.company_name) or (not s.company_national_id) \
            or ("اصلاح شود" in (s.company_national_id or "")) or (not s.company_reg_no)
        if incomplete and perm("settings"):
            out.append({
                "id": "profile-completeness", "severity": "info", "icon": "idcard",
                "title": "تکمیل پروفایل شرکت",
                "text": "برخی فیلدهای پروفایل شرکت (شناسه ملی، شماره ثبت و…) هنوز تکمیل یا پیش‌فرض است؛ "
                        "این اطلاعات در سرصفحه گزارش‌ها و صورت‌های مالی نمایش داده می‌شود.",
                "actions": [{"label": "تنظیمات پروفایل", "path": "/settings"}],
            })
        if perm("users"):
            out.append({
                "id": "users", "severity": "info", "icon": "users",
                "title": "کاربران و سطح دسترسی",
                "text": (f"هم‌اکنون {_fa(snap['users_count'])} کاربر فعال در سامانه دارد. ماتریس سطح دسترسی نقش‌ها "
                         "از «مدیریت کاربران و سطح دسترسی» قابل تنظیم است و دستیار هوشمند راهنمایی هر کاربر را "
                         "با همین ماتریس هماهنگ می‌کند."),
                "actions": [{"label": "مدیریت کاربران", "path": "/users"}],
            })
    return out


def _member_insights(db, user, snap, m) -> list[dict]:
    out = []
    unit = snap["unit"]
    name = user["full_name"]
    st = m["st"]
    t = st["totals"]
    due = m["due"]
    out.append({
        "id": "member-commitment", "severity": "warning" if m["unpaid_comms"] else "success", "icon": "funding",
        "title": "وضعیت تعهد شما",
        "text": (
            f"{name} عزیز؛ تعهد شما در مصوبه‌های تأییدشده {_fmt(m['committed'], unit)} است که تاکنون "
            f"{_fmt(m['paid'], unit)} ({_fa(_pct(m['paid'], m['committed']))}٪) پرداخت شده و مانده "
            f"{_fmt(m['remaining'], unit)} باقی مانده است."
            + (f" نزدیک‌ترین سررسید: {due['funding_title']} تا {due['due_date']}"
               + (" (گذشته — در اولویت پرداخت باشد)" if due["days"] < 0 else f" ({_fa(due['days'])} روز مانده)") + "."
               if due else "")
        ) if m["committed"] > 0 else
        "تعهد مالی مصوبه‌ای برای شما ثبت نشده است؛ در صورت مصوبه جدید، وضعیت شما همین‌جا به‌روز می‌شود.",
        "actions": [{"label": "پرداخت/اعلام پرداخت", "path": "/my-account"}]
        if m["remaining"] > 0 else [{"label": "وضعیت حساب من", "path": "/my-account"}],
    })
    if m["pending_wallet"]:
        wsum = sum(w.amount for w in m["pending_wallet"])
        out.append({
            "id": "member-wallet-pending", "severity": "info", "icon": "wallet",
            "title": "شارژ کیف پول در انتظار تأیید",
            "text": f"اعلام شارژ {_fmt(wsum, unit)} از سمت شما در انتظار تأیید مدیریت مالی است؛ "
                    "پس از تأیید، به موجودی کیف پول شما افزوده می‌شود.",
            "actions": [],
        })
    out.append({
        "id": "member-wallet", "severity": "info", "icon": "wallet",
        "title": "کیف پول شما",
        "text": (f"موجودی کیف پول شما {_fmt(m['wallet_bal'], unit)} و اعتبار تهاتر قابل استفاده "
                 f"(پرداخت‌های بدون تخصیص + جبران خدمات) {_fmt(m['unallocated'], unit)} است. "
                 "در صورت داشتن مانده تعهد، می‌توانید از درگاه بانک ملی پرداخت آنلاین انجام دهید."),
        "actions": [{"label": "شارژ/کیف پول من", "path": "/wallet"}],
    })
    if t["services_pending"] > 0:
        out.append({
            "id": "member-services", "severity": "info", "icon": "services",
            "title": "خدمات ثبت‌شده شما",
            "text": (f"{_fa(len(st['services']))} خدمت به مبلغ {_fmt(t['services_total'], unit)} از سمت شما ثبت شده که "
                     f"{_fmt(t['services_pending'], unit)} آن در جریان بررسی و جبران است."),
            "actions": [{"label": "وضعیت حساب من", "path": "/my-account"}],
        })
    out.append({
        "id": "member-net", "severity": "success" if m["net"] >= 0 else "info", "icon": "scale",
        "title": "جمع‌بندی حساب شما",
        "text": (
            f"مجموع پرداخت‌ها و اعتبارهای شما ({_fmt(m['paid'] + t['expense_credits'], unit)}) وضعیت تعهد "
            f"{_fmt(m['committed'], unit)} را پوشش داده و مانده {_fmt(m['remaining'], unit)} باقی است."
        ) if m["net"] >= 0 else
        f"مانده تعهد پرداخت‌نشده شما {_fmt(m['remaining'], unit)} است؛ برای جلوگیری از تأخیر در مصوبه‌ها، "
        "پرداخت را از پرتال خود انجام دهید.",
        "actions": [{"label": "وضعیت حساب من", "path": "/my-account"}],
    })
    return out


# ---------------- پاسخ به پرسش‌ها ----------------

def _answer(db, user, snap, m, q, perm) -> dict:
    unit = snap["unit"]
    role = user["role"]

    def link(label, path, module):
        return [{"label": label, "path": path}] if perm(module) else []

    if _has_any(q, ["سلام", "درود", "وقت بخیر"]):
        return {
            "answer": f"سلام {user['full_name']} عزیز! من دستیار هوشمند مالیار هستم؛ وضعیت حسابی شما را تحلیل "
                      f"می‌کنم و راهنمایی و اقدام لازم را متناسب با نقش «{ROLE_LABELS.get(role, role)}» پیشنهاد می‌دهم. "
                      "می‌توانید پرسش خود را بنویسید یا از پرسش‌های پیشنهادی بالا استفاده کنید.",
            "links": [], "severity": "info",
        }
    if _has_any(q, ["دسترسی", "نقش من", "اجازه", "مجوز", "سطح دسترسی"]):
        mods = ["dashboard", "analytics", "expenses", "funding", "payments", "wallet", "services",
                "members", "profiles", "accounts", "vouchers", "reports", "statements",
                "audit", "users", "settings", "my-account"]
        allowed = [mkey for mkey in mods if perm(mkey)]
        return {
            "answer": f"نقش شما «{ROLE_LABELS.get(role, role)}» است و به این بخش‌ها دسترسی دارید: "
                      f"{'، '.join(allowed)}. هر راهنمایی و اقدامی که پیشنهاد می‌کنم فقط در همین محدوده است؛ "
                      "بخش‌های دیگر برای نقش شما نمایش داده نمی‌شوند.",
            "links": [], "severity": "info",
        }
    if _has_any(q, ["تعهد", "سهم من", "پرداخت من", "مساهم", "وصول", "سهام"]):
        if role == "member" and m:
            extra = ""
            if m["due"]:
                d = m["due"]
                extra = (f" نزدیک‌ترین سررسید «{d['funding_title']}» تا {d['due_date']} است"
                         + (" و از تاریخ سررسید گذشته؛ در اولویت پرداخت قرار گیرد" if d["days"] < 0 else "")
                         + ".")
            else:
                extra = " "
            return {
                "answer": (f"تعهد شما در مصوبه‌های تأییدشده {_fmt(m['committed'], unit)} است؛ تاکنون "
                           f"{_fmt(m['paid'], unit)} پرداخت شده و مانده {_fmt(m['remaining'], unit)} باقی است." + extra +
                           "برای پرداخت آنلاین از درگاه بانک ملی یا اعلام پرداخت دستی، از پرتال خود استفاده کنید."),
                "links": link("وضعیت حساب من", "/my-account", "my-account"),
                "severity": "warning" if m["remaining"] > 0 else "success",
            }
        return {
            "answer": (f"از مصوبه‌های تأییدشده به مبلغ {_fmt(snap['approved_amount'], unit)}، تاکنون "
                       f"{_fmt(snap['collected'], unit)} ({_fa(_pct(snap['collected'], snap['approved_amount']))}٪) "
                       f"وصول شده و مانده اعضا {_fmt(snap['funding_remaining'], unit)} است."
                       + (f" همچنین {_fa(len(snap['pending_funding']))} مصوبه جدید در انتظار تصویب شماست."
                          if snap["pending_funding"] else "")),
            "links": link("تأمین مالی اعضا", "/funding", "funding"), "severity": "info",
        }
    if _has_any(q, ["کیف پول", "شارژ", "درگاه"]):
        if role == "member" and m:
            pend = f" یک اعلام شارژ {_fmt(sum(w.amount for w in m['pending_wallet']), unit)} از سمت شما در انتظار تأیید مالی است." \
                if m["pending_wallet"] else ""
            return {
                "answer": (f"موجودی کیف پول شما {_fmt(m['wallet_bal'], unit)} است." + pend +
                           f" برای شارژ از درگاه بانک ملی یا اعلام واریز دستی، به کیف پول من بروید؛ "
                           f"اعتبار تهاتر قابل استفاده شما {_fmt(m['unallocated'], unit)} است."),
                "links": link("کیف پول من", "/wallet", "wallet"), "severity": "info",
            }
        pw = snap["pending_wallet"]
        if pw:
            return {
                "answer": f"{_fa(len(pw))} اعلام شارژ دستی کیف پول اعضا به‌مبلغ "
                          f"{_fmt(sum(w.amount for w in pw), unit)} در انتظار تأیید شماست.",
                "links": link("کیف پول اعضا", "/wallet", "wallet"), "severity": "warning",
            }
        return {
            "answer": "هیچ اعلام شارژ دستی در انتظار تأیید نیست؛ شارژهای درگاه بانک ملی به‌صورت خودکار تأیید می‌شوند.",
            "links": link("کیف پول اعضا", "/wallet", "wallet"), "severity": "info",
        }
    if _has_any(q, ["سود", "زیان", "درآمد", "نتیجه"]):
        p = snap["profit"]
        alert = f" توجه: {snap['cash_alert']['title']} — {snap['cash_alert']['text']}" if snap["cash_alert"] else ""
        return {
            "answer": (f"در سال مالی {snap['fiscal_label']} درآمد {_fmt(snap['revenue'], unit)} و هزینه "
                       f"{_fmt(snap['expense'], unit)} ثبت شده که {'سود ' + _fmt(p, unit) if p >= 0 else 'زیان ' + _fmt(abs(p), unit)} "
                       f"را نشان می‌دهد؛ موجودی نقد و بانک {_fmt(snap['cash'], unit)} است." + alert),
            "links": [*link("صورت‌های مالی", "/statements", "statements"),
                      *link("تحلیل‌های هوشمند", "/analytics", "analytics")],
            "severity": "success" if p >= 0 else "warning",
        }
    if _has_any(q, ["هزینه", "خرید", "فاکتور", "فروشنده"]):
        if role == "member":
            return {
                "answer": "برای اعضا، هزینه‌های شخصی قابل مشاهده صرفاً هزینه‌هایی است که از حساب شخصی خود پرداخت "
                          "کرده‌اید و در «وضعیت حساب من» به‌صورت اعتبار تهاتر نشان داده می‌شود.",
                "links": link("وضعیت حساب من", "/my-account", "my-account"), "severity": "info",
            }
        pend_sum = sum(e.total_amount for e in snap["pending_exp"])
        ceo_note = " تأیید هزینه‌ها فقط از سمت شما (مدیرعامل) انجام می‌شود." \
            if role in ("ceo", "admin") and snap["pending_exp"] else ""
        return {
            "answer": (f"وضعیت هزینه‌ها: {_fa(len(snap['pending_exp']))} مورد در انتظار تأیید ({_fmt(pend_sum, unit)})، "
                       f"{_fa(len(snap['drafts']))} پیش‌نویس و بدهی پرداخت‌نشده به فروشندگان {_fmt(snap['vendor_debt'], unit)}."
                       + ceo_note),
            "links": link("هزینه‌ها و خریدها", "/expenses", "expenses"), "severity": "info",
        }
    if _has_any(q, ["تأمین مالی", "مصوبه", "وام", "سرمایه"]):
        return {
            "answer": (f"مصوبه‌های تأییدشده: {_fmt(snap['approved_amount'], unit)} — وصول‌شده {_fmt(snap['collected'], unit)} "
                       f"({_fa(_pct(snap['collected'], snap['approved_amount']))}٪) — مانده {_fmt(snap['funding_remaining'], unit)}."
                       + (f" {_fa(len(snap['pending_funding']))} مصوبه در انتظار تصویب مدیرعامل است."
                          if snap["pending_funding"] else "")),
            "links": link("تأمین مالی اعضا", "/funding", "funding"), "severity": "info",
        }
    if _has_any(q, ["خدمت", "جبران"]):
        if role == "member" and m:
            st = m["st"]
            t = st["totals"]
            return {
                "answer": (f"{_fa(len(st['services']))} خدمت به مبلغ {_fmt(t['services_total'], unit)} از سمت شما ثبت شده که "
                           f"{_fmt(t['services_pending'], unit)} آن در جریان بررسی است.")
                if st["services"] else "تاکنون خدمتی از سمت شما ثبت نشده است.",
                "links": link("وضعیت حساب من", "/my-account", "my-account"), "severity": "info",
            }
        ps = snap["pending_svc"]
        return {
            "answer": (f"{_fa(len(ps))} خدمت عضو به مبلغ {_fmt(sum(x.amount for x in ps), unit)} در جریان بررسی و جبران است؛ "
                       "پس از تأیید، سند و اعتبار تهاتر خودکار صادر می‌شود.")
            if ps else "خدمت در جریان بررسی وجود ندارد.",
            "links": link("خدمات اعضا", "/services", "services"), "severity": "info",
        }
    if _has_any(q, ["هشدار", "ریسک", "مشکل", "تکراری", "نقدینگی", "خطر"]):
        items = snap["alerts"]
        if not items:
            return {
                "answer": "در تحلیل قاعده‌محور فعلی، هشدار فعال (رشد غیرعادی هزینه، تکراری مشکوک، کسری نقدینگی یا "
                          "سررسید گذشته) یافت نشد.",
                "links": link("تحلیل‌های هوشمند", "/analytics", "analytics"), "severity": "success",
            }
        titles = "، ".join(f"«{a['title']}»" for a in items[:3]) + (" و…" if len(items) > 3 else "")
        return {
            "answer": f"{_fa(len(items))} هشدار فعال است: {titles}؛ جزئیات و فرضیات هر هشدار در تحلیل‌های هوشمند آمده است.",
            "links": link("تحلیل‌های هوشمند", "/analytics", "analytics"), "severity": "warning",
        }
    if _has_any(q, ["دوره", "بستن", "بازگشایی"]):
        if snap["period_closed"]:
            return {
                "answer": "دوره مالی فعلی بسته است؛ ثبت و تغییر اسناد مسدود است و فقط مدیر سامانه می‌تواند آن را بازگشایی کند.",
                "links": [] if role == "member" else link("تنظیمات", "/settings", "settings"),
                "severity": "danger",
            }
        bal = "متوازن است و مانعی ندارد" if snap["tb_balanced"] else "نامتوازن است — ابتدا مغایرت را رفع کنید"
        return {
            "answer": f"دوره مالی {snap['fiscal_label']} باز است. پس از نهایی‌شدن گزارش‌های سالانه، بستن دوره از "
                      f"تنظیمات انجام می‌شود و هر ثبت/ویرایش پس از آن محدود می‌شود؛ پیش از بستن، تراز آزمایشی {bal}.",
            "links": [] if role == "member" else link("تنظیمات", "/settings", "settings"), "severity": "info",
        }
    if _has_any(q, ["تراز", "دفتر", "گزارش", "سند"]):
        if snap["tb_balanced"]:
            tb_txt = "تراز آزمایشی سال مالی متوازن است (جمع بدهکار = بستانکار)"
            sev = "success"
        else:
            tb_txt = f"تراز آزمایشی سال مالی نامتوازن است (اختلاف {_fmt(abs(snap['tb_diff']), unit)})"
            sev = "warning"
        return {
            "answer": tb_txt + "؛ دفاتر روزنامه، معین و تفصیلی و اسناد خودکار مرتبط با هر هزینه/پرداخت از بخش "
                      "دفاتر و گزارش‌ها و اسناد حسابداری قابل دریافت است.",
            "links": [*link("دفاتر و گزارش‌ها", "/reports", "reports"),
                      *link("اسناد حسابداری", "/vouchers", "vouchers")],
            "severity": sev,
        }
    if _has_any(q, ["راهنما", "چه کاری", "چه کنم", "کمک", "اقدام", "باید"]):
        ov = build_overview(db, user)
        top = [i["title"] for i in ov["insights"] if i.get("actions")][:3]
        return {
            "answer": (f"بر اساس وضعیت فعلی حساب‌ها، این اقدام‌ها را در اولویت بگذارید: {'؛ '.join(top)}. "
                       "هر کارت راهنمایی در همین پنل دکمه اقدام مستقیم دارد.")
            if top else "بر اساس وضعیت فعلی، اقدام فوری لازم نیست؛ همه موارد به‌روز است.",
            "links": [], "severity": "info",
        }
    return {
        "answer": "این پرسش را دقیق متوجه نشدم، اما می‌توانم درباره این موضوعات راهنمایی کنم: وضعیت تعهد و پرداخت اعضا، "
                  "کیف پول و شارژ درگاه، هزینه‌ها و تسویه فروشندگان، سود و زیان، مصوبه‌های تأمین مالی، خدمات و جبران "
                  "اعضا، هشدارهای مالی و سطح دسترسی شما. یکی از پرسش‌های پیشنهادی را انتخاب کنید یا موضوع را دقیق‌تر بنویسید.",
        "links": [], "severity": "info",
    }


# ---------------- نقطه ورود عمومی ----------------

# کارت‌هایی که کل موضوعشان یک ماژول خاص است — بدون دسترسی، از خلاصه حذف می‌شوند
INSIGHT_MODULE = {
    "member-wallet": "wallet", "member-wallet-pending": "wallet", "wallet-charges": "wallet",
    "declared-payments": "payments", "draft-expenses": "expenses", "vendor-debt": "expenses",
    "users": "users", "profile-completeness": "settings",
}


def _gate_insights(insights: list[dict], perm) -> list[dict]:
    """گیت نهایی سطح دسترسی: هیچ اقدام یا کارتی خارج از مجوز نقش پیشنهاد نمی‌شود"""
    out = []
    for ins in insights:
        actions = [{"label": a["label"], "path": a["path"]} for a in ins.get("actions", [])
                   if perm(str(a.get("path", "")).lstrip("/").split("?")[0])]
        if ins.get("id") in INSIGHT_MODULE and not perm(INSIGHT_MODULE[ins["id"]]):
            continue
        out.append({**ins, "actions": actions})
    return out


def build_overview(db, user: dict) -> dict:
    role = user["role"]
    allowed = set(DEFAULT_ROLE_PERMS.get(role, []))
    perm = (lambda mkey: mkey in allowed)

    snap = company_snap(db)
    m = None
    if role == "member" and user.get("member_id"):
        try:
            m = _snap_member(db, user["member_id"])
        except ValueError:
            m = None

    if role == "member":
        insights = _member_insights(db, user, snap, m) if m else []
        stats = [
            {"label": "تعهد من", "value": _fmt(m["committed"], snap["unit"])},
            {"label": "پرداخت‌شده", "value": _fmt(m["paid"], snap["unit"])},
            {"label": "مانده تعهد", "value": _fmt(m["remaining"], snap["unit"])},
            {"label": "کیف پول من", "value": _fmt(m["wallet_bal"], snap["unit"])},
        ] if m else []
    else:
        insights = _staff_insights(db, user, snap, perm)
        stats = [
            {"label": "نقد و بانک", "value": _fmt(snap["cash"], snap["unit"])},
            {"label": "سود سال", "value": _fmt(snap["profit"], snap["unit"])},
            {"label": "وصول تأمین مالی", "value": _fmt(snap["collected"], snap["unit"])},
            {"label": "در انتظار تصمیم",
             "value": f"{_fa(len(snap['pending_exp']) + len(snap['pending_funding']) + len(snap['pending_svc']) + len(snap['declared_pays']))} مورد"},
        ]
    insights = _gate_insights(insights, perm)

    greeting = (
        f"سلام {user['full_name']} عزیز! این خلاصه وضعیت حساب شماست؛ برای هر موضوع پرسش کنید یا از "
        "اقدام‌های پیشنهادی استفاده کنید."
    ) if role == "member" else (
        f"سلام {user['full_name']} عزیز! این خلاصه وضعیت شرکت از نگاه نقش «{ROLE_LABELS.get(role, role)}» شماست؛ "
        "هر کارت اقدام مستقیم دارد و فقط بخش‌های مجاز شما نشان داده می‌شود."
    )
    return {
        "role": role, "role_label": ROLE_LABELS.get(role, role),
        "full_name": user["full_name"],
        "greeting": greeting,
        "role_guide": ROLE_GUIDE.get(role, ""),
        "stats": stats,
        "chips": CHIPS.get(role, ["وضعیت مالی شرکت؟", "هشدارهای امروز؟", "سطح دسترسی من؟"]),
        "insights": insights,
        "disclaimer": "پاسخ‌ها بر پایه داده واقعی سامانه تولید می‌شود؛ تصمیم نهایی با کاربر و فرایند مصوب شرکت است.",
    }


def ask_assistant(db, user: dict, question: str) -> dict:
    q = _norm2(question)
    if not q:
        raise ValueError("متن پرسش خالی است")
    role = user["role"]
    allowed = DEFAULT_ROLE_PERMS.get(role, [])
    perm = (lambda mkey: mkey in allowed)
    snap = company_snap(db)
    m = None
    if role == "member" and user.get("member_id"):
        try:
            m = _snap_member(db, user["member_id"])
        except ValueError:
            m = None
    res = _answer(db, user, snap, m, q, perm)
    res.update({"role": role, "role_label": ROLE_LABELS.get(role, role)})
    return res
