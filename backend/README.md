# بک‌اند سامانه مالیار (FastAPI)

## اجرا
```bash
python -m venv venv
venv\Scripts\activate        # ویندوز  |  source venv/bin/activate  لینوکس
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
- فرانت‌اند ساخته‌شده (`../frontend/dist`) خودکار روی `/` ارائه می‌شود؛ اگر dist نباشد فقط API فعال است.
- مستندات تعاملی: `/docs`
- پایگاه‌داده: فایل `samane.db` در همین پوشه (در اولین اجرا با داده نمونه ساخته می‌شود).
- پیوست‌ها در پوشه `uploads/` نگهداری می‌شوند.

## متغیرهای محیطی
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `SAMANE_DB` | `backend/samane.db` | مسیر فایل پایگاه‌داده |
| `SAMANE_UPLOADS` | `backend/uploads` | پوشه ذخیره پیوست‌ها |

## خلاصه API (همه زیر `/api`)
- `POST /auth/login` — ورود (با PIN دومرحله‌ای اختیاری)، `GET /auth/me`
- `GET|POST|PATCH|DELETE /users` — فقط مدیر سامانه
- `GET|PATCH /settings`، `POST /settings/period` (بستن/بازگشایی دوره)، `GET /settings/backup`
- `GET|POST|PATCH /members`، `/members/{id}/statement`، `/members/{id}/shares`
- `GET|POST|PATCH|DELETE /accounts`، `/projects`، `/banks`، `/banks/tafsils`
- `GET|POST|PATCH|DELETE /expenses`، `POST /expenses/{id}/submit|approve|settle|attachments`، `GET /expenses/dupcheck`
- `GET|POST|PATCH /funding`، `POST /funding/preview|{id}/submit|{id}/approve`
- `GET|POST /payments`، `POST /payments/{id}/approve`، `POST /payments/allocate|auto-allocate`
- `GET|POST /vouchers`، `POST /vouchers/{id}/confirm|reverse`
- `GET /reports/journal|general|moin/{code}|tafsil/{id}|trial-balance|pnl|balance-sheet|member-settlement`
- `GET /dashboard`، `GET /analytics`، `GET /audit`

قواعد کلیدی: سند نامتوازن ثبت قطعی نمی‌شود؛ سند قطعی فقط با سند ابطال معکوس اصلاح می‌شود؛ هر عملیات مالی مبدأ (هزینه/وصول/تسویه) با کلید یکتا فقط یک سند تولید می‌کند؛ در دوره بسته فقط مدیر سامانه می‌تواند ثبت کند.
