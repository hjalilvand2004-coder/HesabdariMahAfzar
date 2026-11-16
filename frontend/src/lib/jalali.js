// تبدیل تاریخ شمسی/میلادی — پورت دقیق jalaali-js (همسان با بک‌اند)
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]

export const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']

const div = (a, b) => {
  const q = Math.abs(a) / Math.abs(b)
  const q2 = Math.floor(q)
  return (a >= 0) === (b >= 0) ? q2 : -q2
}
const mod = (a, b) => a - b * div(a, b)

function jalCal (jy) {
  const bl = BREAKS.length
  const gy = jy + 621
  let leapJ = -14
  let jp = BREAKS[0]
  let jump = 0
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy)
  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }
  let n = jy - jp
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4
  return { leap, gy, march }
}

export function isLeapJalali (jy) { return jalCal(jy).leap === 0 }

export function jalaliMonthLength (jy, jm) {
  if (jm >= 1 && jm <= 6) return 31
  if (jm >= 7 && jm <= 11) return 30
  return isLeapJalali(jy) ? 30 : 29
}

function g2d (gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function d2g (jdn) {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

function j2d (jy, jm, jd) {
  const r = jalCal(jy)
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
}

function d2j (jdn) {
  const gy = d2g(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy)
  const jdn1f = g2d(gy, 3, r.march)
  let k = jdn - jdn1f
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
}

export function gregorianToJalali (gy, gm, gd) {
  const r = d2j(g2d(gy, gm, gd))
  return [r.jy, r.jm, r.jd]
}

export function jalaliToGregorian (jy, jm, jd) {
  const r = d2g(j2d(jy, jm, jd))
  return [r.gy, r.gm, r.gd]
}

export function isoToJalali (iso) {
  if (!iso) return null
  const [gy, gm, gd] = iso.split('-').map(Number)
  return gregorianToJalali(gy, gm, gd)
}

export function jalaliToIso (jy, jm, jd) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd)
  const p = (n) => String(n).padStart(2, '0')
  return `${gy}-${p(gm)}-${p(gd)}`
}

export function monthName (jm) { return JMONTHS[jm - 1] || '' }

export function formatJalali (iso, withMonth = false) {
  if (!iso) return '—'
  const [jy, jm, jd] = isoToJalali(iso)
  const p = (n) => String(n).padStart(2, '0')
  if (withMonth) return `${jd} ${monthName(jm)} ${jy}`
  return `${jy}/${p(jm)}/${p(jd)}`
}

export function todayIso () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayJalali () { return isoToJalali(todayIso()) }
export function currentJYear () { return todayJalali()[0] }

export function fiscalYearRange (jy) {
  return [jalaliToIso(jy, 1, 1), jalaliToIso(jy, 12, jalaliMonthLength(jy, 12))]
}

export function addDaysIso (iso, days) {
  const [gy, gm, gd] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(gy, gm - 1, gd + days))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

export function dayDiff (iso1, iso2) {
  const [a, b] = [iso1, iso2].map(s => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.round((b - a) / 86400000)
}
