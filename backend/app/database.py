# -*- coding: utf-8 -*-
"""پایگاه‌داده SQLAlchemy + SQLite (فایل کنار پکیج app)"""
from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("SAMANE_DB", os.path.join(BASE_DIR, "samane.db"))
UPLOAD_DIR = os.environ.get("SAMANE_UPLOADS", os.path.join(BASE_DIR, "uploads"))

os.makedirs(UPLOAD_DIR, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
