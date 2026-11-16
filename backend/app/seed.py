# -*- coding: utf-8 -*-
"""داده اولیه نمونه — همه عملیات از طریق سرویس‌های واقعی ثبت می‌شود تا اسناد دقیقاً هم‌خوان باشند"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal, Base, engine
from .security import hash_password
from .services.accounting import log, post_voucher, get_tafsil_for_bank
from .services.financing import calc_split, create_commitments
from .jalali import jalali_to_iso, fiscal_year_range

MEMBERS = [
    {"code": "M-1001", "full_name": "علی محمدی", "kind": "person",
     "national_id": "0076543210", "phone": "۰۹۱۲۱۲۳۴۵۶۷", "email": "ali@parsdadeh.ir",
     "bank_account": "ملت ۳۳۲۱۱۰۹۸۷۶", "share_bp": 5000},
    {"code": "M-1002", "full_name": "سارا احمدی", "kind": "person",
     "national_id": "0045678912", "phone": "۰۹۳۵۱۱۲۲۳۳۴", "email": "sara@parsdadeh.ir",
     "bank_account": "سامان ۰۴۵۶۷۸۹۰۱۲۳", "share_bp": 3000},
    {"code": "M-1003", "full_name": "رضا کریمی", "kind": "legal",
     "national_id": "14001234567", "phone": "۰۹۱۹۷۷۷۸۸۹۹", "email": "reza@karimi-co.ir",
     "bank_account": "تجارت ۲۱۵۵۴۴۳۳۲۲", "share_bp": 2000},
    {"code": "M-1004", "full_name": "مینا رضایی", "kind": "person",
     "national_id": "0067891234", "phone": "۰۹۳۳۵۵۵۱۲۳۴", "email": "mina@parsdadeh.ir",
     "bank_account": "", "share_bp": 0},
]

ACCOUNTS = [
    # گروه
    ("1", "دارایی‌ها", "group", None, "asset", "debit"),
    ("2", "بدهی‌ها", "group", None, "liability", "credit"),
    ("3", "حقوق مالکانه", "group", None, "equity", "credit"),
    ("4", "درآمدها", "group", None, "income", "credit"),
    ("5", "هزینه‌ها", "group", None, "expense", "debit"),
    # کل و معین دارایی
    ("1101", "صندوق", "col", "1", "asset", "debit"),
    ("1102", "بانک‌ها", "col", "1", "asset", "debit"),
    ("11021", "بانک ملت — جاری شرکت", "moin", "1102", "asset", "debit"),
    ("1103", "حساب‌های دریافتنی از اعضا", "col", "1", "asset", "debit"),
    ("1201", "پیش‌پرداخت‌ها و سپرده‌ها", "col", "1", "asset", "debit"),
    ("1301", "دارایی‌های ثابت — تجهیزات", "col", "1", "asset", "debit"),
    # بدهی‌ها
    ("2101", "حساب‌های پرداختنی تجاری", "col", "2", "liability", "credit"),
    ("2102", "جاری شرکا و اعضا", "col", "2", "liability", "credit"),
    ("2103", "وام‌های دریافتی از اعضا", "col", "2", "liability", "credit"),
    ("2104", "ودیعه‌ها و سایر پرداختنی‌ها", "col", "2", "liability", "credit"),
    # حقوق مالکانه
    ("3101", "سرمایه", "col", "3", "equity", "credit"),
    ("3102", "سود انباشته", "col", "3", "equity", "credit"),
    # درآمد
    ("4101", "درآمد ارائه خدمات و فروش", "col", "4", "income", "credit"),
    ("4102", "سایر درآمدها", "col", "4", "income", "credit"),
    # هزینه
    ("5101", "هزینه پرسنلی", "col", "5", "expense", "debit"),
    ("51011", "حقوق و دستمزد", "moin", "5101", "expense", "debit"),
    ("51012", "بیمه و عوارض پرسنلی", "moin", "5101", "expense", "debit"),
    ("5102", "هزینه اجاره", "col", "5", "expense", "debit"),
    ("51021", "اجاره دفتر مرکزی", "moin", "5102", "expense", "debit"),
    ("5103", "تجهیزات و ملزومات", "col", "5", "expense", "debit"),
    ("51031", "تجهیزات اداری", "moin", "5103", "expense", "debit"),
    ("51032", "ملزومات مصرفی", "moin", "5103", "expense", "debit"),
    ("5104", "خدمات و مشاوره", "col", "5", "expense", "debit"),
    ("51041", "خدمات فنی و نرم‌افزاری", "moin", "5104", "expense", "debit"),
    ("5105", "هزینه حمل‌ونقل", "col", "5", "expense", "debit"),
    ("5106", "تبلیغات و بازاریابی", "col", "5", "expense", "debit"),
    ("5107", "ارتباطات و انرژی", "col", "5", "expense", "debit"),
    ("51071", "اینترنت و ارتباطات", "moin", "5107", "expense", "debit"),
    ("51072", "آب، برق و گاز", "moin", "5107", "expense", "debit"),
    ("5108", "بیمه و مالیات و عوارض", "col", "5", "expense", "debit"),
    ("5109", "سایر هزینه‌های عملیاتی", "col", "5", "expense", "debit"),
]

TOMAN = 10  # مبالغ این فایل به تومان نوشته شده و در ریال ذخیره می‌شود


def seed(db: Session):
    if db.execute(select(models.User)).scalars().first():
        return False

    import secrets
    # ---- تنظیمات
    fs, fe = fiscal_year_range(1405)
    db.add(models.Setting(
        id=1, company_name="شرکت توسعه فناوری پارس‌داده", company_national_id="14009876543",
        currency_display="toman", member_sees_all_expenses=False, auto_offset=True,
        fiscal_label="1405", fiscal_start=fs, fiscal_end=fe,
        secret=secrets.token_hex(24), base_share_date="2025-03-21"))

    # ---- کاربران نمونه (رمز همه: 123456)
    def mk_user(u, name, role, member=None):
        return models.User(username=u, pw_hash=hash_password("123456"),
                           full_name=name, role=role, member_id=member)
    db.add(mk_user("admin", "مدیر سامانه", "admin"))
    db.add(mk_user("finance", "هما صفایی", "finance"))
    db.add(mk_user("acc", "امیر توکلی", "accountant"))
    db.add(mk_user("ceo", "دکتر بهرام نادری", "ceo"))
    db.add(mk_user("audit", "شرکت حسابرسی راهبر", "auditor"))

    # ---- اعضا و سهام
    member_ids = {}
    for md in MEMBERS:
        m = models.Member(code=md["code"], full_name=md["full_name"], kind=md["kind"],
                          national_id=md["national_id"], phone=md["phone"],
                          email=md["email"], bank_account=md["bank_account"])
        db.add(m)
        db.flush()
        member_ids[md["code"]] = m.id
        db.add(models.Tafsil(ttype="member", name=m.full_name, ref_id=m.id))
        if md["share_bp"]:
            db.add(models.Share(member_id=m.id, percent_bp=md["share_bp"],
                                from_date="2025-03-21", doc_ref="صورتجلسه مجمع ۱۴۰۳"))

    db.add(mk_user("ali", "علی محمدی (عضو)", "member", member_ids["M-1001"]))
    db.add(mk_user("sara", "سارا احمدی (عضو)", "member", member_ids["M-1002"]))
    db.add(mk_user("reza", "رضا کریمی (عضو)", "member", member_ids["M-1003"]))

    # ---- بانک، صندوق، پروژه‌ها
    db.add(models.BankAccount(name="بانک ملت — جاری شرکت", bank_name="ملت",
                              account_no="3321109876", kind="bank"))
    db.add(models.BankAccount(name="صندوق شرکت", bank_name="", account_no="", kind="cash"))
    db.flush()
    db.add(models.Tafsil(ttype="bank", name="بانک ملت — جاری شرکت", ref_id=1))
    db.add(models.Tafsil(ttype="bank", name="صندوق شرکت", ref_id=2))
    for name in ["پلتفرم فروش آنلاین", "سامانه داخلی", "عمومی"]:
        db.add(models.Project(name=name))
    db.flush()

    # ---- کدینگ حساب‌ها
    for code, name, level, parent, t, nat in ACCOUNTS:
        db.add(models.Account(code=code, name=name, level=level,
                              parent_code=parent, acc_type=t, nature=nat))
    db.flush()

    bank_mellat = db.execute(select(models.BankAccount).where(
        models.BankAccount.kind == "bank")).scalar_one()

    # ---- هزینه‌ها (همه به تومان × ۱۰ = ریال)
    def add_expense(**kw):
        cnt = kw.pop("_idx", 0)
        defaults = dict(appr_status="draft", payer_type="company", paid_via="bank",
                        bank_id=bank_mellat.id, asset_kind="expense", pay_status="unpaid",
                        created_by="acc", base_amount=0, tax_amount=0, total_amount=0,
                        entry_date=kw["exp_date"], party_name="", invoice_no="",
                        project_id=3, approved_by="")
        defaults.update(kw)
        e = models.Expense(no=f"H-1405-{cnt:04d}", **defaults)
        db.add(e)
        db.flush()
        return e

    idx = 0
    # اجاره دفتر اردیبهشت تا آبان (مصوب تکرارشونده)
    rent_days = {2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10}
    for jm, jd in rent_days.items():
        idx += 1
        iso = jalali_to_iso(1405, jm, jd)
        add_expense(exp_date=iso, title=f"اجاره دفتر مرکزی — ماه {_m(jm)}",
                    description="قرارداد اجاره سالانه دفتر مرکزی، اقساط ماهانه",
                    base_amount=60_000_000 * TOMAN, total_amount=60_000_000 * TOMAN,
                    party_name="ملکیت آریا", category_code="51021",
                    project_id=3, pay_status="paid", appr_status="approved",
                    approved_by="ceo", invoice_no=f"RENT-1405{jm:02d}", _idx=idx)
    # حقوق پرسنلی تیر/مرداد/شهریور
    for jm in (4, 5, 6):
        idx += 1
        add_expense(exp_date=jalali_to_iso(1405, jm, 28),
                    title=f"حقوق و دستمزد کارکنان — {_m(jm)}",
                    description="حقوق ثابت، مزایا و بیمه سهم شرکت",
                    base_amount=45_000_000 * TOMAN, total_amount=45_000_000 * TOMAN,
                    party_name="پرسنل شرکت", category_code="51011",
                    project_id=3, pay_status="paid", appr_status="approved",
                    approved_by="ceo", _idx=idx)
    # تجهیزات (دارایی ثابت) نسیه با مالیات ۱۰٪
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 6, 5), title="خرید تجهیزات سرور و ایستگاه کاری",
                description="۲ سرور و ۳ ایستگاه کاری — خرید نسیه، اقساط به فروشنده",
                base_amount=85_000_000 * TOMAN, tax_amount=8_500_000 * TOMAN,
                total_amount=93_500_000 * TOMAN, party_name="فروشگاه تجهیزات پیشتاز",
                category_code="1301", asset_kind="asset", project_id=1,
                pay_status="unpaid", appr_status="approved", approved_by="ceo",
                invoice_no="INV-4521", _idx=idx)
    # خدمات فنی پرداخت‌شده توسط عضو (رضا کریمی)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 7, 12), title="توسعه ماژول درگاه پرداخت",
                description="پرداخت مستقیم از حساب شخصی عضو توسط رضا کریمی",
                base_amount=38_000_000 * TOMAN, total_amount=38_000_000 * TOMAN,
                party_name="استودیو داده‌پرداز", category_code="51041",
                project_id=1, payer_type="member",
                payer_member_id=member_ids["M-1003"],
                pay_status="paid", appr_status="approved", approved_by="ceo",
                invoice_no="DP-9123", _idx=idx)
    # تبلیغات، حمل‌ونقل، ارتباطات
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 7, 20), title="کمپین تبلیغات دیجیتال مهر",
                description="تبلیغات شبکه‌های اجتماعی و گوگل",
                base_amount=22_000_000 * TOMAN, total_amount=22_000_000 * TOMAN,
                party_name="آژانس دیجیتال مارکتینگ گستر", category_code="5106",
                project_id=1, pay_status="paid", appr_status="approved",
                approved_by="ceo", _idx=idx)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 7, 25), title="هزینه حمل‌ونقل و پیک مهر",
                description="ارسال مرسولات و پیک",
                base_amount=7_500_000 * TOMAN, total_amount=7_500_000 * TOMAN,
                party_name="سرویس پیک سریع‌رسان", category_code="5105",
                project_id=3, paid_via="cash", bank_id=2,
                pay_status="paid", appr_status="approved", approved_by="ceo", _idx=idx)
    for jm in (5, 6, 7):
        idx += 1
        add_expense(exp_date=jalali_to_iso(1405, jm, 15), title=f"اینترنت و ارتباطات — {_m(jm)}",
                    base_amount=4_500_000 * TOMAN, total_amount=4_500_000 * TOMAN,
                    party_name="شرکت ارتباطات نگارنپا", category_code="51071",
                    project_id=3, pay_status="paid", appr_status="approved",
                    approved_by="ceo", _idx=idx)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 6, 30), title="آب، برق و گاز دفتر — مرداد",
                base_amount=3_200_000 * TOMAN, total_amount=3_200_000 * TOMAN,
                party_name="خدمات شهری", category_code="51072",
                project_id=3, pay_status="paid", appr_status="approved",
                approved_by="ceo", _idx=idx)
    # در انتظار تأیید و پیش‌نویس
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 8, 20), title="خرید ملزومات مصرفی اتاق سرور",
                base_amount=3_800_000 * TOMAN, total_amount=3_800_000 * TOMAN,
                party_name="فروشگاه تجهیزات پیشتاز", category_code="51032",
                project_id=1, appr_status="pending", invoice_no="INV-4710", _idx=idx)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 8, 23), title="سفارش طراحی هویت بصری جدید",
                base_amount=9_000_000 * TOMAN, total_amount=9_000_000 * TOMAN,
                party_name="استودیو داده‌پرداز", category_code="51041",
                project_id=1, appr_status="draft", _idx=idx)

    exps = {e.title: e for e in db.execute(select(models.Expense)).scalars()}

    # اسناد هزینه‌های تأییدشده را از طریق موتور واقعی تولید می‌کنیم
    def sys_user():
        return {"username": "system"}

    # اسناد هزینه‌های تأییدشده را از طریق موتور واقعی تولید می‌کنیم
    for e in db.execute(select(models.Expense).where(models.Expense.appr_status == "approved")).scalars():
        _post_seed_expense(db, e, sys_user())

    from .services.accounting import get_or_create_party_tafsil
    # تسویه ۵۰۰ میلیون تومان از بدهی تجهیزات به فروشنده
    equip = db.execute(select(models.Expense).where(models.Expense.invoice_no == "INV-4521")).scalar_one()
    pt = get_or_create_party_tafsil(db, equip.party_name)
    bt = get_tafsil_for_bank(db, bank_mellat.id)
    settle_amount = 50_000_000 * TOMAN  # ۵۰ میلیون تومان از ۹۳.۵ میلیون تومان بدهی
    post_voucher(db, vdate=jalali_to_iso(1405, 7, 18),
                 description=f"تسویه بخشی از بدهی هزینه {equip.no}",
                 lines=[{"account_code": "2101", "tafsil_id": pt.id, "tafsil_name": pt.name,
                         "debit": settle_amount, "description": f"پرداخت به {pt.name}"},
                        {"account_code": "11021", "tafsil_id": bt.id, "tafsil_name": bt.name,
                         "credit": settle_amount, "description": "پرداخت از بانک ملت"}],
                 source_type="expense_settle", source_id=equip.id,
                 idem_key="seed:settle:1", user=sys_user())
    equip.paid_amount = settle_amount
    equip.pay_status = "partial"

    # ---- درآمدهای فروش
    inc = [(3, 21, 280_000_000, "4101", "درآمد پلتفرم فروش — بهار ۱۴۰۵"),
           (5, 18, 190_000_000, "4101", "درآمد پلتفرم فروش — مرداد ۱۴۰۵"),
           (7, 27, 350_000_000, "4101", "درآمد پلتفرم فروش — مهر ۱۴۰۵"),
           (8, 15, 120_000_000, "4102", "درآمد پشتیبانی و آموزش — آبان ۱۴۰۵")]
    for i, (jm, jd, amount_toman, code, desc) in enumerate(inc, 1):
        post_voucher(db, vdate=jalali_to_iso(1405, jm, jd), description=desc,
                     lines=[{"account_code": "11021", "tafsil_id": bt.id, "tafsil_name": bt.name,
                             "debit": amount_toman * TOMAN, "description": "واریز درآمد فروش"},
                            {"account_code": code, "credit": amount_toman * TOMAN,
                             "description": desc}],
                     source_type="seed", idem_key=f"seed:inc:{i}", user=sys_user())

    # ---- درخواست تأمین مالی مصوب + تعهدات
    f = models.FundingRequest(
        no="F-1405-0001", title="تأمین مالی فاز نخست پلتفرم فروش آنلاین",
        description="مصوبه مجمع فوق‌العاده — تأمین هزینه‌های توسعه پلتفرم تا پایان سال",
        amount=200_000_000 * TOMAN, split_method="share",
        member_ids=[member_ids["M-1001"], member_ids["M-1002"], member_ids["M-1003"]],
        base_date="2025-03-21", due_date=jalali_to_iso(1405, 10, 1),
        ftype="current", doc_ref="صورتجلسه ۱۴۰۵/۰۳ مورخ ۱۴۰۵/۰۲/۲۵",
        project_id=1, status="approved", created_by="acc", approved_by="ceo",
        note="")
    db.add(f)
    db.flush()
    rows = calc_split(db, amount=f.amount, method="share",
                      member_ids=f.member_ids, base_date=f.base_date)
    create_commitments(db, f, rows)

    f2 = models.FundingRequest(
        no="F-1405-0002", title="خرید تجهیزات زیرساخت ابری",
        description="درخواست در انتظار تصویب مدیرعامل",
        amount=30_000_000 * TOMAN, split_method="equal",
        member_ids=[member_ids["M-1001"], member_ids["M-1002"], member_ids["M-1003"]],
        base_date="2025-03-21", due_date=jalali_to_iso(1405, 11, 1),
        ftype="loan", doc_ref="", project_id=1, status="pending", created_by="acc")
    db.add(f2)
    db.flush()

    # ---- پرداخت‌های اعضا
    def add_payment(no, member_code, amount_toman, jm, jd, status, tracking, funding=None, note=""):
        p = models.Payment(no=no, pay_date=jalali_to_iso(1405, jm, jd),
                           member_id=member_ids[member_code], amount=amount_toman * TOMAN,
                           method="transfer", bank_id=bank_mellat.id,
                           tracking_no=tracking, funding_id=funding,
                           status=status, declared_by="member",
                           approved_by="finance" if status == "approved" else "",
                           note=note)
        db.add(p)
        db.flush()
        return p

    from .routers.payments import _post_payment_voucher
    from .services import financing

    p1 = add_payment("P-1405-0001", "M-1001", 100_000_000, 3, 15, "approved", "MLT-889201")
    _post_payment_voucher(db, p1, sys_user())
    financing.auto_allocate(db, member_id=p1.member_id, amount=p1.amount,
                            payment_id=p1.id, funding_id=f.id, user=sys_user())
    p2 = add_payment("P-1405-0002", "M-1002", 60_000_000, 4, 20, "approved", "Saman-551230")
    _post_payment_voucher(db, p2, sys_user())
    financing.auto_allocate(db, member_id=p2.member_id, amount=p2.amount,
                            payment_id=p2.id, funding_id=f.id, user=sys_user())
    p3 = add_payment("P-1405-0003", "M-1003", 25_000_000, 5, 10, "approved", "TEJ-774512")
    _post_payment_voucher(db, p3, sys_user())
    financing.auto_allocate(db, member_id=p3.member_id, amount=p3.amount,
                            payment_id=p3.id, funding_id=f.id, user=sys_user())
    add_payment("P-1405-0004", "M-1002", 15_000_000, 8, 20, "declared", "Saman-991823",
                funding=f.id, note="اعلام پرداخت توسط عضو — در انتظار بررسی")

    # همگام‌سازی شمارنده‌های شماره‌گذاری با داده اولیه
    db.add(models.Counter(entity="expense", year=1405, val=idx))
    db.add(models.Counter(entity="funding", year=1405, val=2))
    db.add(models.Counter(entity="payment", year=1405, val=4))
    # شمارنده سند خودکار توسط next_number ساخته شده و دست نمی‌زنیم

    log(db, {"username": "system"}, "seed", "system", None,
         {"message": "داده نمونه اولیه ایجاد شد"})
    db.commit()
    return True


def _m(jm: int) -> str:
    return ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
            "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"][jm - 1]


def _post_seed_expense(db: Session, e: models.Expense, user):
    """تولید سند هزینه تأییدشده با همان الگوی موتور اصلی"""
    from .services.accounting import (get_or_create_party_tafsil, get_tafsil_for_bank,
                                      get_tafsil_for_member, post_voucher)
    if e.asset_kind == "asset":
        dr_code = "1301"
    elif e.asset_kind == "deposit":
        dr_code = "1201"
    else:
        dr_code = e.category_code
    dr = {"account_code": dr_code, "debit": e.total_amount,
          "description": f"{e.no} — {e.title}", "project_id": e.project_id}
    if e.payer_type == "member":
        m = db.get(models.Member, e.payer_member_id)
        taf = get_tafsil_for_member(db, e.payer_member_id)
        lines = [dr, {"account_code": "2102", "tafsil_id": taf.id if taf else None,
                      "tafsil_name": m.full_name if m else "", "credit": e.total_amount,
                      "description": f"پرداخت {m.full_name if m else ''} از حساب شخصی"}]
    elif e.pay_status == "paid":
        acc = "1101" if e.paid_via == "cash" else "11021"
        bt = get_tafsil_for_bank(db, e.bank_id) if e.paid_via != "cash" else None
        lines = [dr, {"account_code": acc,
                      "tafsil_id": bt.id if bt else (2 if acc == "1101" else None),
                      "tafsil_name": bt.name if bt else ("صندوق شرکت" if acc == "1101" else ""),
                      "credit": e.total_amount, "description": "پرداخت از حساب شرکت"}]
    else:
        pt = get_or_create_party_tafsil(db, e.party_name or "طرف حساب")
        lines = [dr, {"account_code": "2101", "tafsil_id": pt.id, "tafsil_name": pt.name,
                      "credit": e.total_amount, "description": f"بدهی به {pt.name}"}]
    post_voucher(db, vdate=e.exp_date, description=f"ثبت هزینه {e.no} — {e.title}",
                 lines=lines, source_type="expense", source_id=e.id,
                 idem_key=f"exp:{e.id}", user=user)
    if e.payer_type == "member":
        cr = models.OffsetCredit(member_id=e.payer_member_id, expense_id=e.id,
                                 amount=e.total_amount, remaining=e.total_amount,
                                 note=f"هزینه {e.no} پرداخت‌شده توسط عضو")
        db.add(cr)
        db.flush()
        from .services import financing
        left = financing.auto_allocate(db, member_id=e.payer_member_id,
                                       amount=e.total_amount, credit_id=cr.id, user=user)
        cr.remaining = left


def ensure_seed():
    """در اولین اجرا جداول را می‌سازد و داده نمونه را وارد می‌کند"""
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        created = seed(db)
        if created:
            print("✅ داده نمونه اولیه ایجاد شد (کاربران: admin / finance / acc / ceo / audit / ali / sara / reza — رمز: 123456)")
    finally:
        db.close()
