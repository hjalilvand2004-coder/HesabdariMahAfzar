# -*- coding: utf-8 -*-
"""نقطه ورود FastAPI — سرویس API + ارائه فرانت‌اند ساخته‌شده"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, engine, SessionLocal
from .seed import ensure_seed
from .routers import (auth, users, settings, members, accounts, expenses, funding,
                      payments, vouchers, reports, dashboard, services, wallet, meta,
                      assistant)

app = FastAPI(
    title="سامانه مالیار — مدیریت هزینه، تأمین مالی اعضا و حسابداری",
    version="1.7.0",
    description="FastAPI + React + SQLite | هسته دوبل با تولید خودکار اسناد + دستیار هوشمند نقش‌محور",
)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(request, exc: ValueError):
    """خطاهای قواعد کسب‌وکار → 400 با پیام فارسی"""
    return JSONResponse(status_code=400, content={"detail": str(exc)})

for r in (auth, users, settings, members, accounts, expenses, funding,
          payments, vouchers, reports, dashboard, services, wallet, meta, assistant):
    app.include_router(r.router)


@app.on_event("startup")
def on_startup():
    ensure_seed()


FRONTEND_DIST = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "frontend", "dist"))


@app.get("/api/health")
def health():
    return {"ok": True, "app": "samane-maliyar"}


if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    @app.get("/{path:path}")
    def spa(path: str):
        """پشتیبانی از مسیرهای SPA"""
        candidate = os.path.join(FRONTEND_DIST, path)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
