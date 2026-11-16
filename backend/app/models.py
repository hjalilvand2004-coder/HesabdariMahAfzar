# -*- coding: utf-8 -*-
"""مدل‌های داده سامانه — مبالغ همگی به ریال و به‌صورت عدد صحیح (بدون خطای اعشاری)"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (BigInteger, Boolean, DateTime, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

import json
from sqlalchemy import TypeDecorator
from sqlalchemy.types import Text as _Text


class JSONDict(TypeDecorator):
    """ذخیره دیکشنری JSON در ستون متنی (سازگار با SQLite)"""
    impl = _Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value or {}, ensure_ascii=False)

    def process_result_value(self, value, dialect):
        return json.loads(value or "{}")


class JSONList(TypeDecorator):
    """ذخیره لیست JSON در ستون متنی"""
    impl = _Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return json.dumps(value or [], ensure_ascii=False)

    def process_result_value(self, value, dialect):
        return json.loads(value or "[]")


def now() -> datetime:
    return datetime.now()


class Setting(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    company_name: Mapped[str] = mapped_column(String(200), default="شرکت نمونه")
    company_national_id: Mapped[str] = mapped_column(String(30), default="")
    currency_display: Mapped[str] = mapped_column(String(10), default="toman")  # toman | rial
    member_sees_all_expenses: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_offset: Mapped[bool] = mapped_column(Boolean, default=True)  # تهاتر خودکار پرداخت عضو با تعهد
    fiscal_label: Mapped[str] = mapped_column(String(20), default="1405")
    fiscal_start: Mapped[str] = mapped_column(String(10), default="2026-03-21")
    fiscal_end: Mapped[str] = mapped_column(String(10), default="2027-03-20")
    period_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    secret: Mapped[str] = mapped_column(String(100), default="")
    base_share_date: Mapped[str] = mapped_column(String(10), default="")  # مبنای پیش‌فرض درصد سهام


class Counter(Base):
    """شمارنده شماره‌گذاری اسناد و عملیات بر اساس سال مالی"""
    __tablename__ = "counters"
    __table_args__ = (UniqueConstraint("entity", "year", name="uq_counter"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(Integer)
    val: Mapped[int] = mapped_column(Integer, default=0)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    pw_hash: Mapped[str] = mapped_column(String(200))
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # admin|finance|accountant|ceo|member|auditor
    member_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("members.id"), nullable=True)
    pin_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)  # احراز هویت دومرحله‌ای (اختیاری)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    full_name: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(10), default="person")  # person | legal
    national_id: Mapped[str] = mapped_column(String(30), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    bank_account: Mapped[str] = mapped_column(String(60), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    shares: Mapped[list["Share"]] = relationship(back_populates="member", cascade="all,delete-orphan")


class Share(Base):
    """تاریخچه درصد سهام — تغییر سهم گذشته‌های تأییدشده را تغییر نمی‌دهد"""
    __tablename__ = "shares"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("members.id"))
    percent_bp: Mapped[int] = mapped_column(Integer)  # در واحد ده‌هزارک (5000 = 50.00%)
    from_date: Mapped[str] = mapped_column(String(10))
    to_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    doc_ref: Mapped[str] = mapped_column(String(200), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    member: Mapped[Member] = relationship(back_populates="shares")


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class BankAccount(Base):
    __tablename__ = "bank_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    bank_name: Mapped[str] = mapped_column(String(120), default="")
    account_no: Mapped[str] = mapped_column(String(60), default="")
    kind: Mapped[str] = mapped_column(String(10), default="bank")  # bank | cash
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Tafsil(Base):
    """تفصیلی شناور: اعضا، بانک‌ها، اشخاص (طرف حساب) و سایر"""
    __tablename__ = "tafsils"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ttype: Mapped[str] = mapped_column(String(20))  # member | bank | party | other
    name: Mapped[str] = mapped_column(String(150))
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # member_id یا bank_id


class Account(Base):
    """کدینگ حساب‌ها: گروه (۱ رقم) ← کل (۴ رقم) ← معین (۵ رقم)"""
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    level: Mapped[str] = mapped_column(String(10))  # group | col | moin
    parent_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    acc_type: Mapped[str] = mapped_column(String(20))  # asset|liability|equity|income|expense
    nature: Mapped[str] = mapped_column(String(10), default="debit")  # debit | credit
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Expense(Base):
    __tablename__ = "expenses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    no: Mapped[str] = mapped_column(String(30), unique=True)
    exp_date: Mapped[str] = mapped_column(String(10))   # تاریخ وقوع
    entry_date: Mapped[str] = mapped_column(String(10))  # تاریخ ثبت
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    base_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    tax_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    total_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    party_name: Mapped[str] = mapped_column(String(150), default="")
    category_code: Mapped[str] = mapped_column(String(10), default="51091")  # کد معین/کل هزینه یا دارایی
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payer_type: Mapped[str] = mapped_column(String(10), default="company")  # company | member
    payer_member_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    paid_via: Mapped[str] = mapped_column(String(10), default="bank")  # bank | cash | none
    bank_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pay_status: Mapped[str] = mapped_column(String(10), default="unpaid")  # unpaid | partial | paid
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    appr_status: Mapped[str] = mapped_column(String(12), default="draft")  # draft|pending|approved|rejected
    invoice_no: Mapped[str] = mapped_column(String(60), default="")
    asset_kind: Mapped[str] = mapped_column(String(10), default="expense")  # expense | asset | deposit
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(60), default="")
    approved_by: Mapped[str] = mapped_column(String(60), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20))  # expense | funding | payment | voucher
    entity_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(Integer, default=0)
    mime: Mapped[str] = mapped_column(String(80), default="")
    path: Mapped[str] = mapped_column(Text, default="")  # مسیر فایل روی سرور یا dataURL (پرتیبل)
    uploaded_by: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class FundingRequest(Base):
    """درخواست تأمین مالی — مصوبه تقسیم مبلغ بین اعضا"""
    __tablename__ = "funding_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    no: Mapped[str] = mapped_column(String(30), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[int] = mapped_column(BigInteger)
    split_method: Mapped[str] = mapped_column(String(12), default="share")  # share|equal|custom|fixed
    percents: Mapped[dict] = mapped_column(JSONDict, default=dict)  # {member_id: bp} برای روش custom
    fixed_amounts: Mapped[dict] = mapped_column(JSONDict, default=dict)  # {member_id: ریال} برای روش fixed
    member_ids: Mapped[list] = mapped_column(JSONList, default=list)
    base_date: Mapped[str] = mapped_column(String(10), default="")   # تاریخ مبنای درصد سهام
    due_date: Mapped[str] = mapped_column(String(10), default="")
    ftype: Mapped[str] = mapped_column(String(12), default="current")  # current|loan|capital
    doc_ref: Mapped[str] = mapped_column(String(200), default="")
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft|pending|approved|rejected
    created_by: Mapped[str] = mapped_column(String(60), default="")
    approved_by: Mapped[str] = mapped_column(String(60), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    note: Mapped[str] = mapped_column(Text, default="")


class Commitment(Base):
    """تعهد مصوب هر عضو از یک درخواست تأمین مالی"""
    __tablename__ = "commitments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    funding_id: Mapped[int] = mapped_column(Integer, ForeignKey("funding_requests.id"))
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("members.id"))
    share_bp: Mapped[int] = mapped_column(Integer, default=0)
    amount: Mapped[int] = mapped_column(BigInteger)
    paid: Mapped[int] = mapped_column(BigInteger, default=0)  # جمع پرداخت‌ها و تهاترهای تخصیص‌یافته
    funding: Mapped[FundingRequest] = relationship()


class Payment(Base):
    """پرداخت/واریز اعضا — اعلام پرداخت با تأیید وصول متفاوت است"""
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    no: Mapped[str] = mapped_column(String(30), unique=True)
    pay_date: Mapped[str] = mapped_column(String(10))
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("members.id"))
    amount: Mapped[int] = mapped_column(BigInteger)
    method: Mapped[str] = mapped_column(String(10), default="transfer")  # cash|transfer|cheque
    bank_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # حساب مقصد
    tracking_no: Mapped[str] = mapped_column(String(60), default="")
    receipt_ref: Mapped[str] = mapped_column(String(120), default="")
    funding_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="declared")  # declared|approved|rejected
    declared_by: Mapped[str] = mapped_column(String(60), default="")
    approved_by: Mapped[str] = mapped_column(String(60), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    voucher_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Allocation(Base):
    """تخصیص پرداخت (یا تهاتر) به تعهد عضو"""
    __tablename__ = "allocations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)   # از پرداخت نقدی
    credit_id: Mapped[int | None] = mapped_column(Integer, nullable=True)    # از تهاتر هزینه پرداخت‌شده توسط عضو
    commitment_id: Mapped[int] = mapped_column(Integer, ForeignKey("commitments.id"))
    amount: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class OffsetCredit(Base):
    """اعتبار عضو بابت هزینه‌ای که از جیب شخصی برای شرکت پرداخت کرده (قابل تهاتر با تعهد)"""
    __tablename__ = "offset_credits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("members.id"))
    expense_id: Mapped[int] = mapped_column(Integer, ForeignKey("expenses.id"))
    amount: Mapped[int] = mapped_column(BigInteger)
    remaining: Mapped[int] = mapped_column(BigInteger, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Voucher(Base):
    """سند حسابداری — سند قطعی بدون ردپای حسابرسی تغییر نمی‌کند"""
    __tablename__ = "vouchers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    no: Mapped[str] = mapped_column(String(30), unique=True)
    vdate: Mapped[str] = mapped_column(String(10))
    description: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(10), default="draft")  # draft | confirmed
    source_type: Mapped[str] = mapped_column(String(20), default="manual")
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idem_key: Mapped[str] = mapped_column(String(60), unique=True)  # جلوگیری از تولید تکراری
    reversal_of: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(String(60), default="")
    confirmed_by: Mapped[str] = mapped_column(String(60), default="")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    lines: Mapped[list["VLine"]] = relationship(back_populates="voucher",
                                                cascade="all,delete-orphan",
                                                order_by="VLine.id")


class VLine(Base):
    __tablename__ = "voucher_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(Integer, ForeignKey("vouchers.id"))
    account_code: Mapped[str] = mapped_column(String(10))  # کد معین یا کل
    tafsil_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tafsil_name: Mapped[str] = mapped_column(String(150), default="")
    debit: Mapped[int] = mapped_column(BigInteger, default=0)
    credit: Mapped[int] = mapped_column(BigInteger, default=0)
    description: Mapped[str] = mapped_column(String(250), default="")
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    voucher: Mapped[Voucher] = relationship(back_populates="lines")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=now)
    username: Mapped[str] = mapped_column(String(60), default="")
    action: Mapped[str] = mapped_column(String(30))   # create|update|delete|approve|reject|confirm|reverse|login|close_period|...
    entity: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[str] = mapped_column(Text, default="")  # JSON قبل/بعد
