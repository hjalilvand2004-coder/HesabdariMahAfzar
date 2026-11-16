#!/usr/bin/env bash
# اجرای نسخه سرور سامانه مالیار روی لینوکس/مک
set -e
cd "$(dirname "$0")/backend"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[خطا] python3 نصب نیست. از فایل Maliyar-Portable.html استفاده کنید."
  exit 1
fi

if [ ! -d venv ]; then
  echo "[راه‌اندازی اولیه] ساخت محیط مجازی و نصب وابستگی‌ها..."
  python3 -m venv venv
  ./venv/bin/pip install --upgrade pip -q
  ./venv/bin/pip install -r requirements.txt -q
fi

echo "سامانه مالیار روی http://127.0.0.1:8000 — برای توقف Ctrl+C"
( sleep 2; xdg-open http://127.0.0.1:8000 >/dev/null 2>&1 || open http://127.0.0.1:8000 >/dev/null 2>&1 || true )
./venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
