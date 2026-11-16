# -*- coding: utf-8 -*-
"""داده اولیه — سناریوی واقعی شرکت مه‌آی (MahAI): هاست، دامنه‌ها، ثبت شرکت، مهر، SSL و...
همه عملیات از طریق سرویس‌های واقعی ثبت می‌شوند تا اسناد دقیقاً هم‌خوان باشند.
مبالغ این فایل به تومان نوشته شده و در ریال ذخیره می‌شود (× ۱۰).
"""
from __future__ import annotations

import sqlite3

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import SessionLocal, Base, engine, DB_PATH
from .security import hash_password
from .services.accounting import log, post_voucher, get_tafsil_for_bank, get_tafsil_for_member, next_number
from .services.financing import calc_split, create_commitments
from .jalali import jalali_to_iso, fiscal_year_range

# نسخه سناریوی داده اولیه — با تغییر نسخه، پایگاه‌داده دموی قدیمی بازسازی می‌شود
SEED_SCENARIO_VERSION = 2
OLD_SCENARIO_MARKER = "پارس‌داده"  # داده نمونه نسخه‌های ۱.۰ تا ۱.۲ سرور

MEMBERS = [
    {"code": "M-1001", "full_name": "علی محمدی", "kind": "person",
     "national_id": "0076543210", "phone": "۰۹۱۲۱۲۳۴۵۶۷", "email": "ali@mahai.ir",
     "bank_account": "ملت ۳۳۲۱۱۰۹۸۷۶", "share_bp": 5000},
    {"code": "M-1002", "full_name": "سارا احمدی", "kind": "person",
     "national_id": "0045678912", "phone": "۰۹۳۵۱۱۲۲۳۳۴", "email": "sara@mahai.ir",
     "bank_account": "سامان ۰۴۵۶۷۸۹۰۱۲۳", "share_bp": 3000},
    {"code": "M-1003", "full_name": "رضا کریمی", "kind": "legal",
     "national_id": "14001234567", "phone": "۰۹۱۹۷۷۷۸۸۹۹", "email": "reza@karimi-co.ir",
     "bank_account": "تجارت ۲۱۵۵۴۴۳۳۲۲", "share_bp": 2000},
    {"code": "M-1004", "full_name": "مینا رضایی", "kind": "person",
     "national_id": "0067891234", "phone": "۰۹۳۳۵۵۵۱۲۳۴", "email": "mina@mahai.ir",
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
    ("51042", "خدمات اعضا و جبران خدمات", "moin", "5104", "expense", "debit"),
    ("5105", "هزینه حمل‌ونقل", "col", "5", "expense", "debit"),
    ("5106", "تبلیغات و بازاریابی", "col", "5", "expense", "debit"),
    ("5107", "ارتباطات و انرژی", "col", "5", "expense", "debit"),
    ("51071", "اینترنت و ارتباطات", "moin", "5107", "expense", "debit"),
    ("51072", "آب، برق و گاز", "moin", "5107", "expense", "debit"),
    ("5108", "بیمه و مالیات و عوارض", "col", "5", "expense", "debit"),
    ("5109", "سایر هزینه‌های عملیاتی", "col", "5", "expense", "debit"),
    ("51091", "هزینه‌های ثبتی، مجوزها و مهر", "moin", "5109", "expense", "debit"),
    ("5110", "هزینه زیرساخت فناوری اطلاعات", "col", "5", "expense", "debit"),
    ("51101", "هاست، سرور و فضای ابری", "moin", "5110", "expense", "debit"),
    ("51102", "دامنه و گواهی SSL", "moin", "5110", "expense", "debit"),
]

TOMAN = 10  # مبالغ این فایل به تومان نوشته شده و در ریال ذخیره می‌شود
JMONTH = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
          "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]


def _m(jm: int) -> str:
    return JMONTH[jm - 1]


def migrate_schema():
    """ارتقای سبک پایگاه‌داده نسخه‌های قبلی — افزودن ستون‌های جدید بدون از دست رفتن داده"""
    if not os_path_exists():
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

        # ستون‌های جدید جدول تنظیمات (پروفایل شرکت)
        if "settings" in tables:
            cols = {r[1] for r in cur.execute("PRAGMA table_info(settings)").fetchall()}
            new_cols = {
                "company_name_en": "TEXT DEFAULT ''",
                "company_reg_no": "TEXT DEFAULT ''",
                "company_economic_code": "TEXT DEFAULT ''",
                "company_activity": "TEXT DEFAULT ''",
                "company_address": "TEXT DEFAULT ''",
                "company_phone": "TEXT DEFAULT ''",
                "company_email": "TEXT DEFAULT ''",
                "company_website": "TEXT DEFAULT ''",
                "company_logo": "TEXT DEFAULT ''",
            }
            for c, ddl in new_cols.items():
                if c not in cols:
                    cur.execute(f"ALTER TABLE settings ADD COLUMN {c} {ddl}")

        # offset_credits: expense_id باید nullable باشد (اعتبار جبران خدمات بدون هزینه است)
        if "offset_credits" in tables:
            info = cur.execute("PRAGMA table_info(offset_credits)").fetchall()
            notnull = {r[1]: r[3] for r in info}
            if notnull.get("expense_id"):
                cur.execute("ALTER TABLE offset_credits RENAME TO offset_credits_old")
                cur.execute("""
                    CREATE TABLE offset_credits (
                        id INTEGER PRIMARY KEY,
                        member_id INTEGER NOT NULL REFERENCES members(id),
                        expense_id INTEGER REFERENCES expenses(id),
                        amount BIGINT NOT NULL,
                        remaining BIGINT,
                        note TEXT DEFAULT '',
                        created_at DATETIME
                    )""")
                cur.execute("""INSERT INTO offset_credits
                    (id, member_id, expense_id, amount, remaining, note, created_at)
                    SELECT id, member_id, expense_id, amount, remaining, note, created_at
                    FROM offset_credits_old""")
                cur.execute("DROP TABLE offset_credits_old")
        conn.commit()
    finally:
        conn.close()


def os_path_exists() -> bool:
    import os
    return os.path.exists(DB_PATH)


def seed(db: Session):
    if db.execute(select(models.User)).scalars().first():
        return False

    import secrets
    # ---- تنظیمات + پروفایل شرکت (مه‌آی)
    fs, fe = fiscal_year_range(1405)
    db.add(models.Setting(
        id=1, company_name="شرکت مه‌آی (MahAI)", company_name_en="MahAI",
        company_national_id="1400شخصی — در تنظیمات اصلاح شود",
        company_reg_no="", company_economic_code="",
        company_activity="توسعه پلتفرم‌های آموزشی و نرم‌افزاری (درسیار۳۶۰، برنامه‌یار۳۶۰، دانش‌جویار۳۶۰، MahAI)",
        company_address="", company_phone="", company_email="info@mahai.ir",
        company_website="MahAI.ir", company_logo="",
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
                                from_date="2025-03-21", doc_ref="صورتجلسه مؤسسین"))

    db.add(mk_user("ali", "علی محمدی (عضو)", "member", member_ids["M-1001"]))
    db.add(mk_user("sara", "سارا احمدی (عضو)", "member", member_ids["M-1002"]))
    db.add(mk_user("reza", "رضا کریمی (عضو)", "member", member_ids["M-1003"]))

    # ---- بانک، صندوق و پروژه‌های واقعی شرکت
    db.add(models.BankAccount(name="بانک ملت — جاری شرکت", bank_name="ملت",
                              account_no="3321109876", kind="bank"))
    db.add(models.BankAccount(name="صندوق شرکت", bank_name="", account_no="", kind="cash"))
    db.flush()
    db.add(models.Tafsil(ttype="bank", name="بانک ملت — جاری شرکت", ref_id=1))
    db.add(models.Tafsil(ttype="bank", name="صندوق شرکت", ref_id=2))
    for name in ["درسیار۳۶۰", "برنامه‌یار۳۶۰", "دانش‌جویار۳۶۰", "MahAI",
                 "زیرساخت و امور عمومی شرکت"]:
        db.add(models.Project(name=name))
    db.flush()

    # ---- کدینگ حساب‌ها (شامل کدهای زیرساخت فناوری و هزینه‌های ثبتی)
    for code, name, level, parent, t, nat in ACCOUNTS:
        db.add(models.Account(code=code, name=name, level=level,
                              parent_code=parent, acc_type=t, nature=nat))
    db.flush()

    bank_mellat = db.execute(select(models.BankAccount).where(
        models.BankAccount.kind == "bank")).scalar_one()

    # ---- هزینه‌های واقعی شرکت مه‌آی (همه به تومان × ۱۰ = ریال)
    def add_expense(**kw):
        cnt = kw.pop("_idx", 0)
        defaults = dict(appr_status="draft", payer_type="company", paid_via="bank",
                        bank_id=bank_mellat.id, asset_kind="expense", pay_status="unpaid",
                        created_by="acc", base_amount=0, tax_amount=0, total_amount=0,
                        entry_date=kw["exp_date"], party_name="", invoice_no="",
                        project_id=5, approved_by="")
        defaults.update(kw)
        e = models.Expense(no=f"H-1405-{cnt:04d}", **defaults)
        db.add(e)
        db.flush()
        return e

    idx = 0
    # ۱) اجاره هاست ماهانه — ۲٬۸۰۰٬۰۰۰ تومان در ماه (اردیبهشت تا آبان ۱۴۰۵)
    for jm in range(2, 9):
        idx += 1
        add_expense(exp_date=jalali_to_iso(1405, jm, 3),
                    title=f"اجاره هاست ماهانه — {_m(jm)} ۱۴۰۵",
                    description="هاست میزبانی پلتفرم‌ها (درسیار۳۶۰، برنامه‌یار۳۶۰، دانش‌جویار۳۶۰، MahAI) — قرارداد ماهانه",
                    base_amount=2_800_000 * TOMAN, total_amount=2_800_000 * TOMAN,
                    party_name="شرکت میزبان‌داده (ارائه‌دهنده هاست)", category_code="51101",
                    project_id=5, pay_status="paid", appr_status="approved",
                    approved_by="ceo", invoice_no=f"HOST-1405{jm:02d}", _idx=idx)
    # ۲ تا ۵) خرید چهار دامنه شرکت — ثبت سالانه، ۱۰۰ هزار تومان هر کدام
    domains = [
        ("darsyar360.ir", 2, 5, 1, "پلتفرم درسیار۳۶۰"),
        ("barnamehyar360.ir", 2, 12, 2, "پلتفرم برنامه‌یار۳۶۰"),
        ("daneshjoyar360.ir", 3, 3, 3, "پلتفرم دانش‌جویار۳۶۰"),
        ("MahAI.ir", 3, 20, 4, "برند MahAI"),
    ]
    for i, (dom, jm, jd, proj, desc) in enumerate(domains, 1):
        idx += 1
        add_expense(exp_date=jalali_to_iso(1405, jm, jd), title=f"خرید دامنه {dom}",
                    description=f"ثبت سالانه دامنه — {desc}",
                    base_amount=1_000_000, total_amount=1_000_000,
                    party_name="سامانه نیک (NIC.IR) — ثبت دامنه", category_code="51102",
                    project_id=proj, pay_status="paid", appr_status="approved",
                    approved_by="ceo", invoice_no=f"DOM-{i}-1405", _idx=idx)
    # ۶) هزینه ثبت شرکت — ۵ م تومان (تعرفه ثبت + کد اقتصادی)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 2, 20), title="هزینه ثبت شرکت",
                description="تعرفه ثبت شرکت در سامانه ثبت شرکت‌ها + تشکیل پرونده و کد اقتصادی",
                base_amount=50_000_000, total_amount=50_000_000,
                party_name="سامانه ثبت شرکت‌ها (مجله رسمی) و خدمات ثبتی", category_code="51091",
                project_id=5, pay_status="paid", appr_status="approved",
                approved_by="ceo", invoice_no="REG-1405", _idx=idx)
    # ۷) خرید مهر شرکت — پرداخت از حساب شخصی رضا کریمی (تهاتر خودکار با تعهدش)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 2, 24), title="خرید مهر شرکت",
                description="مهر رسمی شرکت — پرداخت مستقیم از حساب شخصی عضو توسط رضا کریمی",
                base_amount=5_000_000, total_amount=5_000_000,
                party_name="مهرسازی سازندگی", category_code="51091",
                project_id=5, payer_type="member", payer_member_id=member_ids["M-1003"],
                pay_status="paid", appr_status="approved", approved_by="ceo",
                invoice_no="MOHR-1405", _idx=idx)
    # ۸) خرید گواهی SSL — ۱٫۲ م تومان
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 4, 10), title="خرید گواهی SSL",
                description="گواهی امنیتی SSL/TLS برای دامنه‌های اصلی پلتفرم‌ها",
                base_amount=12_000_000, total_amount=12_000_000,
                party_name="ارائه‌دهنده گواهی SSL", category_code="51102",
                project_id=1, pay_status="paid", appr_status="approved",
                approved_by="ceo", invoice_no="SSL-1405", _idx=idx)
    # و...) سایر هزینه‌های راه‌اندازی — طراحی لوگو و هویت بصری
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 5, 15),
                title="طراحی لوگو و هویت بصری برند MahAI",
                description="طراحی لوگو، بنر و کیت هویت بصری پلتفرم‌ها",
                base_amount=20_000_000, total_amount=20_000_000,
                party_name="استودیو طراحی گرافیک", category_code="5106",
                project_id=4, pay_status="paid", appr_status="approved",
                approved_by="ceo", invoice_no="LOGO-1405", _idx=idx)
    # یک هزینه در انتظار تأیید و یک پیش‌نویس برای نمایش گردش کار
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 8, 20),
                title="خرید پنل پیامک و سرویس OTP پلتفرم‌ها",
                description="پنل ارسال پیامک تأییدیه و بازیابی رمز — فاکتور دریافت‌شده، در انتظار تأیید",
                base_amount=4_000_000, total_amount=4_000_000,
                party_name="سامانه پیامک انبوه", category_code="51071",
                project_id=5, appr_status="pending", invoice_no="SMS-1405", _idx=idx)
    idx += 1
    add_expense(exp_date=jalali_to_iso(1405, 8, 23),
                title="استعلام خرید سرور اختصاصی برای MahAI",
                description="پیش‌نویس — پس از استعلام قیمت، برای مصوبه تأمین مالی ارسال می‌شود",
                base_amount=120_000_000, total_amount=120_000_000,
                party_name="مرکز داده ابری", category_code="1301", asset_kind="asset",
                project_id=4, appr_status="draft", _idx=idx)

    # اسناد همه هزینه‌های تأییدشده از طریق موتور واقعی تولید می‌شود
    def sys_user():
        return {"username": "system"}

    for e in db.execute(select(models.Expense).where(models.Expense.appr_status == "approved")).scalars():
        _post_seed_expense(db, e, sys_user())

    # ---- درآمدها — فروش اشتراک پلتفرم‌ها
    bt = get_tafsil_for_bank(db, bank_mellat.id)
    inc = [(3, 21, 150_000_000, "4101", "درآمد اشتراک درسیار۳۶۰ — فصل بهار ۱۴۰۵"),
           (5, 18, 90_000_000, "4101", "درآمد اشتراک برنامه‌یار۳۶۰ و دانش‌جویار۳۶۰ — مرداد ۱۴۰۵"),
           (7, 27, 210_000_000, "4101", "درآمد اشتراک پلتفرم‌ها و MahAI — مهر ۱۴۰۵"),
           (8, 15, 60_000_000, "4102", "درآمد پشتیبانی و آموزش کاربران — آبان ۱۴۰۵")]
    for i, (jm, jd, amount_rial, code, desc) in enumerate(inc, 1):
        post_voucher(db, vdate=jalali_to_iso(1405, jm, jd), description=desc,
                     lines=[{"account_code": "11021", "tafsil_id": bt.id, "tafsil_name": bt.name,
                             "debit": amount_rial, "description": "واریز درآمد فروش"},
                            {"account_code": code, "credit": amount_rial, "description": desc}],
                     source_type="seed", idem_key=f"seed:inc:{i}", user=sys_user())

    # ---- مصوبه تأمین مالی — پوشش هزینه‌های راه‌اندازی و زیرساخت پلتفرم‌ها
    f = models.FundingRequest(
        no="F-1405-0001", title="تأمین مالی راه‌اندازی شرکت و زیرساخت پلتفرم‌ها",
        description="مصوبه مؤسسین — پوشش هزینه‌های ثبت شرکت، زیرساخت (هاست، دامنه، SSL) و راه‌اندازی پلتفرم‌های درسیار۳۶۰، برنامه‌یار۳۶۰، دانش‌جویار۳۶۰ و MahAI",
        amount=300_000_000, split_method="share",
        member_ids=[member_ids["M-1001"], member_ids["M-1002"], member_ids["M-1003"]],
        base_date="2025-03-21", due_date=jalali_to_iso(1405, 10, 1),
        ftype="current", doc_ref="صورتجلسه مؤسسین ۱۴۰۵/۰۲/۱۵",
        project_id=5, status="approved", created_by="acc", approved_by="ceo",
        note="")
    db.add(f)
    db.flush()
    rows = calc_split(db, amount=f.amount, method="share",
                      member_ids=f.member_ids, base_date=f.base_date)
    create_commitments(db, f, rows)

    f2 = models.FundingRequest(
        no="F-1405-0002", title="خرید سرور اختصاصی MahAI",
        description="درخواست در انتظار تصویب مدیرعامل — تقسیم مساوی بین سهامداران",
        amount=120_000_000, split_method="equal",
        member_ids=[member_ids["M-1001"], member_ids["M-1002"], member_ids["M-1003"]],
        base_date="2025-03-21", due_date=jalali_to_iso(1405, 11, 1),
        ftype="current", doc_ref="", project_id=4, status="pending", created_by="acc")
    db.add(f2)
    db.flush()

    # ---- پرداخت‌های اعضا
    from .routers.payments import _post_payment_voucher
    from .services import financing

    def add_payment(no, member_code, amount_rial, jm, jd, status, tracking, funding=None, note=""):
        p = models.Payment(no=no, pay_date=jalali_to_iso(1405, jm, jd),
                           member_id=member_ids[member_code], amount=amount_rial,
                           method="transfer", bank_id=bank_mellat.id,
                           tracking_no=tracking, funding_id=funding,
                           status=status, declared_by="member",
                           approved_by="finance" if status == "approved" else "",
                           note=note)
        db.add(p)
        db.flush()
        return p

    # سهم مصوب: علی ۱۵ م تومان، سارا ۹ م تومان، رضا ۶ م تومان (مجموع ۳۰ م تومان)
    p1 = add_payment("P-1405-0001", "M-1001", 100_000_000, 3, 15, "approved", "MLT-889201")
    _post_payment_voucher(db, p1, sys_user())
    financing.auto_allocate(db, member_id=p1.member_id, amount=p1.amount,
                            payment_id=p1.id, funding_id=f.id, user=sys_user())
    p2 = add_payment("P-1405-0002", "M-1002", 60_000_000, 4, 20, "approved", "Saman-551230")
    _post_payment_voucher(db, p2, sys_user())
    financing.auto_allocate(db, member_id=p2.member_id, amount=p2.amount,
                            payment_id=p2.id, funding_id=f.id, user=sys_user())
    p3 = add_payment("P-1405-0003", "M-1003", 20_000_000, 5, 10, "approved", "TEJ-774512")
    _post_payment_voucher(db, p3, sys_user())
    financing.auto_allocate(db, member_id=p3.member_id, amount=p3.amount,
                            payment_id=p3.id, funding_id=f.id, user=sys_user())
    add_payment("P-1405-0004", "M-1002", 15_000_000, 8, 20, "declared", "Saman-991823",
                funding=f.id, note="اعلام پرداخت توسط عضو — در انتظار بررسی")

    # ---- خدمات اعضا و جبران خدمات
    def add_service(no, member_code, kw):
        s = models.Service(
            no=no, member_id=member_ids[member_code], sdate=kw["sdate"],
            stype=kw.get("stype", "other"), title=kw["title"],
            description=kw.get("description", ""),
            qty=kw["qty"], unit=kw.get("unit", "ساعت"), unit_price=kw["unit_price"],
            amount=kw["qty"] * kw["unit_price"], calc_note=kw.get("calc_note", ""),
            status=kw.get("status", "draft"), comp_method=kw.get("comp_method"),
            comp_date=kw.get("comp_date", ""), comp_note=kw.get("comp_note", ""),
            created_by=kw.get("created_by", "finance"),
            approved_by=kw.get("approved_by", ""))
        db.add(s)
        db.flush()
        return s

    sv1 = add_service("SV-1405-0001", "M-1003", {
        "sdate": jalali_to_iso(1405, 5, 12), "stype": "legal",
        "title": "تنظیم قراردادهای ثبتی و تأمین‌کنندگان پلتفرم‌ها",
        "description": "قرارداد میزبانی، SLA درگاه پرداخت و قراردادهای قالب پلتفرم‌های آموزشی",
        "qty": 8, "unit": "ساعت", "unit_price": 15_000_000,
        "calc_note": "۸ ساعت × نرخ توافقی ۱.۵ میلیون تومان بر ساعت (صورتجلسه هیئت‌مدیره ۱۴۰۵/۰۴)",
        "status": "compensated", "comp_method": "credit",
        "comp_date": jalali_to_iso(1405, 5, 20),
        "comp_note": "جبران از محل اعتبار حساب عضو — تهاتر با تعهد تأمین مالی",
        "approved_by": "ceo",
    })
    add_service("SV-1405-0002", "M-1002", {
        "sdate": jalali_to_iso(1405, 7, 28), "stype": "accounting",
        "title": "بستن حساب‌ها و تنظیم گزارش مالی فصل تابستان",
        "description": "طبقه‌بندی اسناد راه‌اندازی، مغایرت‌گیری بانکی و پیش‌نویس گزارش فصلی",
        "qty": 6, "unit": "ساعت", "unit_price": 12_000_000,
        "calc_note": "۶ ساعت × نرخ مصوب ۱.۲ میلیون تومان بر ساعت",
        "status": "pending", "created_by": "finance",
    })
    add_service("SV-1405-0003", "M-1001", {
        "sdate": jalali_to_iso(1405, 8, 10), "stype": "tech",
        "title": "مشاوره فنی زیرساخت و معماری امنیتی سرورها",
        "description": "طراحی توپولوژی شبکه پلتفرم‌ها، سیاست دسترسی و پشتیبان‌گیری",
        "qty": 5, "unit": "ساعت", "unit_price": 15_000_000,
        "calc_note": "۵ ساعت × نرخ پیشنهادی ۱.۵ میلیون تومان بر ساعت",
        "status": "draft", "created_by": "finance",
    })
    # سند و اعتبار خدمت تأییدشده با موتور واقعی
    m1 = db.get(models.Member, sv1.member_id)
    taf1 = get_tafsil_for_member(db, sv1.member_id)
    v1 = post_voucher(db, vdate=sv1.comp_date,
                      description=f"جبران خدمات {sv1.no} — {m1.full_name} ({sv1.title})",
                      lines=[{"account_code": "51042", "debit": sv1.amount,
                              "description": f"هزینه جبران خدمات عضو — {sv1.title}", "project_id": 5},
                             {"account_code": "2102", "tafsil_id": taf1.id if taf1 else None,
                              "tafsil_name": m1.full_name, "credit": sv1.amount,
                              "description": "اعتبار جبران خدمات به جاری عضو منظور شد"}],
                      source_type="service", source_id=sv1.id, idem_key=f"service:{sv1.id}",
                      user=sys_user())
    sv1.voucher_id = v1.id
    cr1 = models.OffsetCredit(member_id=sv1.member_id, expense_id=None,
                              amount=sv1.amount, remaining=sv1.amount,
                              note=f"جبران خدمات {sv1.no} — {sv1.title}")
    db.add(cr1)
    db.flush()
    sv1.credit_id = cr1.id
    cr1.remaining = financing.auto_allocate(db, member_id=sv1.member_id,
                                            amount=sv1.amount, credit_id=cr1.id, user=sys_user())

    # ---- کیف پول اعضا
    w1 = models.WalletTx(
        no="WLT-1405-0001", wdate=jalali_to_iso(1405, 8, 5),
        member_id=member_ids["M-1001"], type="charge", amount=20_000_000,
        method="gateway", gateway="melli", bank_id=None, tracking_no="",
        gateway_ref="SADAD-8492157", note="شارژ کیف پول از درگاه بانک ملی",
        purpose=None, commitment_id=None, status="approved",
        approved_by="gateway", created_by="ali")
    db.add(w1)
    db.flush()
    # سند و اعتبار شارژ موفق درگاه
    ma = db.get(models.Member, w1.member_id)
    tafa = get_tafsil_for_member(db, w1.member_id)
    va = post_voucher(db, vdate=w1.wdate,
                      description=f"شارژ کیف پول {w1.no} — {ma.full_name} (درگاه بانک ملی، مرجع {w1.gateway_ref})",
                      lines=[{"account_code": "11021", "tafsil_id": bt.id, "tafsil_name": bt.name,
                              "debit": w1.amount, "description": "واریز درگاه بانک ملی به حساب شرکت"},
                             {"account_code": "2102", "tafsil_id": tafa.id if tafa else None,
                              "tafsil_name": ma.full_name, "credit": w1.amount,
                              "description": "شارژ کیف پول عضو — مطالبه عضو از شرکت"}],
                      source_type="wallet", source_id=w1.id, idem_key=f"wallet:{w1.id}",
                      user=sys_user())
    w1.voucher_id = va.id
    db.add(models.OffsetCredit(member_id=w1.member_id, expense_id=None,
                               amount=w1.amount, remaining=w1.amount,
                               note=f"شارژ کیف پول {w1.no}"))
    db.flush()
    db.add(models.WalletTx(
        no="WLT-1405-0002", wdate=jalali_to_iso(1405, 8, 22),
        member_id=member_ids["M-1002"], type="charge", amount=15_000_000,
        method="manual", gateway=None, bank_id=bank_mellat.id, tracking_no="Saman-995512",
        gateway_ref="", note="اعلام شارژ کیف پول — واریز به بانک ملت",
        purpose=None, commitment_id=None, status="pending", created_by="sara"))

    # ---- همگام‌سازی شمارنده‌های شماره‌گذاری با داده اولیه
    db.add(models.Counter(entity="expense", year=1405, val=idx))
    db.add(models.Counter(entity="funding", year=1405, val=2))
    db.add(models.Counter(entity="payment", year=1405, val=4))
    db.add(models.Counter(entity="service", year=1405, val=3))
    db.add(models.Counter(entity="wallet", year=1405, val=2))
    # شمارنده سند خودکار توسط next_number ساخته شده و دست نمی‌زنیم

    log(db, {"username": "system"}, "seed", "system", None,
        {"message": "داده نمونه اولیه ایجاد شد (سناریوی شرکت مه‌آی — نسخه ۲)"})
    db.commit()
    return True


def _reset_demo_if_old():
    """اگر پایگاه‌داده با سناریوی قدیمی (پارس‌داده) مقداردهی شده باشد، بازسازی می‌شود
    تا سامانه با داده واقعی شرکت مه‌آی بالا بیاید. داده‌های کارکرد واقعی کاربران دست نمی‌خورد."""
    if not os_path_exists():
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "settings" not in tables:
            return
        row = cur.execute("SELECT company_name FROM settings WHERE id = 1").fetchone()
        if row and OLD_SCENARIO_MARKER in (row[0] or ""):
            for t in ("voucher_lines", "vouchers", "allocations", "offset_credits",
                      "payments", "commitments", "funding_requests", "attachments",
                      "expenses", "vlines", "audit_log", "accounts", "tafsils",
                      "bank_accounts", "projects", "shares", "members", "users",
                      "counters", "settings", "services", "wallet_tx"):
                if t in tables:
                    cur.execute(f"DELETE FROM {t}")
            conn.commit()
            print("♻️ داده نمونه قدیمی (پارس‌داده) با سناریوی شرکت مه‌آی بازسازی می‌شود…")
    finally:
        conn.close()


def ensure_seed():
    """در اولین اجرا جداول را می‌سازد، اسکیمای قدیمی را ارتقا می‌دهد و داده نمونه وارد می‌کند"""
    migrate_schema()
    _reset_demo_if_old()
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        created = seed(db)
        if created:
            print("✅ داده نمونه اولیه ایجاد شد (کاربران: admin / finance / acc / ceo / audit / ali / sara / reza — رمز: 123456)")
    finally:
        db.close()


def _post_seed_expense(db: Session, e: models.Expense, user):
    """تولید سند هزینه تأییدشده با همان الگوی موتور اصلی"""
    from .services.accounting import get_or_create_party_tafsil
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
