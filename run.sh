#!/usr/bin/env bash
# اجرای نسخه سرور سامانه مالیار روی لینوکس/مک
# آدرس پیش‌فرض: http://0.0.0.0:8099 — با متغیرهای MALIYAR_HOST و MALIYAR_PORT قابل تغییر
set -e
cd "$(dirname "$0")/backend"

MALIYAR_HOST="${MALIYAR_HOST:-0.0.0.0}"
MALIYAR_PORT="${MALIYAR_PORT:-8099}"

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

echo "سامانه مالیار روی http://${MALIYAR_HOST}:${MALIYAR_PORT} — برای توقف Ctrl+C"
if [ "$MALIYAR_HOST" = "127.0.0.1" ] || [ "$MALIYAR_HOST" = "localhost" ]; then
  ( sleep 2; xdg-open "http://127.0.0.1:${MALIYAR_PORT}" >/dev/null 2>&1 || open "http://127.0.0.1:${MALIYAR_PORT}" >/dev/null 2>&1 || true )
fi
./venv/bin/python -m uvicorn app.main:app --host "$MALIYAR_HOST" --port "$MALIYAR_PORT"
