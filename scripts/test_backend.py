# -*- coding: utf-8 -*-
"""تست سناریوی کامل بک‌اند: ورود، هزینه، تأمین مالی، پرداخت، اسناد، دفاتر، دسترسی‌ها"""
import os
import sys

os.environ["SAMANE_DB"] = "/tmp/samane-test.db"
os.environ["SAMANE_UPLOADS"] = "/tmp/samane-uploads"
if os.path.exists("/tmp/samane-test.db"):
    os.remove("/tmp/samane-test.db")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

BASE = "http://test"
PASS = []
FAIL = []


def check(name, cond, extra=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ {name} {extra}")


def api(client, token, method, path, body=None, expect=200):
    r = client.request(method, BASE + path, json=body,
                       headers={"Authorization": f"Bearer {token}"})
    if expect is not None and r.status_code != expect:
        print(f"    [{method} {path}] → {r.status_code}: {r.text[:300]}")
    return r


with TestClient(app) as c:
    print("\n== ۱) ورود و احراز هویت ==")
    r = c.post(BASE + "/api/auth/login", json={"username": "ceo", "password": "123456"})
    check("ورود مدیرعامل", r.status_code == 200)
    ceo = r.json()["token"]
    acc = c.post(BASE + "/api/auth/login", json={"username": "acc", "password": "123456"}).json()["token"]
    fin = c.post(BASE + "/api/auth/login", json={"username": "finance", "password": "123456"}).json()["token"]
    ali = c.post(BASE + "/api/auth/login", json={"username": "ali", "password": "123456"}).json()["token"]
    admin = c.post(BASE + "/api/auth/login", json={"username": "admin", "password": "123456"}).json()["token"]
    r = c.post(BASE + "/api/auth/login", json={"username": "ceo", "password": "wrong"})
    check("رد رمز نادرست", r.status_code == 401)

    print("\n== ۲) داده اولیه و داشبورد ==")
    r = api(c, ceo, "GET", "/api/dashboard")
    d = r.json()
    check("داشبورد لود شد", r.status_code == 200 and d.get("cash_total") is not None)
    print(f"    نقد و بانک: {d['cash_total']:,} | سود سال: {d['pnl_year']['profit']:,}")
    check("اعضای داشبورد ۳ سهامدار", len([m for m in d["members"] if m["commitment"] > 0]) == 3)
    total_commit = sum(m["commitment"] for m in d["members"])
    check("مجموع تعهدات = ۳۰۰ میلیون ریال", total_commit == 300_000_000, f"={total_commit:,}")
    total_paid = sum(m["paid"] for m in d["members"])
    check("مجموع وصول = ۲۲۰ میلیون ریال (پرداخت + تهاتر مهر و خدمات)", total_paid == 220_000_000, f"={total_paid:,}")

    print("\n== ۳) ثبت و تأیید هزینه جدید ==")
    body = {"exp_date": "2026-11-10", "title": "تست هزینه دوبل", "base_amount": 12345678,
            "tax_amount": 1234567, "party_name": "تأمین‌کننده تست", "category_code": "51041",
            "payer_type": "company", "pay_status": "paid", "bank_id": 1}
    r = api(c, acc, "POST", "/api/expenses", body)
    check("ثبت هزینه", r.status_code == 200, r.text[:200])
    eid = r.json()["id"]
    no = r.json()["no"]
    check("مبلغ نهایی = پایه + مالیات", r.json()["total_amount"] == 13_580_245)
    r = api(c, acc, "POST", f"/api/expenses/{eid}/submit")
    check("ارسال برای تأیید", r.status_code == 200)
    r = api(c, fin, "POST", f"/api/expenses/{eid}/approve", {"decision": "approve"}, expect=403)
    check("مدیر مالی اجازه تأیید هزینه ندارد (فقط مدیرعامل)", r.status_code == 403)
    r = api(c, ceo, "POST", f"/api/expenses/{eid}/approve", {"decision": "approve"})
    check("تأیید هزینه توسط مدیرعامل", r.status_code == 200)
    r = api(c, acc, "GET", "/api/vouchers?source_type=expense")
    v_exp = [v for v in r.json() if v["source_id"] == eid and v["source_type"] == "expense"]
    check("سند خودکار هزینه تولید شد", len(v_exp) == 1)
    if v_exp:
        v = v_exp[0]
        check("سند متوازن", v["total_debit"] == v["total_credit"] == 13_580_245)
    r = api(c, ceo, "POST", f"/api/expenses/{eid}/approve", {"decision": "approve"}, expect=400)
    check("تأیید مجدد ممنوع", r.status_code == 400)
    r = api(c, acc, "PATCH", f"/api/expenses/{eid}", body, expect=400)
    check("ویرایش هزینه تأییدشده ممنوع", r.status_code == 400)

    print("\n== ۴) کنترل فاکتور تکراری ==")
    r = api(c, acc, "GET", "/api/expenses/dupcheck?invoice_no=HOST-140502")
    check("تشخیص فاکتور تکراری", len(r.json()["duplicates"]) >= 1)

    print("\n== ۵) درخواست تأمین مالی و کنترل گرد کردن ==")
    # مبلغ با گرد کردن مشکل‌دار: 10,000,003 ریال بین سه عضو 50/30/20
    r = api(c, acc, "POST", "/api/funding/preview",
            {"amount": 10_000_003, "method": "share",
             "member_ids": [1, 2, 3], "base_date": "2025-03-21"})
    rows = r.json()["rows"]
    amounts = [x["amount"] for x in rows]
    check("مجموع تقسیم دقیقاً برابر مبلغ مصوب", sum(amounts) == 10_000_003, f"={amounts}")
    check("سهم عضو اول ۵۰٪ گردشده (بزرگ‌ترین باقیمانده)", amounts[0] == 5_000_001, f"={amounts[0]}")
    fb = {"title": "تأمین مالی تست", "amount": 25_000_007, "method": "share",
          "member_ids": [1, 2, 3], "base_date": "2025-03-21",
          "due_date": "2026-12-29", "ftype": "current", "doc_ref": "مصوبه تست"}
    r = api(c, acc, "POST", "/api/funding", fb)
    check("ثبت درخواست تأمین مالی", r.status_code == 200, r.text[:200])
    fid = r.json()["id"]
    r = api(c, acc, "POST", f"/api/funding/{fid}/submit")
    check("ارسال برای تصویب", r.status_code == 200)
    r = api(c, acc, "POST", f"/api/funding/{fid}/approve", {"decision": "approve"}, expect=403)
    check("حسابدار اجازه تصویب ندارد", r.status_code == 403)
    r = api(c, ceo, "POST", f"/api/funding/{fid}/approve", {"decision": "approve"})
    check("تصویب توسط مدیرعامل", r.status_code == 200)
    rows = r.json()["commitments"]
    check("مجموع تعهدات دقیقاً برابر مبلغ", sum(x["amount"] for x in rows) == 25_000_007)

    print("\n== ۶) اعلام پرداخت، تأیید وصول و تخصیص ==")
    r = api(c, ali, "POST", "/api/payments",
            {"pay_date": "2026-11-12", "amount": 5_000_003, "method": "transfer",
             "bank_id": 1, "tracking_no": "TEST-001", "note": "پرداخت تست"})
    check("اعلام پرداخت توسط عضو", r.status_code == 200, r.text[:200])
    pid = r.json()["id"]
    check("وضعیت اولیه: اعلام‌شده (وصول‌نشده)", r.json()["status"] == "declared")
    r = api(c, ali, "GET", "/api/members/1/statement")
    before_paid = r.json()["totals"]["commitments_paid"]
    r = api(c, acc, "POST", f"/api/payments/{pid}/approve", {"decision": "approve"}, expect=403)
    check("حسابدار اجازه تأیید وصول ندارد", r.status_code == 403)
    r = api(c, fin, "POST", f"/api/payments/{pid}/approve", {"decision": "approve"})
    check("تأیید وصول توسط مدیر مالی", r.status_code == 200, r.text[:300])
    r = api(c, ali, "GET", "/api/members/1/statement")
    st = r.json()
    check("پرداخت بدون تأیید مانده را افزایش نمی‌داد؛ حالا با تأیید افزایش یافت",
          st["totals"]["commitments_paid"] == before_paid + 5_000_003)
    r = api(c, acc, "GET", "/api/vouchers?source_type=payment")
    vp = [v for v in r.json() if v["source_id"] == pid]
    check("سند وصول تولید شد و متوازن است", len(vp) == 1 and vp[0]["total_debit"] == 5_000_003)

    print("\n== ۷) تهاتر هزینه پرداخت‌شده توسط عضو ==")
    body2 = {"exp_date": "2026-11-13", "title": "هزینه پرداخت‌شده توسط عضو",
             "base_amount": 800_000, "party_name": "خدمات نرم‌افزاری پارس",
             "category_code": "51041", "payer_type": "member", "payer_member_id": 1}
    r = api(c, acc, "POST", "/api/expenses", body2)
    eid2 = r.json()["id"]
    api(c, acc, "POST", f"/api/expenses/{eid2}/submit")
    api(c, ceo, "POST", f"/api/expenses/{eid2}/approve", {"decision": "approve"})
    r = api(c, ali, "GET", "/api/members/1/statement")
    st = r.json()
    check("اعتبار تهاتر ایجاد شد", any(c["amount"] == 800_000 for c in st["credits"]))
    check("تهاتر خودکار با تعهد اعمال شد", st["totals"]["total_settled"] >= 800_000)
    r = api(c, acc, "GET", "/api/vouchers?source_type=expense")
    vv = [v for v in r.json() if v["source_id"] == eid2]
    check("سند هزینه عضو بستانکار جاری عضو است",
          len(vv) == 1 and any(l["account_code"] == "2102" and l["credit"] == 800_000
                               for l in vv[0]["lines"]))

    print("\n== ۸) دفاتر و تراز آزمایشی ==")
    r = api(c, fin, "GET", "/api/reports/trial-balance")
    tb = r.json()
    td = sum(x["move_debit"] for x in tb)
    tc = sum(x["move_credit"] for x in tb)
    check(f"تراز آزمایشی متوازن (بدهکار {td:,} = بستانکار {tc:,})", td == tc)
    r = api(c, fin, "GET", "/api/reports/pnl")
    pnl = r.json()
    check("سود و زیان محاسبه شد", pnl["total_revenue"] > 0 and pnl["total_expense"] > 0)
    r = api(c, fin, "GET", "/api/reports/balance-sheet")
    bs = r.json()
    check(f"ترازنامه متوازن (اختلاف {bs['check']:,})", bs["check"] == 0)
    r = api(c, fin, "GET", "/api/reports/journal")
    check("دفتر روزنامه دارای ردیف", len(r.json()) > 20)
    r = api(c, fin, "GET", "/api/reports/general")
    check("دفتر کل محاسبه شد", len(r.json()) > 5)
    r = api(c, fin, "GET", "/api/reports/moin/51101")
    check("دفتر معین با مانده تجمعی", len(r.json()) > 0 and "balance" in r.json()[0])

    print("\n== ۹) کنترل‌های اسناد ==")
    bad = {"date": "2026-11-14", "description": "سند نامتوازن",
           "lines": [{"account_code": "51041", "debit": 500_000},
                     {"account_code": "1102", "credit": 400_000}]}
    r = api(c, acc, "POST", "/api/vouchers", bad, expect=400)
    check("ثبت سند نامتوازن ممنوع", r.status_code == 400 and "نامتوازن" in r.json()["detail"])
    r = api(c, fin, "GET", "/api/vouchers?source_type=expense")
    first_v = r.json()[-1]["id"]
    r = api(c, fin, "POST", f"/api/vouchers/{first_v}/reverse", {"reason": "تست ابطال"})
    check("سند ابطال معکوس", r.status_code == 200)
    rev = r.json()
    check("سند ابطال متوازن است", rev["total_debit"] == rev["total_credit"] > 0)
    r = api(c, fin, "POST", f"/api/vouchers/{first_v}/reverse", {"reason": "دوباره"}, expect=400)
    check("ابطال تکراری ممنوع", r.status_code == 400)

    print("\n== ۱۰) نقش‌ها و محدوده اطلاعات ==")
    r = api(c, ali, "GET", "/api/users", expect=403)
    check("عضو به مدیریت کاربران دسترسی ندارد", r.status_code == 403)
    r = api(c, ali, "GET", "/api/audit", expect=403)
    check("عضو به ردپای حسابرسی دسترسی ندارد", r.status_code == 403)
    r = api(c, ali, "GET", "/api/expenses")
    check("عضو فقط هزینه‌های خودش را می‌بیند",
          all(e["payer_member_id"] == 1 for e in r.json()) and len(r.json()) >= 1)
    r = api(c, ali, "GET", "/api/members/2/statement", expect=403)
    check("عضو وضعیت عضو دیگر را نمی‌بیند", r.status_code == 403)
    r = api(c, ali, "GET", "/api/payments")
    check("پرداخت‌های عضو فقط خودش", all(p["member_id"] == 1 for p in r.json()))
    r = api(c, ali, "GET", "/api/vouchers", expect=403)
    check("عضو به اسناد شرکت دسترسی ندارد", r.status_code == 403)
    r = api(c, ali, "GET", "/api/reports/trial-balance", expect=403)
    check("عضو به دفاتر شرکت دسترسی ندارد", r.status_code == 403)
    r = api(c, ali, "GET", "/api/dashboard", expect=403)
    check("عضو به داشبورد مدیریتی دسترسی ندارد", r.status_code == 403)

    print("\n== ۱۱) بستن دوره ==")
    api(c, fin, "POST", "/api/settings/period", {"closed": True, "reason": "پایان سال تست"})
    r = api(c, acc, "POST", "/api/expenses",
            {"exp_date": "2026-11-15", "title": "هزینه دوره بسته", "base_amount": 100,
             "category_code": "51091"}, expect=403)
    check("ثبت در دوره بسته برای حسابدار ممنوع", r.status_code == 403)
    api(c, admin, "POST", "/api/settings/period", {"closed": False})
    r = api(c, acc, "POST", "/api/expenses",
            {"exp_date": "2026-11-15", "title": "پس از بازگشایی", "base_amount": 100,
             "category_code": "51091", "party_name": "تست", "payer_type": "company"})
    check("پس از بازگشایی ثبت ممکن است", r.status_code == 200)

    print("\n== ۱۲) تحلیل‌ها و ردپای حسابرسی ==")
    r = api(c, ceo, "GET", "/api/analytics")
    check("تحلیل‌های قاعده‌محور تولید شد", isinstance(r.json(), list))
    r = api(c, auditor, None, None, expect=None) if False else None
    aud = c.post(BASE + "/api/auth/login", json={"username": "audit", "password": "123456"}).json()["token"]
    r = api(c, aud, "GET", "/api/audit")
    check("حسابرس ردپای حسابرسی را می‌بیند", len(r.json()) > 10)
    actions = {a["action"] for a in r.json()}
    check("اقدامات تأیید/سند ثبت شده‌اند", {"approve"} & actions and {"post_voucher"} & actions,
          f"={actions}")

    r = api(c, fin, "GET", "/api/reports/member-settlement")
    check("گزارش تسویه اعضا", len(r.json()) >= 4)

    print("\n== ۱۳) خدمات اعضا و جبران خدمات ==")
    r = api(c, fin, "GET", "/api/services")
    check("فهرست خدمات اولیه", r.status_code == 200 and len(r.json()) >= 3)
    r = api(c, fin, "POST", "/api/services",
            {"member_id": 1, "sdate": "2026-11-15", "stype": "tech",
             "title": "خدمت تست", "qty": 3, "unit": "ساعت", "unit_price": 2_000_000,
             "calc_note": "۳ × ۲۰۰ هزار تومان"})
    check("ثبت خدمت جدید", r.status_code == 200, r.text[:200])
    svc = r.json()
    check("مبلغ خدمت = تعداد × نرخ", svc["amount"] == 6_000_000)
    check("شماره خدمت SV", svc["no"].startswith("SV-"))
    r = api(c, fin, "PATCH", f"/api/services/{svc['id']}",
            {"member_id": 1, "sdate": "2026-11-15", "stype": "tech",
             "title": "خدمت تست ویرایش", "qty": 4, "unit": "ساعت", "unit_price": 2_000_000})
    check("ویرایش پیش‌نویس خدمت", r.status_code == 200 and r.json()["amount"] == 8_000_000)
    r = api(c, ceo, "POST", f"/api/services/{svc['id']}/submit", {}, expect=403)
    check("مدیرعامل اجازه ارسال ندارد", r.status_code == 403)
    r = api(c, fin, "POST", f"/api/services/{svc['id']}/submit")
    check("ارسال خدمت برای تأیید", r.status_code == 200)
    r = api(c, fin, "POST", f"/api/services/{svc['id']}/approve",
            {"comp_method": "credit"}, expect=403)
    check("مدیر مالی اجازه تأیید جبران ندارد (فقط مدیرعامل)", r.status_code == 403)
    r = api(c, ceo, "POST", f"/api/services/{svc['id']}/approve",
            {"comp_method": "credit", "comp_date": "2026-11-16"})
    check("تأیید و جبران اعتباری توسط مدیرعامل", r.status_code == 200, r.text[:300])
    check("وضعیت جبران‌شده", r.json()["status"] == "compensated")
    r = api(c, ceo, "GET", "/api/vouchers?source_type=service")
    v_svc = [v for v in r.json() if v["source_id"] == svc["id"] and v["source_type"] == "service"]
    check("سند خودکار جبران خدمات", len(v_svc) == 1 and v_svc[0]["total_debit"] == 8_000_000)
    r = api(c, ali, "GET", "/api/members/1/statement")
    stt = r.json()
    check("خدمات در وضعیت حساب عضو", any(s["id"] == svc["id"] for s in stt["services"]))
    check("اعتبار جبران خدمات ثبت شد", stt["totals"]["services_credit"] >= 8_000_000)
    check("تراز نهایی در خروجی", "net_balance" in stt["totals"])
    # رد خدمت
    r = api(c, fin, "POST", "/api/services", {"member_id": 2, "sdate": "2026-11-15",
            "stype": "other", "title": "خدمت ردشدنی", "qty": 1, "unit": "مورد", "unit_price": 100_000})
    svc2 = r.json()["id"]
    api(c, fin, "POST", f"/api/services/{svc2}/submit")
    r = api(c, ceo, "POST", f"/api/services/{svc2}/approve", {"decision": "reject", "note": "تست"})
    check("رد خدمت توسط مدیرعامل", r.status_code == 200 and r.json()["status"] == "rejected")

    print("\n== ۱۴) کیف پول اعضا و درگاه ==")
    r = api(c, fin, "GET", "/api/wallet")
    check("فهرست کیف پول‌ها", r.status_code == 200 and len(r.json()["members"]) >= 4)
    r = api(c, ali, "POST", "/api/wallet/charge",
            {"amount": 3_000_000, "wdate": "2026-11-16", "method": "manual", "bank_id": 1})
    check("اعلام شارژ دستی", r.status_code == 200, r.text[:200])
    wtx = r.json()
    r = api(c, ali, "POST", f"/api/wallet/charges/{wtx['id']}/approve", {}, expect=403)
    check("عضو اجازه تأیید شارژ ندارد", r.status_code == 403)
    r = api(c, fin, "POST", f"/api/wallet/charges/{wtx['id']}/approve", {"decision": "approve"})
    check("تأیید شارژ توسط مدیر مالی", r.status_code == 200 and r.json()["balance"] == 23_000_000, r.text[:300])
    r = api(c, ali, "POST", "/api/wallet/settle", {})
    check("تسویه تعهد از کیف پول", r.status_code == 200 and r.json()["allocated"] > 0, r.text[:300])
    r = api(c, ali, "GET", "/api/wallet")
    check("موجودی پس از تسویه کاهش یافت", 0 <= r.json()["balance"] < 3_000_000)
    # جریان درگاه: شارژ آنلاین → بازگشت از بانک → ثبت مستقیم نتیجه
    r = api(c, ali, "POST", "/api/wallet/charge",
            {"amount": 2_500_000, "wdate": "2026-11-16", "method": "gateway"})
    gw = r.json()
    check("آغاز شارژ از درگاه", gw["method"] == "gateway" and "gateway_url" in gw)
    r = api(c, ali, "POST", "/api/wallet/gateway/verify", {"tx_id": gw["id"], "result": "ok", "ref": "TEST-REF-1"})
    check("تأیید پرداخت درگاه با مرجع", r.status_code == 200 and r.json()["ok"] is True, r.text[:300])
    r = api(c, ali, "GET", f"/api/wallet/tx/{gw['id']}")
    check("جزئیات تراکنش درگاه", r.json()["gateway_ref"] == "TEST-REF-1")
    r = api(c, ali, "POST", "/api/wallet/charge",
            {"amount": 1_000_000, "wdate": "2026-11-16", "method": "gateway"})
    gw2 = r.json()
    r = api(c, ali, "POST", "/api/wallet/gateway/verify", {"tx_id": gw2["id"], "result": "cancel"})
    check("انصراف از پرداخت → رد", r.status_code == 200 and r.json()["ok"] is False)

    print("\n== ۱۵) بانک‌ها، پروژه‌ها، پروفایل‌ها و دریل‌داون ==")
    r = api(c, fin, "GET", "/api/banks")
    check("فهرست بانک‌ها", r.status_code == 200 and len(r.json()) >= 2 and r.json()[0]["tafsil_name"])
    r = api(c, fin, "GET", "/api/banks/tafsils")
    check("تفصیلی‌های بانک", r.status_code == 200 and len(r.json()) >= 2)
    r = api(c, fin, "POST", "/api/banks", {"name": "بانک تست — جاری", "bank_name": "تست", "account_no": "123"})
    check("افزودن بانک با تفصیلی خودکار", r.status_code == 200)
    r = api(c, acc, "GET", "/api/projects")
    check("پروژه‌های واقعی شرکت", r.status_code == 200 and any("درسیار۳۶۰" == p["name"] for p in r.json()))
    r = api(c, fin, "GET", "/api/profiles")
    check("پروفایل اشخاص", r.status_code == 200 and len(r.json()["members"]) >= 4 and len(r.json()["staff"]) >= 5)
    check("تراز نهایی در پروفایل", "net_balance" in r.json()["members"][0]["totals"])
    r = api(c, fin, "GET", "/api/members/1/timeline")
    check("تایم‌لاین عضو", r.status_code == 200 and len(r.json()) > 3)
    r = api(c, ceo, "GET", "/api/reports/expense-drill?level=1")
    d1 = r.json()
    check("دریل‌داون سطح دسته", r.status_code == 200 and len(d1["rows"]) > 3 and d1["total"] > 0)
    cat = d1["rows"][0]["key"]
    r = api(c, ceo, "GET", f"/api/reports/expense-drill?level=2&cat={cat}")
    check("دریل‌داون سطح پروژه", r.status_code == 200 and len(r.json()["rows"]) >= 1)
    r = api(c, ceo, "GET", f"/api/reports/expense-drill?level=1&month=1405-02")
    check("دریل‌داون با فیلتر ماه", r.status_code == 200 and r.json()["total"] > 0)
    r = api(c, ali, "GET", "/api/reports/expense-drill", expect=403)
    check("عضو به دریل‌داون دسترسی ندارد", r.status_code == 403)
    # داشبورد کامل — کلیدهای جدید
    r = api(c, ceo, "GET", "/api/dashboard")
    d = r.json()
    check("داشبورد کلید services", "services" in d and "pending_amount" in d["services"])
    check("داشبورد کلید fundings", isinstance(d.get("fundings"), list) and len(d["fundings"]) >= 1)
    check("سود دوره در داشبورد", "profit" in d["pnl_year"])
    # برندینگ عمومی
    r = c.get(BASE + "/api/settings/public")
    check("برندینگ عمومی صفحه ورود", r.status_code == 200 and "شرکت مه‌آی" in r.json()["company_name"])
    # پروفایل شرکت در تنظیمات
    r = api(c, fin, "PATCH", "/api/settings", {"company_reg_no": "REG-999", "company_activity": "تست پروفایل"})
    check("ذخیره فیلدهای پروفایل شرکت", r.status_code == 200)
    r = api(c, fin, "GET", "/api/settings")
    check("خواندن پروفایل شرکت", r.json()["company_reg_no"] == "REG-999" and "company_logo" in r.json())
    r = api(c, fin, "PATCH", "/api/settings", {"company_logo": "data:image/png;base64," + "A" * 500_000}, expect=400)
    check("سقف حجم آرم", r.status_code == 400)

    # ---------- دستیار هوشمند (نقش‌محور) ----------
    print("\n== دستیار هوشمند ==")
    r = api(c, ceo, "GET", "/api/assistant")
    ov = r.json()
    check("دستیار: خلاصه مدیرعامل", r.status_code == 200 and ov["role"] == "ceo" and ov["role_label"])
    check("دستیار: کارتابل تأیید در خلاصه مدیرعامل", any(i["id"] == "approvals" for i in ov["insights"]))
    check("دستیار: آمار و پرسش‌های پیشنهادی", len(ov["stats"]) == 4 and len(ov["chips"]) >= 3)
    check("دستیار: راهنمای نقش و سلب مسئولیت", bool(ov["role_guide"]) and bool(ov["disclaimer"]))
    r = api(c, ali, "GET", "/api/assistant")
    ova = r.json()
    check("دستیار: خلاصه عضو", r.status_code == 200 and ova["role"] == "member")
    mc = next((i for i in ova["insights"] if i["id"] == "member-commitment"), None)
    check("دستیار: وضعیت تعهد عضو", mc is not None and mc["text"].find("تعهد شما") >= 0)
    check("دستیار: عضو کارتابل تأیید ندارد", not any(i["id"] == "approvals" for i in ova["insights"]))
    check("دستیار: آمار عضو", len(ova["stats"]) == 4 and ova["stats"][0]["label"] == "تعهد من")
    r = api(c, ceo, "POST", "/api/assistant/ask", {"question": "وضعیت سود و زیان شرکت چطور است؟"})
    check("دستیار: پرسش سود و زیان", r.status_code == 200 and ("سود" in r.json()["answer"] or "زیان" in r.json()["answer"]))
    r = api(c, ali, "POST", "/api/assistant/ask", {"question": "وضعیت تعهد من چیست؟"})
    ask_res = r.json()
    check("دستیار: پرسش وضعیت تعهد عضو", r.status_code == 200 and "تعهد" in ask_res["answer"]
          and any(l["path"] == "/my-account" for l in ask_res["links"]))
    r = api(c, ceo, "POST", "/api/assistant/ask", {"question": "پرسش بی‌ربط xyz ۱۲۳"})
    check("دستیار: پاسخ جایگزین پرسش نامفهوم", r.status_code == 200 and len(r.json()["answer"]) > 50)
    r = api(c, ali, "POST", "/api/assistant/ask", {"question": ""}, expect=400)
    check("دستیار: پرسش خالی رد می‌شود", r.status_code == 400)
    r = api(c, acc, "GET", "/api/assistant")
    check("دستیار: خلاصه مسئول حسابداری", r.status_code == 200 and r.json()["role"] == "accountant")
    auditor = c.post(BASE + "/api/auth/login", json={"username": "audit", "password": "123456"}).json()["token"]
    r = api(c, auditor, "GET", "/api/assistant")
    check("دستیار: خلاصه حسابرس", r.status_code == 200 and r.json()["role"] == "auditor")
    r = c.request("GET", BASE + "/api/assistant")
    check("دستیار: بدون ورود ممنوع", r.status_code == 401)

print("\n" + "=" * 60)
print(f"نتیجه: {len(PASS)} موفق / {len(FAIL)} ناموفق")
if FAIL:
    print("موارد ناموفق:")
    for f in FAIL:
        print("  ❌", f)
    sys.exit(1)
print("🎉 همه تست‌ها موفق بود")
