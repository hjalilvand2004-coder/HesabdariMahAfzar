@echo off
chcp 65001 >nul
title سامانه مالیار — نسخه سرور
cd /d "%~dp0backend"

if not defined MALIYAR_HOST set MALIYAR_HOST=0.0.0.0
if not defined MALIYAR_PORT set MALIYAR_PORT=8099

where python >nul 2>nul
if errorlevel 1 (
  echo [خطا] پایتون روی این سیستم نصب نیست.
  echo از فایل Maliyar-Portable.html استفاده کنید که بدون پایتون اجرا می‌شود.
  pause
  exit /b 1
)

if not exist venv (
  echo [راه‌اندازی اولیه] ساخت محیط مجازی و نصب وابستگی‌ها...
  python -m venv venv
  call venv\Scripts\activate.bat
  python -m pip install --upgrade pip -q
  python -m pip install -r requirements.txt -q
) else (
  call venv\Scripts\activate.bat
)

echo.
echo ============================================
echo   سامانه مالیار روی http://%MALIYAR_HOST%:%MALIYAR_PORT%
echo   برای توقف، همین پنجره را ببندید (Ctrl+C)
echo ============================================
echo.
start "" http://127.0.0.1:%MALIYAR_PORT%
python -m uvicorn app.main:app --host %MALIYAR_HOST% --port %MALIYAR_PORT%
pause
