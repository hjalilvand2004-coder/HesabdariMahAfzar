# فرانت‌اند سامانه مالیار (React + Vite)

## توسعه
```bash
npm install
npm run dev          # http://localhost:5173 — به بک‌اند روی 8000 وصل می‌شود
```

## ساخت برای نسخه سرور
```bash
npm run build        # خروجی در dist/ — بک‌اند این پوشه را روی / ارائه می‌کند
```

## ساخت نسخه پرتیبل (تک‌فایل HTML)
```bash
npm run build -- --mode portable
node scripts/make_portable.mjs     # اگر در ریشه مخزن هستید؛ خروجی: download/Maliyar-Portable.html
```
در حالت portable پرچم `__PORTABLE__` فعال می‌شود و لایه `src/api/index.js` به‌جای `fetch` از **موتور درون‌مرورگری** (`src/api/local/`) استفاده می‌کند که همان منطق بک‌اند (تقسیم با کنترل گرد کردن، سند دوبل، دفاتر، تهاتر، نقش‌ها) را روی localStorage اجرا می‌کند.

## ساختار
- `src/api/index.js` — لایه یکپارچه API (سرور/پرتیبل)
- `src/api/local/` — فروشگاه، موتور مالی، Seed نمونه و روتر درون‌مرورگری
- `src/lib/jalali.js` — تبدیل شمسی (الگوریتم jalaali-js، تست‌شده مقابل Intl)
- `src/lib/sha256.js` — PBKDF2/SHA-256 خالص JS برای هش رمز در پرتیبل
- `src/ui/` — چیدمان RTL، کامپوننت‌ها و نمودارهای SVG بدون کتابخانه خارجی
- `src/pages/` — ۱۴ صفحه سامانه
- فونت وزیرمتن (Regular/Bold) در `src/assets/fonts` و داخل بیلد جاسازی می‌شود.

## یادداشت
- داده پرتیبل در localStorage مرورگر است؛ پشتیبان‌گیری/بازیابی JSON از صفحه تنظیمات.
- مبلغ‌ها همیشه عدد صحیح ریال؛ نمایش تومان/ریال با تنظیمات سامانه.
