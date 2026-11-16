# -*- coding: utf-8 -*-
"""هسته حسابداری دوبل: ثبت اسناد متوازن، شماره‌گذاری، دفاتر و گزارش‌های مالی"""
from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .. import models
from ..jalali import iso_to_jalali, today_iso


# ---------------- شماره‌گذاری ----------------

def next_number(db: Session, entity: str, date_iso: str, prefix_map: dict) -> str:
    """شماره داخلی بر اساس سال مالی شمسی، مثلاً V-1405-0007"""
    jy = iso_to_jalali(date_iso)[0]
    year = jy
    row = db.execute(
        select(models.Counter).where(models.Counter.entity == entity, models.Counter.year == year)
    ).scalar_one_or_none()
    if row is None:
        row = models.Counter(entity=entity, year=year, val=0)
        db.add(row)
        db.flush()
    row.val += 1
    prefix = prefix_map.get(entity, entity.upper())
    return f"{prefix}-{year}-{row.val:04d}"


# ---------------- ردپای حسابرسی ----------------

def log(db: Session, user, action: str, entity: str, entity_id: int | None, details: dict):
    db.add(models.AuditLog(
        username=user["username"] if isinstance(user, dict) else getattr(user, "username", ""),
        action=action, entity=entity, entity_id=entity_id,
        details=json.dumps(details, ensure_ascii=False, default=str),
    ))


# ---------------- ثبت سند ----------------

def validate_lines(db: Session, lines: list[dict]) -> None:
    if not lines:
        raise ValueError("سند باید حداقل یک ردیف داشته باشد")
    td = sum(int(l.get("debit") or 0) for l in lines)
    tc = sum(int(l.get("credit") or 0) for l in lines)
    if td <= 0:
        raise ValueError("مبلغ سند نمی‌تواند صفر باشد")
    if td != tc:
        raise ValueError(f"سند نامتوازن است: بدهکار {td:,} ≠ بستانکار {tc:,} ریال")
    for l in lines:
        d, c = int(l.get("debit") or 0), int(l.get("credit") or 0)
        if d < 0 or c < 0:
            raise ValueError("مبالغ منفی مجاز نیست")
        if d > 0 and c > 0:
            raise ValueError("یک ردیف نمی‌تواند هم‌زمان بدهکار و بستانکار باشد")
        acc = db.execute(select(models.Account).where(models.Account.code == l["account_code"])).scalar_one_or_none()
        if acc is None:
            raise ValueError(f"کد حساب {l['account_code']} یافت نشد")
        if not acc.is_active:
            raise ValueError(f"حساب {acc.name} غیرفعال است")


def post_voucher(db: Session, *, vdate: str, description: str, lines: list[dict],
                 source_type: str = "manual", source_id: int | None = None,
                 idem_key: str | None = None, user=None, confirm: bool = True) -> models.Voucher:
    """ثبت اتمیک سند؛ idem_key تکراری منجر به سند جدید نمی‌شود"""
    if idem_key:
        existing = db.execute(select(models.Voucher).where(models.Voucher.idem_key == idem_key)).scalar_one_or_none()
        if existing:
            return existing
    validate_lines(db, lines)
    username = user["username"] if isinstance(user, dict) else getattr(user, "username", "system")
    v = models.Voucher(
        no=next_number(db, "voucher", vdate, {"voucher": "V"}),
        vdate=vdate, description=description,
        status="confirmed" if confirm else "draft",
        source_type=source_type, source_id=source_id, idem_key=idem_key or "",
        created_by=username,
        confirmed_by=username if confirm else "",
        confirmed_at=datetime.now() if confirm else None,
    )
    for l in lines:
        v.lines.append(models.VLine(
            account_code=l["account_code"],
            tafsil_id=l.get("tafsil_id"),
            tafsil_name=l.get("tafsil_name") or "",
            debit=int(l.get("debit") or 0),
            credit=int(l.get("credit") or 0),
            description=l.get("description") or description,
            project_id=l.get("project_id"),
        ))
    db.add(v)
    db.flush()
    if user is not None:
        log(db, user, "post_voucher", "voucher", v.id,
            {"no": v.no, "debit": sum(l.debit for l in v.lines), "source": f"{source_type}:{source_id}"})
    return v


def confirm_voucher(db: Session, v: models.Voucher, user) -> models.Voucher:
    if v.status == "confirmed":
        raise ValueError("سند از قبل قطعی است")
    validate_lines(db, [{"account_code": l.account_code, "debit": l.debit, "credit": l.credit} for l in v.lines])
    username = user["username"] if isinstance(user, dict) else getattr(user, "username", "")
    v.status = "confirmed"
    v.confirmed_by = username
    v.confirmed_at = datetime.now()
    log(db, user, "confirm", "voucher", v.id, {"no": v.no})
    return v


def reverse_voucher(db: Session, v: models.Voucher, user, reason: str = "") -> models.Voucher:
    """سند اصلاحی/معکوس — سند قطعی هرگز مستقیم تغییر نمی‌کند"""
    if v.status != "confirmed":
        raise ValueError("فقط سند قطعی قابل ابطال است")
    if db.execute(select(models.Voucher).where(models.Voucher.reversal_of == v.id)).scalar_one_or_none():
        raise ValueError("این سند قبلاً ابطال شده است")
    lines = [{"account_code": l.account_code, "tafsil_id": l.tafsil_id, "tafsil_name": l.tafsil_name,
              "debit": l.credit, "credit": l.debit,
              "description": f"ابطال سند {v.no} — {l.description}"} for l in v.lines]
    rv = post_voucher(db, vdate=today_iso(), description=f"ابطال سند {v.no}" + (f" — {reason}" if reason else ""),
                      lines=lines, source_type="reversal", source_id=v.id,
                      idem_key=f"rev:{v.id}", user=user)
    rv.reversal_of = v.id
    log(db, user, "reverse", "voucher", v.id, {"reversal_no": rv.no, "reason": reason})
    return rv


# ---------------- ابزارهای حساب/تفصیلی ----------------

def get_tafsil_for_member(db: Session, member_id: int) -> models.Tafsil | None:
    return db.execute(select(models.Tafsil).where(
        models.Tafsil.ttype == "member", models.Tafsil.ref_id == member_id)).scalar_one_or_none()


def get_tafsil_for_bank(db: Session, bank_id: int) -> models.Tafsil | None:
    return db.execute(select(models.Tafsil).where(
        models.Tafsil.ttype == "bank", models.Tafsil.ref_id == bank_id)).scalar_one_or_none()


def get_or_create_party_tafsil(db: Session, name: str) -> models.Tafsil:
    t = db.execute(select(models.Tafsil).where(
        models.Tafsil.ttype == "party", models.Tafsil.name == name)).scalar_one_or_none()
    if t is None:
        t = models.Tafsil(ttype="party", name=name)
        db.add(t)
        db.flush()
    return t


def bank_account_code(db: Session, bank_id: int | None) -> str:
    """کد معین بانک (مثلاً 11021) در صورت وجود، وگرنه کل 1102؛ صندوق 1101"""
    if bank_id:
        b = db.get(models.BankAccount, bank_id)
        if b and b.kind == "cash":
            return "1101"
        moin = db.execute(select(models.Account).where(models.Account.parent_code == "1102")
                          .order_by(models.Account.code)).scalars().all()
        # هر بانک یک معین دارد؛ بانک صدمین معین را بر اساس ترتیب انتخاب می‌کنیم
        if b and moin:
            idx = (b.id - 1) % len(moin) if len(moin) > 1 else 0
            return moin[idx].code
        return "1102"
    return "1101"


# ---------------- دفاتر و گزارش‌ها ----------------

CONFIRMED = models.Voucher.status == "confirmed"


def _base_query(db: Session, date_from: str | None, date_to: str | None):
    q = db.execute(
        select(models.VLine, models.Voucher)
        .join(models.Voucher, models.VLine.voucher_id == models.Voucher.id)
        .where(CONFIRMED)
    ).all()
    rows = [(l, v) for (l, v) in q
            if (not date_from or v.vdate >= date_from) and (not date_to or v.vdate <= date_to)]
    rows.sort(key=lambda t: (t[1].vdate, t[1].id, t[0].id))
    return rows


def journal_rows(db: Session, date_from=None, date_to=None, voucher_no=None,
                 account_code=None, tafsil_id=None) -> list[dict]:
    out = []
    for l, v in _base_query(db, date_from, date_to):
        if voucher_no and voucher_no.lower() not in v.no.lower():
            continue
        if account_code and not l.account_code.startswith(account_code):
            continue
        if tafsil_id and l.tafsil_id != tafsil_id:
            continue
        out.append({
            "voucher_id": v.id, "voucher_no": v.no, "date": v.vdate,
            "voucher_desc": v.description, "line_desc": l.description,
            "account_code": l.account_code,
            "account_name": _acc_name(db, l.account_code),
            "tafsil": l.tafsil_name, "debit": l.debit, "credit": l.credit,
            "source_type": v.source_type, "status": v.status,
        })
    return out


def _acc_name(db: Session, code: str) -> str:
    acc = db.execute(select(models.Account).where(models.Account.code == code)).scalar_one_or_none()
    return acc.name if acc else code


def _moin_balances(db: Session, date_from=None, date_to=None) -> dict[str, dict]:
    """مانده و گردش هر کد حساب (معین/کل) — مانده بدهکار مثبت است"""
    res: dict[str, dict] = {}
    for l, v in _base_query(db, date_from, date_to):
        key = l.account_code
        r = res.setdefault(key, {"debit": 0, "credit": 0})
        r["debit"] += l.debit
        r["credit"] += l.credit
    return res


def general_ledger(db: Session, date_from=None, date_to=None) -> list[dict]:
    """دفتر کل — گردش و مانده سطح کل (۴ رقم)"""
    moin = _moin_balances(db, date_from, date_to)
    agg: dict[str, dict] = {}
    for code, r in moin.items():
        col = code[:4]
        a = agg.setdefault(col, {"debit": 0, "credit": 0})
        a["debit"] += r["debit"]
        a["credit"] += r["credit"]
    out = []
    for col in sorted(agg):
        acc = db.execute(select(models.Account).where(models.Account.code == col)).scalar_one_or_none()
        d, c = agg[col]["debit"], agg[col]["credit"]
        net = d - c
        out.append({
            "code": col, "name": acc.name if acc else col,
            "acc_type": acc.acc_type if acc else "",
            "debit": d, "credit": c,
            "balance_debit": net if net > 0 else 0,
            "balance_credit": -net if net < 0 else 0,
        })
    return out


def moin_ledger(db: Session, account_code: str, date_from=None, date_to=None) -> list[dict]:
    """دفتر معین/تفصیلی گردش یک کد حساب با مانده تجمعی"""
    rows, bal = [], 0
    acc = db.execute(select(models.Account).where(models.Account.code == account_code)).scalar_one_or_none()
    nature = acc.nature if acc else "debit"
    for l, v in _base_query(db, date_from, date_to):
        if l.account_code != account_code and not (len(account_code) == 4 and l.account_code.startswith(account_code)):
            continue
        bal += (l.debit - l.credit) if nature == "debit" else (l.credit - l.debit)
        rows.append({
            "date": v.vdate, "voucher_no": v.no, "voucher_desc": v.description,
            "line_desc": l.description, "tafsil": l.tafsil_name,
            "account_code": l.account_code, "account_name": _acc_name(db, l.account_code),
            "debit": l.debit, "credit": l.credit, "balance": bal,
        })
    return rows


def tafsil_ledger(db: Session, tafsil_id: int, date_from=None, date_to=None) -> list[dict]:
    """گردش تفصیلی یک شخص/عضو/بانک در همه حساب‌ها"""
    t = db.get(models.Tafsil, tafsil_id)
    rows, bal = [], 0
    for l, v in _base_query(db, date_from, date_to):
        if l.tafsil_id != tafsil_id:
            continue
        bal += l.debit - l.credit
        rows.append({
            "date": v.vdate, "voucher_no": v.no, "voucher_desc": v.description,
            "account_code": l.account_code, "account_name": _acc_name(db, l.account_code),
            "line_desc": l.description, "debit": l.debit, "credit": l.credit, "balance": bal,
        })
    return rows


def trial_balance(db: Session, date_from=None, date_to=None) -> list[dict]:
    """تراز آزمایشی سطح کل: مانده اول، گردش دوره، مانده پایان"""
    opening = _moin_balances(db, None, (date_from and _day_before(date_from)) or None) if date_from else {}
    movement = _moin_balances(db, date_from, date_to)
    cols: dict[str, dict] = {}
    for code, r in opening.items():
        a = cols.setdefault(code[:4], {"od": 0, "oc": 0, "md": 0, "mc": 0})
        a["od"] += r["debit"]
        a["oc"] += r["credit"]
    for code, r in movement.items():
        a = cols.setdefault(code[:4], {"od": 0, "oc": 0, "md": 0, "mc": 0})
        a["md"] += r["debit"]
        a["mc"] += r["credit"]
    out = []
    for col in sorted(cols):
        acc = db.execute(select(models.Account).where(models.Account.code == col)).scalar_one_or_none()
        a = cols[col]
        o, m = a["od"] - a["oc"], a["md"] - a["mc"]
        closing = o + m
        out.append({
            "code": col, "name": acc.name if acc else col,
            "acc_type": acc.acc_type if acc else "",
            "open_debit": a["od"], "open_credit": a["oc"],
            "move_debit": a["md"], "move_credit": a["mc"],
            "close_debit": closing if closing > 0 else 0,
            "close_credit": -closing if closing < 0 else 0,
        })
    return out


def _day_before(iso: str) -> str:
    from datetime import date as _d, timedelta as _t
    return (_d.fromisoformat(iso) - _t(days=1)).isoformat()


def pnl(db: Session, date_from=None, date_to=None) -> dict:
    """صورت سود و زیان"""
    gl = {g["code"]: g for g in general_ledger(db, date_from, date_to)}
    revenues, expenses = [], []
    for code, g in gl.items():
        if code.startswith("4"):
            revenues.append({"code": code, "name": g["name"], "amount": g["credit"] - g["debit"]})
        elif code.startswith("5"):
            expenses.append({"code": code, "name": g["name"], "amount": g["debit"] - g["credit"]})
    total_rev = sum(r["amount"] for r in revenues)
    total_exp = sum(e["amount"] for e in expenses)
    return {"revenues": revenues, "expenses": expenses,
            "total_revenue": total_rev, "total_expense": total_exp,
            "profit": total_rev - total_exp}


def balance_sheet(db: Session, as_of: str | None = None) -> dict:
    """صورت وضعیت مالی (ترازنامه) — سود دوره به‌عنوان عدد تعدیل"""
    gl = {g["code"]: g for g in general_ledger(db, None, as_of)}
    assets, liabilities, equity = [], [], []
    for code, g in gl.items():
        if code.startswith("1"):
            assets.append({"code": code, "name": g["name"], "amount": g["balance_debit"] - g["balance_credit"]})
        elif code.startswith("2"):
            liabilities.append({"code": code, "name": g["name"], "amount": g["balance_credit"] - g["balance_debit"]})
        elif code.startswith("3"):
            equity.append({"code": code, "name": g["name"], "amount": g["balance_credit"] - g["balance_debit"]})
    total_assets = sum(a["amount"] for a in assets)
    total_liab = sum(a["amount"] for a in liabilities)
    total_eq = sum(e["amount"] for e in equity)
    profit = pnl(db, None, as_of)["profit"]
    return {
        "assets": assets, "liabilities": liabilities, "equity": equity,
        "total_assets": total_assets, "total_liabilities": total_liab,
        "total_equity": total_eq + profit, "profit": profit,
        "check": total_assets - total_liab - total_eq - profit,
    }


def cash_balance(db: Session, as_of: str | None = None) -> dict:
    """موجودی نقد و بانک به تفکیک (فقط کدهای ۱۱۰۱ صندوق و ۱۱۰۲ بانک‌ها)"""
    rows = _base_query(db, None, as_of)
    out = {}
    for l, v in rows:
        if l.account_code == "1101" or l.account_code.startswith("1102"):
            out[l.account_code] = out.get(l.account_code, 0) + l.debit - l.credit
    return out


def account_has_movement(db: Session, code: str) -> bool:
    return db.execute(
        select(models.VLine.id).join(models.Voucher, models.VLine.voucher_id == models.Voucher.id)
        .where(models.VLine.account_code == code, CONFIRMED).limit(1)
    ).scalar_one_or_none() is not None
