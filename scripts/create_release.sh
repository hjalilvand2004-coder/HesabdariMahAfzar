#!/bin/bash
# ایجاد GitHub Release مالیار و آپلود assetهای پکیج پرتیبل
# استفاده: VERSION=v1.2.0 BODY=/tmp/maliyar-zip/release-body.json ZIP=... ./scripts/create_release.sh
# توکن فقط از متغیر محیطی GH_TOKEN خوانده می‌شود و هرگز در مخزن ذخیره نمی‌شود.
set -e
VERSION="${VERSION:?مثال: VERSION=v1.2.0}"
BODY="${BODY:?مسیر فایل JSON بدنه ریلیز}"
ZIP="${ZIP:-/home/z/my-project/download/Maliyar-Portable-${VERSION}.zip}"
HTML="${HTML:-/home/z/my-project/download/samane-maliyar/Maliyar-Portable.html}"
REPO="hjalilvand2004-coder/HesabdariMahAfzar"
TOKEN="${GH_TOKEN:?توکن را در متغیر محیطی GH_TOKEN بگذارید}"
AUTH="Authorization: token $TOKEN"
API="https://api.github.com/repos/$REPO"
UPLOAD="https://uploads.github.com/repos/$REPO/releases"

# 1) اگر ریلیز با همین تگ قبلاً ساخته شده، حذفش کن تا تمیز ساخته شود
EXISTING_ID=$(curl -s -H "$AUTH" "$API/releases/tags/$VERSION" | python3 -I -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null || true)
if [ -n "$EXISTING_ID" ]; then
  echo "deleting existing release $EXISTING_ID"
  curl -s -X DELETE -H "$AUTH" "$API/releases/$EXISTING_ID" > /dev/null
fi

# 2) ساخت ریلیز
RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" -d @"$BODY" "$API/releases")
RID=$(echo "$RESP" | python3 -I -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))")
if [ -z "$RID" ]; then
  echo "ERROR: release creation failed:"; echo "$RESP" | head -5; exit 1
fi
echo "release-id=$RID"

# 3) آپلود assetها
UP_ZIP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/zip" --data-binary @"$ZIP" "$UPLOAD/$RID/assets?name=Maliyar-Portable-${VERSION}.zip")
UP_HTML=$(curl -s -X POST -H "$AUTH" -H "Content-Type: text/html" --data-binary @"$HTML" "$UPLOAD/$RID/assets?name=Maliyar-Portable.html")
for R in "$UP_ZIP" "$UP_HTML"; do
  echo "$R" | python3 -I -c "import sys,json;d=json.load(sys.stdin);print('asset:',d.get('name'),'| size:',d.get('size'),'| state:',d.get('state'),'| err:',d.get('message','-'))"
done

# 4) اعتبارسنجی نهایی: دریافت ریلیز و assetها
curl -s -H "$AUTH" "$API/releases/tags/$VERSION" | python3 -I -c "
import sys, json
d = json.load(sys.stdin)
print('release:', d['name'])
print('tag:', d['tag_name'], '| url:', d['html_url'])
print('assets:')
for a in d['assets']:
    print('  -', a['name'], a['size'], 'bytes | state:', a['state'])
    print('    ', a['browser_download_url'])
"
