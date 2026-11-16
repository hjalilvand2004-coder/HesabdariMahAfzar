# -*- coding: utf-8 -*-
"""تأمین مالی اعضا: تقسیم دقیق مبلغ مصوب (با کنترل گرد کردن)، تعهدات، پرداخت‌ها و تهاتر"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


# ---------------- تقسیم مبلغ بین اعضا ----------------

def _largest_remainder(amount: int, weights: list[tuple[int, float]]) -> list[int]:
    """تقسیم exact مبلغ بر اساس وزن‌ها؛ اختلاف گرد کردن با روش بزرگ‌ترین باقیمانده
    صفر می‌شود تا مجموع تعهدات دقیقاً برابر مبلغ مصوب باشد. weights: [(key, weight)]"""
    total_w = sum(w for _, w in weights)
    if total_w <= 0:
        raise ValueError("مجموع وزن‌ها باید بزرگ‌تر از صفر باشد")
    raw = []
    for key, w in weights:
        exact = amount * w / total_w
        raw.append((key, exact, exact - int(exact // 1)))
    floors = [(key, int(exact // 1)) for key, exact, _ in raw]
    distributed = sum(f for _, f in floors)
    remainder = amount - distributed
    if remainder > 0:
        ordered = sorted(raw, key=lambda t: (-t[2], t[0]))
        keys_extra = [k for k, _, _ in ordered[:remainder]]
        for k in keys_extra:
            floors = [(kk, v + (1 if kk == k else 0)) for kk, v in floors]
    out = dict(floors)
    assert sum(out.values()) == amount, "خطای گرد کردن در تقسیم"
    return [out[k] for k, _ in weights]


def member_share_bp_at(db: Session, member_id: int, base_date: str | None) -> int:
    """درصد سهام فعال عضو در تاریخ مبنای مصوبه؛ اگر تاریخ ندارد، آخرین سهم آغازشده"""
    q = select(models.Share).where(models.Share.member_id == member_id)
    shares = db.execute(q.order_by(models.Share.from_date)).scalars().all()
    candidates = [s for s in shares
                  if s.from_date <= (base_date or "9999-99-99")
                  and (not s.to_date or s.to_date >= (base_date or "0000-00-00"))]
    if base_date:
        exact = [s for s in candidates if s.from_date <= base_date and (not s.to_date or s.to_date >= base_date)]
        if exact:
            return sorted(exact, key=lambda s: s.from_date)[-1].percent_bp
    if shares:
        return sorted(shares, key=lambda s: s.from_date)[-1].percent_bp
    return 0


def calc_split(db: Session, *, amount: int, method: str, member_ids: list[int],
               percents: dict | None = None, fixed_amounts: dict | None = None,
               base_date: str | None = None) -> list[dict]:
    """محاسبه پیش‌نمایش/نهایی سهم اعضا — خروجی: [{member_id, share_bp, amount}]"""
    if amount <= 0:
        raise ValueError("مبلغ باید مثبت باشد")
    if not member_ids:
        raise ValueError("حداقل یک عضو باید انتخاب شود")
    rows: list[dict] = []
    if method == "fixed":
        items = []
        for mid in member_ids:
            v = int((fixed_amounts or {}).get(str(mid)) or (fixed_amounts or {}).get(mid) or 0)
            items.append((mid, v))
        diff = amount - sum(v for _, v in items)
        if diff != 0:
            raise ValueError(f"مجموع مبالغ ثابت با مبلغ مصوب برابر نیست؛ اختلاف: {diff:,} ریال")
        for mid, v in items:
            bp = member_share_bp_at(db, mid, base_date)
            rows.append({"member_id": mid, "share_bp": bp, "amount": v})
        return rows
    if method == "equal":
        amounts = _largest_remainder(amount, [(mid, 1.0) for mid in member_ids])
        for mid, a in zip(member_ids, amounts):
            bp = member_share_bp_at(db, mid, base_date)
            rows.append({"member_id": mid, "share_bp": bp, "amount": a})
        return rows
    # share یا custom
    weights = []
    for mid in member_ids:
        bp = int((percents or {}).get(str(mid)) or (percents or {}).get(mid) or 0) \
            if method == "custom" else member_share_bp_at(db, mid, base_date)
        if bp <= 0:
            raise ValueError(f"درصد سهم عضو شماره {mid} برای تاریخ مبنای انتخابی یافت نشد")
        weights.append((mid, float(bp)))
    total_bp = sum(int(w) for _, w in weights)
    if method == "custom" and total_bp != 10000:
        raise ValueError("مجموع درصدهای توافقی باید دقیقاً ۱۰۰٪ باشد")
    amounts = _largest_remainder(amount, weights)
    for (mid, bp), a in zip(weights, amounts):
        rows.append({"member_id": mid, "share_bp": int(bp), "amount": a})
    return rows


# ---------------- تعهدات و تخصیص ----------------

def create_commitments(db: Session, funding: models.FundingRequest, rows: list[dict]):
    for r in rows:
        db.add(models.Commitment(funding_id=funding.id, member_id=r["member_id"],
                                 share_bp=r["share_bp"], amount=r["amount"], paid=0))


def commitment_paid_actual(db: Session, c: models.Commitment) -> int:
    """جمع واقعی تخصیص‌ها به تعهد (از پرداخت‌های تأییدشده + تهاترها)"""
    from sqlalchemy import func
    s = db.execute(select(func.sum(models.Allocation.amount)).where(
        models.Allocation.commitment_id == c.id)).scalar() or 0
    return int(s)


def open_commitments(db: Session, member_id: int, funding_id: int | None = None) -> list[models.Commitment]:
    q = (select(models.Commitment)
         .join(models.FundingRequest, models.Commitment.funding_id == models.FundingRequest.id)
         .where(models.Commitment.member_id == member_id,
                models.FundingRequest.status == "approved"))
    if funding_id:
        q = q.where(models.Commitment.funding_id == funding_id)
    out = db.execute(q.order_by(models.FundingRequest.id)).scalars().all()
    return [c for c in out if commitment_paid_actual(db, c) < c.amount]


def allocate_amount(db: Session, *, commitment: models.Commitment, amount: int,
                    payment_id: int | None = None, credit_id: int | None = None, user=None) -> int:
    """تخصیص مبلغ به تعهد؛ خروجی: مقدار واقعی تخصیص‌یافته"""
    remaining_c = commitment.amount - commitment_paid_actual(db, commitment)
    take = min(amount, remaining_c)
    if take <= 0:
        return 0
    db.add(models.Allocation(payment_id=payment_id, credit_id=credit_id,
                             commitment_id=commitment.id, amount=take))
    db.flush()
    commitment.paid = commitment_paid_actual(db, commitment)
    if user is not None:
        from .accounting import log
        log(db, user, "allocate", "commitment", commitment.id, {"amount": take})
    return take


def auto_allocate(db: Session, *, member_id: int, amount: int,
                  payment_id: int | None = None, credit_id: int | None = None,
                  funding_id: int | None = None, user=None) -> int:
    """تخصیص خودکار FIFO به تعهدهای بازِ عضو؛ مبلغ اضافی تخصیص‌نیافته برمی‌گردد"""
    left = amount
    for c in open_commitments(db, member_id, funding_id):
        if left <= 0:
            break
        take = allocate_amount(db, commitment=c, amount=left,
                               payment_id=payment_id, credit_id=credit_id, user=user)
        left -= take
    return left  # اعتبار تخصیص‌نیافته (طلب عضو)


# ---------------- وضعیت حساب عضو ----------------

def member_statement(db: Session, member_id: int) -> dict:
    member = db.get(models.Member, member_id)
    if member is None:
        raise ValueError("عضو یافت نشد")
    comms = db.execute(
        select(models.Commitment)
        .join(models.FundingRequest, models.Commitment.funding_id == models.FundingRequest.id)
        .where(models.Commitment.member_id == member_id,
               models.FundingRequest.status == "approved")
        .order_by(models.FundingRequest.id)).scalars().all()
    comm_rows = []
    for c in comms:
        paid = commitment_paid_actual(db, c)
        comm_rows.append({
            "id": c.id, "funding_id": c.funding_id, "funding_no": c.funding.no,
            "funding_title": c.funding.title, "funding_type": c.funding.ftype,
            "due_date": c.funding.due_date, "share_bp": c.share_bp,
            "amount": c.amount, "paid": paid, "remaining": max(c.amount - paid, 0),
            "settled": paid >= c.amount,
        })
    payments = db.execute(select(models.Payment).where(
        models.Payment.member_id == member_id).order_by(models.Payment.id)).scalars().all()
    pay_rows = []
    for p in payments:
        alloc = sum(a.amount for a in db.execute(select(models.Allocation).where(
            models.Allocation.payment_id == p.id)).scalars())
        f = db.get(models.FundingRequest, p.funding_id) if p.funding_id else None
        pay_rows.append({
            "id": p.id, "no": p.no, "pay_date": p.pay_date, "amount": p.amount,
            "method": p.method, "status": p.status, "tracking_no": p.tracking_no,
            "funding_no": (f.no if f else ""), "allocated": alloc,
            "unallocated": (p.amount - alloc) if p.status == "approved" else 0,
        })
    credits = db.execute(select(models.OffsetCredit).where(
        models.OffsetCredit.member_id == member_id).order_by(models.OffsetCredit.id)).scalars().all()
    credit_rows = []
    for cr in credits:
        exp = db.get(models.Expense, cr.expense_id)
        credit_rows.append({
            "id": cr.id, "amount": cr.amount, "remaining": cr.remaining,
            "expense_no": exp.no if exp else "", "expense_title": exp.title if exp else "",
            "date": (exp.exp_date if exp else ""), "note": cr.note,
        })
    # مانده دفتری هر نوع حساب این عضو (تفصیلی عضو)
    taf = db.execute(select(models.Tafsil).where(
        models.Tafsil.ttype == "member", models.Tafsil.ref_id == member_id)).scalar_one_or_none()
    balances = {"current": 0, "loan": 0, "capital": 0, "debit_total": 0, "credit_total": 0}
    if taf:
        from .accounting import _base_query
        for l, v in _base_query(db, None, None):
            if l.tafsil_id != taf.id:
                continue
            if l.account_code == "2102":
                balances["current"] += l.credit - l.debit
            elif l.account_code == "2103":
                balances["loan"] += l.credit - l.debit
            elif l.account_code == "3101":
                balances["capital"] += l.credit - l.debit
            balances["debit_total"] += l.debit
            balances["credit_total"] += l.credit
    total_commit = sum(r["amount"] for r in comm_rows)
    total_paid_commit = sum(r["paid"] for r in comm_rows)
    total_paid_cash = sum(p["amount"] for p in pay_rows if p["status"] == "approved")
    total_credit = sum(c["amount"] for c in credit_rows)
    total_alloc = sum(a.amount for a in db.execute(
        select(models.Allocation).join(models.Commitment, models.Allocation.commitment_id == models.Commitment.id)
        .where(models.Commitment.member_id == member_id)).scalars())
    return {
        "member": {"id": member.id, "code": member.code, "full_name": member.full_name,
                   "kind": member.kind, "phone": member.phone},
        "share_now": member_share_bp_at(db, member_id, None),
        "commitments": comm_rows,
        "payments": pay_rows,
        "credits": credit_rows,
        "balances": balances,
        "totals": {
            "commitments": total_commit,
            "commitments_paid": total_paid_commit,
            "commitments_remaining": total_commit - total_paid_commit,
            "payments_cash": total_paid_cash,
            "expense_credits": total_credit,
            "total_settled": total_alloc,
            "unallocated_credit": total_paid_cash + total_credit - total_alloc,
        },
    }
