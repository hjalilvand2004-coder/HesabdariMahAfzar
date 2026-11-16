# -*- coding: utf-8 -*-
"""نقاط پایانی پشتیبان: بانک‌ها و صندوق‌ها، پروژه‌ها و پروفایل اشخاص"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..services.accounting import log
from ..services.financing import member_statement, member_share_bp_at
from .helpers import guard_period, require

router = APIRouter(prefix="/api", tags=["meta"])


# ---------------- بانک‌ها و صندوق‌ها ----------------

@router.get("/banks")
def list_banks(user: dict = Depends(require()), db: Session = Depends(get_db)):
    tafsils = {t.ref_id: t.name for t in db.execute(select(models.Tafsil).where(
        models.Tafsil.ttype == "bank")).scalars()}
    return [{"id": b.id, "name": b.name, "bank_name": b.bank_name,
             "account_no": b.account_no, "kind": b.kind, "is_active": b.is_active,
             "tafsil_name": tafsils.get(b.id, "")}
            for b in db.execute(select(models.BankAccount).order_by(models.BankAccount.id)).scalars()]


class BankBody(BaseModel):
    name: str
    bank_name: str = ""
    account_no: str = ""
    kind: str = "bank"


@router.post("/banks")
def create_bank(body: BankBody, user: dict = Depends(require("admin", "finance")),
                db: Session = Depends(get_db)):
    guard_period(db, user)
    b = models.BankAccount(name=body.name, bank_name=body.bank_name,
                           account_no=body.account_no, kind=body.kind or "bank",
                           is_active=True)
    db.add(b)
    db.flush()
    db.add(models.Tafsil(ttype="bank", name=b.name, ref_id=b.id))
    log(db, user, "create", "bank", b.id, {"name": b.name})
    db.commit()
    return {"id": b.id, "name": b.name, "bank_name": b.bank_name,
            "account_no": b.account_no, "kind": b.kind, "is_active": b.is_active}


@router.get("/banks/tafsils")
def bank_tafsils(user: dict = Depends(require()), db: Session = Depends(get_db)):
    return [{"id": t.id, "ttype": t.ttype, "name": t.name, "ref_id": t.ref_id}
            for t in db.execute(select(models.Tafsil)).scalars()]


# ---------------- پروژه‌ها ----------------

@router.get("/projects")
def list_projects(user: dict = Depends(require()), db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name, "is_active": p.is_active}
            for p in db.execute(select(models.Project).order_by(models.Project.id)).scalars()]


class ProjectBody(BaseModel):
    name: str
    is_active: bool = True


@router.post("/projects")
def create_project(body: ProjectBody, user: dict = Depends(require("admin", "finance", "accountant")),
                   db: Session = Depends(get_db)):
    guard_period(db, user)
    if db.execute(select(models.Project).where(models.Project.name == body.name)).scalar_one_or_none():
        raise HTTPException(400, "پروژه‌ای با این نام قبلاً ثبت شده است")
    p = models.Project(name=body.name, is_active=body.is_active)
    db.add(p)
    db.flush()
    log(db, user, "create", "project", p.id, {"name": p.name})
    db.commit()
    return {"id": p.id, "name": p.name, "is_active": p.is_active}


# ---------------- پروفایل اشخاص ----------------

@router.get("/profiles")
def list_profiles(user: dict = Depends(require()), db: Session = Depends(get_db)):
    members = []
    for m in db.execute(select(models.Member).order_by(models.Member.id)).scalars():
        st = member_statement(db, m.id)
        members.append({
            "id": m.id, "code": m.code, "full_name": m.full_name, "kind": m.kind,
            "phone": m.phone, "email": m.email,
            "share_now": st["share_now"], "totals": st["totals"],
        })
    staff = []
    for u in db.execute(select(models.User).where(models.User.is_active == True)).scalars():  # noqa: E712
        acts = db.execute(select(models.AuditLog).where(
            models.AuditLog.username == u.username).order_by(models.AuditLog.id)).scalars().all()
        last_login = next((a for a in acts if a.action == "login"), None)
        staff.append({
            "id": u.id, "username": u.username, "full_name": u.full_name, "role": u.role,
            "member_id": u.member_id,
            "last_login": (last_login.ts.date().isoformat() if last_login and last_login.ts else ""),
            "action_count": len(acts),
        })
    if user["role"] == "member":
        return {"members": [m for m in members if m["id"] == user["member_id"]], "staff": []}
    return {"members": members, "staff": staff}
