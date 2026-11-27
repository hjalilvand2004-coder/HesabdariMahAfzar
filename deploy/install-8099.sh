#!/usr/bin/env bash
# نصب و اجرای سامانه مالیار به‌صورت سرویس systemd روی آدرس http://188.212.96.235:8099/
# اجرا روی خودِ سرور:  sudo bash deploy/install-8099.sh
# متغیرهای اختیاری: MALIYAR_HOST (پیش‌فرض 0.0.0.0) و MALIYAR_PORT (پیش‌فرض 8099)
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MALIYAR_HOST="${MALIYAR_HOST:-0.0.0.0}"
MALIYAR_PORT="${MALIYAR_PORT:-8099}"
SVC_USER="${SUDO_USER:-root}"

echo "==> پوشه پروژه: $REPO_DIR"
echo "==> کاربر سرویس: $SVC_USER | آدرس: ${MALIYAR_HOST}:${MALIYAR_PORT}"

# ۱) پایتون و پشتیبانی venv
if ! command -v python3 >/dev/null 2>&1; then
  echo "==> نصب python3..."
  (command -v apt-get >/dev/null && apt-get update -q && apt-get install -y -q python3 python3-venv python3-pip) \
    || (command -v dnf >/dev/null && dnf install -y -q python3) \
    || (command -v yum >/dev/null && yum install -y -q python3) \
    || { echo "[خطا] python3 نصب نشد — دستی نصب کنید."; exit 1; }
fi
if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "==> نصب python3-venv..."
  command -v apt-get >/dev/null && apt-get install -y -q python3-venv || true
  command -v dnf >/dev/null && dnf install -y -q python3 || true
fi

# ۲) محیط مجازی و وابستگی‌ها
if [ ! -d "$REPO_DIR/backend/venv" ]; then
  echo "==> ساخت محیط مجازی و نصب وابستگی‌ها..."
  python3 -m venv "$REPO_DIR/backend/venv"
  "$REPO_DIR/backend/venv/bin/pip" install --upgrade pip -q
  "$REPO_DIR/backend/venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" -q
fi

# ۳) سرویس systemd
echo "==> ثبت سرویس systemd با نام maliyar..."
sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__SVC_USER__|$SVC_USER|g" \
    -e "s|__MALIYAR_HOST__|$MALIYAR_HOST|g" \
    -e "s|__MALIYAR_PORT__|$MALIYAR_PORT|g" \
    "$REPO_DIR/deploy/maliyar.service" > /etc/systemd/system/maliyar.service
systemctl daemon-reload
systemctl enable maliyar >/dev/null
systemctl restart maliyar

# ۴) باز کردن پورت در فایروال (در حد امکان)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "active"; then
  ufw allow "$MALIYAR_PORT/tcp" >/dev/null 2>&1 && echo "==> پورت $MALIYAR_PORT در ufw باز شد"
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$MALIYAR_PORT/tcp" >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 \
    && echo "==> پورت $MALIYAR_PORT در firewalld باز شد"
else
  echo "==> توجه: اگر فایروال فعال است، پورت $MALIYAR_PORT/tcp را دستی باز کنید."
fi

# ۵) تست سلامت
echo "==> تست سلامت سرویس..."
sleep 2
for _ in 1 2 3 4 5; do
  if curl -sf "http://127.0.0.1:${MALIYAR_PORT}/api/health" >/dev/null 2>&1; then
    echo ""
    echo "✅ سامانه مالیار فعال است: http://188.212.96.235:${MALIYAR_PORT}/"
    echo "   وضعیت سرویس: systemctl status maliyar | لاگ: journalctl -u maliyar -f"
    exit 0
  fi
  sleep 2
done
echo "⚠️ سرویس پاسخ نداد — لاگ را ببینید: journalctl -u maliyar -n 50 --no-pager"
exit 1
