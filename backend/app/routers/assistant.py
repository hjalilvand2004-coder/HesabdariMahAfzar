# -*- coding: utf-8 -*-
"""دستیار هوشمند مالیار — خلاصه وضعیت نقش‌محور و پرسش‌وپاسخ متنی"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..database import get_db
from ..services.assistant import build_overview, ask_assistant
from .helpers import require

router = APIRouter(prefix="/api", tags=["assistant"])


@router.get("/assistant")
def assistant(user: dict = Depends(require()), db=Depends(get_db)):
    """برای همه نقش‌ها باز است؛ راهنمایی و اقدامات متناسب با نقش و سطح دسترسی تولید می‌شود"""
    return build_overview(db, user)


class AskBody(BaseModel):
    question: str = ""


@router.post("/assistant/ask")
def assistant_ask(body: AskBody, user: dict = Depends(require()), db=Depends(get_db)):
    return ask_assistant(db, user, body.question)
