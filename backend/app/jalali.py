# -*- coding: utf-8 -*-
"""تبدیل تاریخ شمسی (جلالی) و میلادی — پورت دقیق الگوریتم jalaali-js
همه مبالغ و تاریخ‌ها در پایگاه‌داده به‌صورت ISO میلادی («YYYY-MM-DD») ذخیره می‌شوند.
"""
from __future__ import annotations

from datetime import date, timedelta

_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
           1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]

_JMONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
            "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]


def _div(a: int, b: int) -> int:
    """تقسیم با قطع به سمت صفر (مطابق ~~(a/b) در جاوااسکریپت)"""
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def _mod(a: int, b: int) -> int:
    """باقیمانده با قطع (مطابق a % b در جاوااسکریپت)"""
    return a - b * _div(a, b)


def _jal_cal(jy: int) -> dict:
    """محاسبه سال کبیسه و روز آغاز نوروز"""
    bl = len(_BREAKS)
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    jump = 0
    if jy < jp or jy >= _BREAKS[bl - 1]:
        raise ValueError("سال شمسی خارج از محدوده مجاز است: %s" % jy)
    for i in range(1, bl):
        jm = _BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j += _div(jump, 33) * 8 + _div(_mod(jump, 33), 4)
        jp = jm
    n = jy - jp
    leap_j += _div(n, 33) * 8 + _div(_mod(n, 33) + 3, 4)
    if _mod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = _div(gy, 4) - _div((_div(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + _div(jump + 4, 33) * 33
    leap = _mod(_mod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return {"leap": leap, "gy": gy, "march": march}


def is_leap_jalali(jy: int) -> bool:
    return _jal_cal(jy)["leap"] == 0


def jalali_month_length(jy: int, jm: int) -> int:
    if 1 <= jm <= 6:
        return 31
    if 7 <= jm <= 11:
        return 30
    return 30 if is_leap_jalali(jy) else 29


def _g2d(gy: int, gm: int, gd: int) -> int:
    d = _div((gy + _div(gm - 8, 6) + 100100) * 1461, 4) \
        + _div(153 * _mod(gm + 9, 12) + 2, 5) + gd - 34840408
    return d - _div(_div(gy + 100100 + _div(gm - 8, 6), 100) * 3, 4) + 752


def _d2g(jdn: int) -> dict:
    j = 4 * jdn + 139361631
    j = j + _div(_div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = _div(_mod(j, 1461), 4) * 5 + 308
    gd = _div(_mod(i, 153), 5) + 1
    gm = _mod(_div(i, 153), 12) + 1
    gy = _div(j, 1461) - 100100 + _div(8 - gm, 6)
    return {"gy": gy, "gm": gm, "gd": gd}


def _j2d(jy: int, jm: int, jd: int) -> int:
    r = _jal_cal(jy)
    return _g2d(r["gy"], 3, r["march"]) + (jm - 1) * 31 - _div(jm, 7) * (jm - 7) + jd - 1


def _d2j(jdn: int) -> dict:
    gy = _d2g(jdn)["gy"]
    jy = gy - 621
    r = _jal_cal(jy)
    jdn1f = _g2d(gy, 3, r["march"])
    k = jdn - jdn1f
    if k >= 0:
        if k <= 185:
            return {"jy": jy, "jm": 1 + _div(k, 31), "jd": _mod(k, 31) + 1}
        k -= 186
    else:
        jy -= 1
        k += 179
        if r["leap"] == 1:
            k += 1
    return {"jy": jy, "jm": 7 + _div(k, 30), "jd": _mod(k, 30) + 1}


# ---------- API عمومی ----------

def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    r = _d2j(_g2d(gy, gm, gd))
    return r["jy"], r["jm"], r["jd"]


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    r = _d2g(_j2d(jy, jm, jd))
    return r["gy"], r["gm"], r["gd"]


def month_name(jm: int) -> str:
    return _JMONTHS[jm - 1] if 1 <= jm <= 12 else "?"


def iso_to_jalali(iso: str) -> tuple[int, int, int]:
    """«YYYY-MM-DD» میلادی → (jy, jm, jd)"""
    gy, gm, gd = (int(x) for x in iso.split("-"))
    return gregorian_to_jalali(gy, gm, gd)


def jalali_to_iso(jy: int, jm: int, jd: int) -> str:
    gy, gm, gd = jalali_to_gregorian(jy, jm, jd)
    return f"{gy:04d}-{gm:02d}-{gd:02d}"


def format_jalali(iso: str, with_month: bool = False) -> str:
    """«2026-11-16» → «۱۴۰۵/۰۸/۲۵» یا «۲۵ آبان ۱۴۰۵»"""
    if not iso:
        return ""
    jy, jm, jd = iso_to_jalali(iso)
    if with_month:
        return f"{jd} {month_name(jm)} {jy}"
    return f"{jy:04d}/{jm:02d}/{jd:02d}"


def today_iso() -> str:
    return date.today().isoformat()


def today_jalali() -> tuple[int, int, int]:
    return iso_to_jalali(today_iso())


def current_jyear() -> int:
    return today_jalali()[0]


def fiscal_year_range(jy: int) -> tuple[str, str]:
    """ابتدا و انتهای سال مالی شمسی به‌صورت ISO میلادی"""
    return jalali_to_iso(jy, 1, 1), jalali_to_iso(jy, 12, jalali_month_length(jy, 12))


def jalali_month_dates(jy: int, jm: int) -> tuple[str, str]:
    return (jalali_to_iso(jy, jm, 1),
            jalali_to_iso(jy, jm, jalali_month_length(jy, jm)))


def add_days_iso(iso: str, days: int) -> str:
    d = date.fromisoformat(iso) + timedelta(days=days)
    return d.isoformat()


def today_jalali_str() -> str:
    return format_jalali(today_iso(), with_month=True)
