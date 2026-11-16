# -*- coding: utf-8 -*-
"""کدینگ حساب‌ها، پروژه/مرکز هزینه، بانک‌ها و تفصیلی‌ها"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import account_has_movement, get_tafsil_for_bank
from .helpers import account_dict, bank_dict, log, project_dict, require

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("")
def list_accounts(user: dict = Depends(require()), db: Session = Depends(get_db)):
    """درخت کدینگ: گروه ← کل ← معین"""
    accounts = db.execute(select(models.Account).order_by(models.Account.code)).scalars().all()
    return [account_dict(a) for a in accounts]


class AccountBody(BaseModel):
    code: str
    name: str
    level: str  # col | moin
    parent_code: str | None = None
    acc_type: str
    nature: str = "debit"
    is_active: bool = True


@router.post("")
def create_account(body: AccountBody, user: dict = Depends(require("admin", "finance")),
                   db: Session = Depends(get_db)):
    if db.execute(select(models.Account).where(models.Account.code == body.code)).scalar_one_or_none():
        raise HTTPException(400, "این کد حساب قبلاً ثبت شده است")
    if body.level not in ("col", "moin"):
        raise HTTPException(400, "سطح حساب باید کل یا معین باشد")
    if body.level == "moin" and not (body.parent_code or "").strip():
        raise HTTPException(400, "حساب معین باید زیر یک حساب کل تعریف شود")
    parent = None
    if body.parent_code:
        parent = db.execute(select(models.Account).where(
            models.Account.code == body.parent_code,
            models.Account.level == "col")).scalar_one_or_none()
        if parent is None:
            raise HTTPException(400, "حساب کل والد یافت نشد")
    a = models.Account(code=body.code, name=body.name, level=body.level,
                       parent_code=body.parent_code or None,
                       acc_type=body.acc_type, nature=body.nature,
                       is_active=body.is_active)
    db.add(a)
    log(db, user, "create", "account", a.id, {"code": a.code, "name": a.name})
    db.commit()
    return account_dict(a)


@router.patch("/{aid}")
def update_account(aid: int, body: AccountBody, user: dict = Depends(require("admin", "finance")),
                   db: Session = Depends(get_db)):
    a = db.get(models.Account, aid)
    if not a:
        raise HTTPException(404, "حساب یافت نشد")
    if a.code != body.code and account_has_movement(db, a.code):
        raise HTTPException(400, "حساب دارای گردش است؛ تغییر کد مجاز نیست")
    before = {"name": a.name, "is_active": a.is_active}
    a.code = body.code
    a.name = body.name
    a.is_active = body.is_active
    log(db, user, "update", "account", aid, {"before": before, "after": {"name": body.name,
        "is_active": body.is_active}})
    db.commit()
    return account_dict(a)


@router.delete("/{aid}")
def delete_account(aid: int, user: dict = Depends(require("admin", "finance")),
                   db: Session = Depends(get_db)):
    a = db.get(models.Account, aid)
    if not a:
        raise HTTPException(404, "حساب یافت نشد")
    if account_has_movement(db, a.code):
        raise HTTPException(400, "حساب دارای گردش است و حذف آن مجاز نیست")
    if db.execute(select(models.Account).where(models.Account.parent_code == a.code)).scalar_one_or_none():
        raise HTTPException(400, "ابتدا حساب‌های زیرمجموعه را حذف کنید")
    db.delete(a)
    log(db, user, "delete", "account", aid, {"code": a.code})
    db.commit()
    return {"ok": True}


# ---------------- پروژه‌ها ----------------

projects_router = APIRouter(prefix="/api/projects", tags=["projects"])


@projects_router.get("")
def list_projects(user: dict = Depends(require()), db: Session = Depends(get_db)):
    return [project_dict(p) for p in db.execute(select(models.Project).order_by(models.Project.id)).scalars()]


class ProjectBody(BaseModel):
    name: str
    is_active: bool = True


@projects_router.post("")
def create_project(body: ProjectBody, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    p = models.Project(name=body.name, is_active=body.is_active)
    db.add(p)
    db.flush()
    log(db, user, "create", "project", p.id, {"name": p.name})
    db.commit()
    return project_dict(p)


# ---------------- بانک‌ها و صندوق ----------------

banks_router = APIRouter(prefix="/api/banks", tags=["banks"])


@banks_router.get("")
def list_banks(user: dict = Depends(require()), db: Session = Depends(get_db)):
    out = []
    for b in db.execute(select(models.BankAccount).order_by(models.BankAccount.id)).scalars():
        t = get_tafsil_for_bank(db, b.id)
        out.append(bank_dict(b, t.name if t else ""))
    return out


class BankBody(BaseModel):
    name: str
    bank_name: str = ""
    account_no: str = ""
    kind: str = "bank"


@banks_router.post("")
def create_bank(body: BankBody, user: dict = Depends(require("admin", "finance")),
                db: Session = Depends(get_db)):
    b = models.BankAccount(name=body.name, bank_name=body.bank_name,
                           account_no=body.account_no, kind=body.kind)
    db.add(b)
    db.flush()
    db.add(models.Tafsil(ttype="bank", name=body.name, ref_id=b.id))
    log(db, user, "create", "bank", b.id, {"name": b.name})
    db.commit()
    return bank_dict(b)


@banks_router.get("/tafsils")
def list_tafsils(user: dict = Depends(require()), db: Session = Depends(get_db)):
    return [{"id": t.id, "ttype": t.ttype, "name": t.name, "ref_id": t.ref_id}
            for t in db.execute(select(models.Tafsil).order_by(models.Tafsil.id)).scalars()]
