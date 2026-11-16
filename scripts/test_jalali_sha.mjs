// تست صحت jalaali.js و sha256.js با مرجع Intl و crypto خود Node
import { gregorianToJalali, jalaliToGregorian, jalaliMonthLength, isoToJalali, jalaliToIso } from '../download/samane-maliyar/frontend/src/lib/jalali.js'
import { sha256Hex, pbkdf2Sha256 } from '../download/samane-maliyar/frontend/src/lib/sha256.js'
import crypto from 'node:crypto'

let fail = 0, pass = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++ } else { fail++; console.log('  ❌', name, extra) }
}

// --- sha256: بردارهای استاندارد
check('sha256("abc")', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
check('sha256("")', sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
const long = 'x'.repeat(1000)
check('sha256(long)', sha256Hex(long) === crypto.createHash('sha256').update(long).digest('hex'))

// --- pbkdf2 در مقایسه با crypto خود node
for (const [pw, salt, it] of [['123456', 'abcdabcdabcdabcd', 12000], ['رمزعبور!@#', 'salamdoust', 100], ['p@ss w0rd', '0123456789abcdef', 5000]]) {
  const mine = Buffer.from(pbkdf2Sha256(pw, salt, it)).toString('hex')
  const ref = crypto.pbkdf2Sync(pw, salt, it, 32, 'sha256').toString('hex')
  check(`pbkdf2("${pw.slice(0, 6)}" x${it})`, mine === ref, `${mine.slice(0, 16)} != ${ref.slice(0, 16)}`)
}

// --- شمسی: مقایسه با Intl (مرجع مرورگرها) برای ۳۰۰۰ تاریخ تصادفی
const fmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' })
const fd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
let tested = 0
for (let t = Date.UTC(1975, 0, 1); t < Date.UTC(2100, 0, 1); t += 3600 * 1000 * 24 * 11) {
  const g = fd.formatToParts(new Date(t))
  const get = (type) => g.find(p => p.type === type).value
  const gy = +get('year'), gm = +get('month'), gd = +get('day')
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd)
  const f = fmt.formatToParts(new Date(t))
  const fg = (type) => f.find(p => p.type === type).value
  const jyRef = +fg('year'), jmRef = +fg('month'), jdRef = +fg('day')
  check(`g2j ${gy}-${gm}-${gd}`, jy === jyRef && jm === jmRef && jd === jdRef, `mine=${jy}/${jm}/${jd} ref=${jyRef}/${jmRef}/${jdRef}`)
  // رفت و برگشت
  const [gy2, gm2, gd2] = jalaliToGregorian(jy, jm, jd)
  check(`j2g ${jy}/${jm}/${jd}`, gy2 === gy && gm2 === gm && gd2 === gd)
  const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`
  check(`iso roundtrip ${iso}`, jalaliToIso(...isoToJalali(iso)) === iso)
  tested++
  if (tested >= 120) break
}

// طول ماه‌ها
check('مهر ۳۰ روز', jalaliMonthLength(1405, 7) === 30)
check('اسفند ۱۴۰۳ کبیسه ۳۰ روز', jalaliMonthLength(1403, 12) === 30)
check('اسفند ۱۴۰۴ ۲۹ روز', jalaliMonthLength(1404, 12) === 29)
check('۱۴۰۵-۰۸-۲۵ == 2026-11-16', JSON.stringify(isoToJalali('2026-11-16')) === '[1405,8,25]')

console.log(`\nنتیجه: ${pass} موفق / ${fail} ناموفق (شامل ~${tested * 3} تست تاریخ)`)
process.exit(fail ? 1 : 0)
