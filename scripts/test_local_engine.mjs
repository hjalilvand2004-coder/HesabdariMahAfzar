// تست موتور درون‌مرورگری — همان سناریوی تست بک‌اند
// localStorage با شیم جایگزین می‌شود
globalThis.localStorage = (() => {
  let store = {}
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary')
globalThis.__PORTABLE__ = true

const BASE = new URL('../frontend/src', import.meta.url).pathname
const { localCall, resetDB } = await import(`${BASE}/api/local/index.js`)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++ }
  else { fail++; console.log('  ❌', name, extra) }
}
const call = (method, path, body = null, queryArg = null) => {
  const [p, q] = path.split('?')
  const qs = q ? Object.fromEntries(new URLSearchParams(q)) : null
  return localCall(method, p, body, queryArg || qs)
}
const loginAs = (username) => localCall('POST', '/api/auth/login', { username, password: '123456' })
const expectErr = (fn, status) => {
  try { fn(); return false } catch (e) { return e.status === status }
}

resetDB()

// ۱) ورود
const r1 = loginAs('ceo')
check('ورود مدیرعامل', !!r1.user && r1.user.role === 'ceo')
check('رد رمز نادرست', expectErr(() => localCall('POST', '/api/auth/login', { username: 'ceo', password: 'x' }), 401))
loginAs('acc'); loginAs('finance'); loginAs('ali'); loginAs('audit')

// ۲) داشبورد از داده اولیه
loginAs('ceo')
const d = call('GET', '/api/dashboard')
check('داشبورد لود شد', d.cash_total !== undefined && d.members.length >= 4)
check('مجموع تعهدات = ۳۰۰ م ریال (مصوبه راه‌اندازی مه‌آی)', d.members.reduce((s, m) => s + m.commitment, 0) === 300_000_000)
check('مجموع وصول = ۲۲۰ م ریال (پرداخت‌ها + تهاتر مهر و خدمات رضا)', d.members.reduce((s, m) => s + m.paid, 0) === 220_000_000)
const tb0 = call('GET', '/api/reports/trial-balance')
check('تراز آزمایشی داده اولیه متوازن',
  tb0.reduce((s, x) => s + x.move_debit, 0) === tb0.reduce((s, x) => s + x.move_credit, 0))

// ۳) هزینه جدید
loginAs('acc')
const exp = call('POST', '/api/expenses', {
  exp_date: '2026-11-10', title: 'تست هزینه دوبل', base_amount: 12345678,
  tax_amount: 1234567, party_name: 'تأمین‌کننده تست', category_code: '51041',
  payer_type: 'company', pay_status: 'paid', bank_id: 1,
})
check('ثبت هزینه', exp.total_amount === 13_580_245)
call('POST', `/api/expenses/${exp.id}/submit`)
loginAs('finance')
check('مدیر مالی اجازه تأیید هزینه ندارد', expectErr(() => call('POST', `/api/expenses/${exp.id}/approve`, { decision: 'approve' }), 403))
loginAs('ceo')
check('تأیید توسط مدیرعامل', call('POST', `/api/expenses/${exp.id}/approve`, { decision: 'approve' }).status === 'approved')
const vs = call('GET', '/api/vouchers?source_type=expense')
const vexp = vs.find(v => v.source_id === exp.id && v.source_type === 'expense')
check('سند خودکار متوازن', vexp && vexp.total_debit === vexp.total_credit && vexp.total_debit === 13_580_245)
check('تأیید مجدد ممنوع', expectErr(() => call('POST', `/api/expenses/${exp.id}/approve`, { decision: 'approve' }), 400))
loginAs('acc')
check('ویرایش تأییدشده ممنوع', expectErr(() => call('PATCH', `/api/expenses/${exp.id}`, { exp_date: '2026-11-10', title: 'x', base_amount: 1, category_code: '51041', payer_type: 'company' }), 400))

// ۴) تکراری
check('تشخیص فاکتور تکراری', call('GET', '/api/expenses/dupcheck', null, { invoice_no: 'REG-1405' }).duplicates.length >= 1)

// ۵) تأمین مالی + گرد کردن
loginAs('acc')
const pv = call('POST', '/api/funding/preview', { amount: 10_000_003, method: 'share', member_ids: [1, 2, 3], base_date: '2025-03-21' })
check('مجموع تقسیم دقیقاً برابر مصوب', pv.rows.reduce((s, r) => s + r.amount, 0) === 10_000_003)
check('سهم عضو اول گردشده درست', pv.rows[0].amount === 5_000_001)
const f = call('POST', '/api/funding', { title: 'تأمین مالی تست', amount: 25_000_007, method: 'share', member_ids: [1, 2, 3], base_date: '2025-03-21', due_date: '2026-12-29', ftype: 'current', doc_ref: 'مصوبه تست' })
call('POST', `/api/funding/${f.id}/submit`)
check('حسابدار اجازه تصویب ندارد', expectErr(() => call('POST', `/api/funding/${f.id}/approve`, { decision: 'approve' }), 403))
loginAs('ceo')
const fa = call('POST', `/api/funding/${f.id}/approve`, { decision: 'approve' })
check('تصویب و تعهدات دقیق', fa.commitments.reduce((s, c) => s + c.amount, 0) === 25_000_007)

// ۶) پرداخت
loginAs('ali')
const p = call('POST', '/api/payments', { pay_date: '2026-11-12', amount: 5_000_003, method: 'transfer', bank_id: 1, tracking_no: 'TEST-001' })
check('اعلام پرداخت توسط ali', p.status === 'declared' && p.member_id === 1)
const before = call('GET', '/api/members/1/statement').totals.commitments_paid
loginAs('acc')
check('حسابدار اجازه تأیید وصول ندارد', expectErr(() => call('POST', `/api/payments/${p.id}/approve`, { decision: 'approve' }), 403))
loginAs('finance')
call('POST', `/api/payments/${p.id}/approve`, { decision: 'approve' })
loginAs('ali')
const st = call('GET', '/api/members/1/statement')
check('مانده تعهد پس از تأیید وصول به‌روز شد', st.totals.commitments_paid === before + 5_000_003)
check('عضو به لیست اسناد شرکت دسترسی ندارد', expectErr(() => call('GET', '/api/vouchers'), 403))
loginAs('finance')
const vps = call('GET', '/api/vouchers?source_type=payment')
check('سند وصول متوازن', vps.some(v => v.source_id === p.id && v.total_debit === 5_000_003))

// ۷) تهاتر
loginAs('acc')
const exp2 = call('POST', '/api/expenses', { exp_date: '2026-11-13', title: 'هزینه پرداخت‌شده توسط عضو', base_amount: 800_000, party_name: 'خدمات نرم‌افزاری پارس', category_code: '51041', payer_type: 'member', payer_member_id: 1 })
call('POST', `/api/expenses/${exp2.id}/submit`)
loginAs('ceo')
call('POST', `/api/expenses/${exp2.id}/approve`, { decision: 'approve' })
loginAs('ali')
const st2 = call('GET', '/api/members/1/statement')
check('اعتبار تهاتر ایجاد شد', st2.credits.some(c => c.amount === 800_000))
check('تهاتر خودکار اعمال شد', st2.totals.total_settled >= 800_000)

// ۸) دفاتر
loginAs('finance')
const tb = call('GET', '/api/reports/trial-balance')
const td = tb.reduce((s, x) => s + x.move_debit, 0)
const tc = tb.reduce((s, x) => s + x.move_credit, 0)
check(`تراز آزمایشی متوازن (${td.toLocaleString('en')})`, td === tc)
const bs = call('GET', '/api/reports/balance-sheet')
check('ترازنامه متوازن', bs.check === 0)
check('دفتر روزنامه پر است', call('GET', '/api/reports/journal').length > 20)
check('دفتر کل', call('GET', '/api/reports/general').length > 5)
check('دفتر معین با مانده', call('GET', '/api/reports/moin/51101')[0]?.balance !== undefined)

// ۹) کنترل اسناد
loginAs('acc')
check('سند نامتوازن ممنوع', expectErr(() => call('POST', '/api/vouchers', {
  date: '2026-11-14', description: 'نامتوازن',
  lines: [{ account_code: '51041', debit: 500_000 }, { account_code: '1102', credit: 400_000 }],
}), 400))
loginAs('finance')
const vsAll = call('GET', '/api/vouchers?source_type=expense')
const firstV = vsAll[vsAll.length - 1]
const rv = call('POST', `/api/vouchers/${firstV.id}/reverse`, { reason: 'تست ابطال' })
check('سند ابطال معکوس و متوازن', rv.total_debit === rv.total_credit && rv.total_debit > 0)
check('ابطال تکراری ممنوع', expectErr(() => call('POST', `/api/vouchers/${firstV.id}/reverse`, { reason: 'دوباره' }), 400))

// ۱۰) نقش‌ها
loginAs('ali')
check('عضو به کاربران دسترسی ندارد', expectErr(() => call('GET', '/api/users'), 403))
check('عضو به حسابرسی دسترسی ندارد', expectErr(() => call('GET', '/api/audit'), 403))
const aliExp = call('GET', '/api/expenses')
check('عضو فقط هزینه‌های خودش', aliExp.every(e => e.payer_member_id === 1) && aliExp.length >= 1)
check('عضو وضعیت عضو دیگر را نمی‌بیند', expectErr(() => call('GET', '/api/members/2/statement'), 403))
check('پرداخت‌های عضو فقط خودش', call('GET', '/api/payments').every(x => x.member_id === 1))

// ۱۱) بستن دوره
loginAs('finance')
call('POST', '/api/settings/period', { closed: true, reason: 'تست' })
loginAs('acc')
check('ثبت در دوره بسته ممنوع', expectErr(() => call('POST', '/api/expenses', { exp_date: '2026-11-15', title: 'x', base_amount: 100, category_code: '51091', payer_type: 'company' }), 403))
loginAs('admin')
call('POST', '/api/settings/period', { closed: false })
loginAs('acc')
const after = call('POST', '/api/expenses', { exp_date: '2026-11-15', title: 'پس از بازگشایی', base_amount: 100, category_code: '51091', payer_type: 'company', party_name: 'تست' })
check('پس از بازگشایی ثبت ممکن است', !!after.id)

// ۱۲) تحلیل و حسابرسی
loginAs('ceo')
check('تحلیل‌ها تولید شد', Array.isArray(call('GET', '/api/analytics')))
loginAs('audit')
check('حسابرس ردپا می‌بیند', call('GET', '/api/audit').length > 10)
loginAs('finance')
check('گزارش تسویه اعضا', call('GET', '/api/reports/member-settlement').length >= 4)

// ۱۳) پشتیبان‌گیری
check('پشتیبان JSON کامل', call('GET', '/api/settings/backup').expenses.length > 5)
resetDB()
loginAs('ceo')
const d2 = call('GET', '/api/dashboard')
check('بازنشانی داده نمونه', d2.members.reduce((s, m) => s + m.commitment, 0) === 300_000_000)

// ==================== تست‌های نسخه ۱.۱: دریل‌داون، خدمات، پروفایل، دسترسی ====================
resetDB()
loginAs('admin')

// دریل‌داون هزینه‌ها — سه سطح
const dr1 = call('GET', '/api/reports/expense-drill', null, { level: 1 })
check('دریل سطح ۱: دسته‌ها', dr1.rows?.length > 0 && dr1.total > 0, JSON.stringify(dr1).slice(0, 80))
const dr2 = call('GET', '/api/reports/expense-drill', null, { level: 2, cat: dr1.rows[0].key })
check('دریل سطح ۲: پروژه‌های دسته', dr2.rows?.length > 0, JSON.stringify(dr2).slice(0, 80))
const dr3 = call('GET', '/api/reports/expense-drill', null, { level: 3, cat: dr1.rows[0].key, project: dr2.rows[0].key })
check('دریل سطح ۳: اسناد', dr3.rows?.length > 0 && dr3.rows[0].voucher_no, JSON.stringify(dr3).slice(0, 100))
const drM = call('GET', '/api/reports/expense-drill', null, { level: 1, month: '1405-07' })
check('دریل با فیلتر ماه', drM.rows?.length > 0)

// خدمات اعضا
const svcList = call('GET', '/api/services')
check('خدمات seed = ۳ ردیف', svcList.length === 3, `got ${svcList.length}`)
const svcNew = call('POST', '/api/services', { member_id: 1, sdate: '2026-11-01', stype: 'tech', title: 'تست خدمت', qty: 2, unit: 'ساعت', unit_price: 10_000_000, calc_note: 'تست' })
check('ثبت خدمت جدید', !!svcNew.id && svcNew.amount === 20_000_000 && svcNew.status === 'draft', JSON.stringify(svcNew).slice(0, 80))
call('PATCH', `/api/services/${svcNew.id}`, { member_id: 1, sdate: '2026-11-01', stype: 'tech', title: 'تست خدمت ویرایش', qty: 3, unit: 'ساعت', unit_price: 10_000_000, calc_note: 'تست' })
const svcSub = call('POST', `/api/services/${svcNew.id}/submit`)
check('ارسال خدمت برای تأیید', svcSub.status === 'pending')
loginAs('finance')
check('مدیر مالی حق تأیید خدمت ندارد', (() => { try { call('POST', `/api/services/${svcNew.id}/approve`, { comp_method: 'credit' }); return false } catch (e) { return e.status === 403 } })())
loginAs('ceo')
const svcApp = call('POST', `/api/services/${svcNew.id}/approve`, { comp_method: 'credit', comp_date: '2026-11-02' })
check('تأیید و جبران اعتباری خدمت', svcApp.status === 'compensated' && svcApp.comp_method === 'credit')
const dbAfter = JSON.parse(localStorage.getItem('maliyar_db_v1'))
check('سند خدمات صادر شد', dbAfter.vouchers.some(v => v.source_type === 'service' && v.lines.some(l => l.account_code === '51042')))
check('اعتبار خدمات در credits ثبت شد', dbAfter.credits.some(c => c.expense_id === null && c.note?.includes('تست خدمت')))
const stAli = call('GET', '/api/members/1/statement')
check('وضعیت عضو شامل خدمات', stAli.services.length > 0 && stAli.totals.services_total > 0)
check('تراز نهایی محاسبه شد', typeof stAli.totals.net_balance === 'number')
const tl = call('GET', '/api/members/1/timeline')
check('تایم‌لاین عضو', Array.isArray(tl) && tl.length > 0 && tl.every(x => x.kind && x.title))
// جبران نقدی
loginAs('finance')
const svcCash = call('POST', '/api/services', { member_id: 2, sdate: '2026-11-03', stype: 'management', title: 'خدمت نقدی', qty: 1, unit: 'مورد', unit_price: 5_000_000 })
call('POST', `/api/services/${svcCash.id}/submit`)
loginAs('ceo')
const cashApp = call('POST', `/api/services/${svcCash.id}/approve`, { comp_method: 'cash', bank_id: 1 })
check('جبران نقدی خدمت', cashApp.status === 'compensated' && cashApp.comp_method === 'cash')
check('سند جبران نقدی از بانک', JSON.parse(localStorage.getItem('maliyar_db_v1')).vouchers.some(v => v.source_type === 'service' && v.lines.some(l => l.account_code === '11021' && l.credit > 0)))
check('پرداخت نقدی بدون حساب بانک ممنوع', (() => {
  loginAs('finance')
  const s3 = call('POST', '/api/services', { member_id: 2, sdate: '2026-11-04', stype: 'other', title: 'بدون بانک', qty: 1, unit: 'مورد', unit_price: 1_000_000 })
  call('POST', `/api/services/${s3.id}/submit`)
  loginAs('ceo')
  try { call('POST', `/api/services/${s3.id}/approve`, { comp_method: 'cash' }); return false } catch (e) { return e.status === 400 }
})())

// پروفایل‌ها
loginAs('admin')
const profs = call('GET', '/api/profiles')
check('پروفایل‌ها: اعضا و کارکنان', profs.members?.length === 4 && profs.staff?.length >= 5, `m=${profs.members?.length} s=${profs.staff?.length}`)
const profAli = profs.members.find(m => m.id === 1)
check('خلاصه پروفایل عضو', profAli.share_now === 5000 && profAli.totals.services_total > 0)

// داشبورد جدید
const dash = call('GET', '/api/dashboard')
check('داشبورد: مصوبات + خدمات', Array.isArray(dash.fundings) && dash.fundings.length === 1 && dash.services.pending_count >= 1)

// ماتریس دسترسی — ذخیره در تنظیمات
const backupNow = call('GET', '/api/settings/backup')
const permsNow = JSON.parse(JSON.stringify(backupNow.settings.role_perms || {}))
permsNow.accountant = ['dashboard']
call('PATCH', '/api/settings', { role_perms: permsNow })
loginAs('acc')
check('تنظیمات شامل ماتریس', call('GET', '/api/settings').role_perms?.accountant?.includes('dashboard') === true)
loginAs('admin')

// ==================== تست‌های نسخه ۱.۲: داده واقعی مه‌آی + کیف پول + درگاه بانک ملی ====================
resetDB()
loginAs('admin')

// داده واقعی: هزینه‌های شرکت مه‌آی
const expList = call('GET', '/api/expenses')
check('هاست ماهانه ۲.۸ م تومان × ۷ ماه', expList.filter(e => e.title.includes('اجاره هاست')).length === 7 && expList.find(e => e.title.includes('اجاره هاست')).total_amount === 28_000_000)
check('چهار دامنه ثبت‌شده', ['darsyar360.ir', 'barnamehyar360.ir', 'daneshjoyar360.ir', 'MahAI.ir'].every(d => expList.some(e => e.title.includes(d))))
check('هزینه ثبت شرکت + مهر + SSL', ['ثبت شرکت', 'خرید مهر شرکت', 'خرید گواهی SSL'].every(t => expList.some(e => e.title.includes(t))))
check('حساب‌های جدید کدینگ: 5110/51101/51102/51091', ['5110', '51101', '51102', '51091'].every(c => JSON.parse(localStorage.getItem('maliyar_db_v1')).accounts.some(a => a.code === c)))
check('پروژه‌های واقعی پلتفرم‌ها', JSON.parse(localStorage.getItem('maliyar_db_v1')).projects.map(p => p.name).join(',') === 'درسیار۳۶۰,برنامه‌یار۳۶۰,دانش‌جویار۳۶۰,MahAI,زیرساخت و امور عمومی شرکت')
check('مصوبه ۳۰۰ م ریال راه‌اندازی', call('GET', '/api/funding/1').amount === 300_000_000)
const dash2 = call('GET', '/api/dashboard')
check('نام شرکت مه‌آی در تنظیمات', JSON.parse(localStorage.getItem('maliyar_db_v1')).settings.company_name.includes('MahAI'))

// کیف پول — داده اولیه: علی شارژ درگاهی ۲۰ م ریال تأییدشده
loginAs('ali')
const w0 = call('GET', '/api/wallet')
check('کیف پول علی seed = ۲۰ م ریال', w0.balance === 20_000_000, `got ${w0.balance}`)
check('تراکنش‌های کیف پول علی', w0.txs.length === 1 && w0.txs[0].no === 'WLT-1405-0001' && w0.txs[0].gateway_ref === 'SADAD-8492157')

// شارژ دستی → تأیید مالی
const c1 = call('POST', '/api/wallet/charge', { amount: 10_000_000, wdate: '2026-11-10', method: 'manual', bank_id: 1 })
check('اعلام شارژ دستی', c1.status === 'pending' && c1.amount === 10_000_000)
loginAs('finance')
const ap1 = call('POST', `/api/wallet/charges/${c1.id}/approve`, {})
check('تأیید شارژ + سند + اعتبار', ap1.status === 'approved' && ap1.balance === 30_000_000 && !!ap1.voucher_id)
const dbW = JSON.parse(localStorage.getItem('maliyar_db_v1'))
check('سند شارژ: بانک بدهکار / جاری عضو بستانکار', dbW.vouchers.some(v => v.source_type === 'wallet' && v.lines.some(l => l.account_code === '11021' && l.debit > 0) && v.lines.some(l => l.account_code === '2102' && l.credit > 0)))
check('ردیف اعتبار شارژ کیف پول', dbW.credits.some(c => c.note?.startsWith('شارژ کیف پول') && c.member_id === 1))

// تسویه صریح از کیف پول — قبل از پرداخت درگاهی، تا تعهد باز بماند
loginAs('ali')
const balBefore = call('GET', '/api/wallet').balance
const stAli0 = call('GET', '/api/members/1/statement')
const openC0 = stAli0.commitments.find(c => c.remaining > 0)
check('علی تعهد باز دارد', !!openC0, `remaining=${openC0?.remaining}`)
const stl = call('POST', '/api/wallet/settle', {})
check('تسویه صریح از کیف پول', stl.allocated === Math.min(balBefore, openC0.remaining) && stl.balance === balBefore - stl.allocated, JSON.stringify(stl).slice(0, 90))

// شارژ درگاهی → verify موفق با تخصیص مستقیم به تعهد (کارتابل)
const stAli2 = call('GET', '/api/members/1/statement')
const openC = stAli2.commitments.find(c => c.remaining > 0)
check('مانده تعهد پس از تسویه کیف پول', !!openC && openC.remaining === openC0.remaining - Math.min(balBefore, openC0.remaining), `remaining=${openC?.remaining}`)
const gw1 = call('POST', '/api/wallet/charge', { amount: openC.remaining, wdate: '2026-11-15', method: 'gateway', commitment_id: openC.id })
check('آغاز پرداخت درگاهی + url بانک', gw1.status === 'pending' && gw1.gateway_url.includes('#/gateway?tx=') && gw1.gateway === 'melli')
check('verify بدون مرجع ممنوع', (() => { try { call('POST', '/api/wallet/gateway/verify', { tx_id: gw1.id, result: 'ok' }); return false } catch (e) { return e.status === 400 } })())
const v1 = call('POST', '/api/wallet/gateway/verify', { tx_id: gw1.id, result: 'ok', ref: 'SADAD-7777777' })
check('نتیجه سرویس: موفق + تخصیص مستقیم به تعهد', v1.ok === true && v1.ref === 'SADAD-7777777' && v1.allocated === openC.remaining, JSON.stringify(v1).slice(0, 100))
const stAli3 = call('GET', '/api/members/1/statement')
check('تعهد پس از پرداخت درگاهی تسویه شد', stAli3.commitments.find(c => c.id === openC.id).remaining === 0)
check('موجودی پس از پرداخت درگاهی (شارژ و بلافاصله تخصیص)', call('GET', '/api/wallet').balance === 0, `got ${call('GET', '/api/wallet').balance}`)
check('تراکنش تسویه در تاریخچه', call('GET', '/api/wallet').txs.some(t => t.type === 'settle' && t.gateway_ref === 'SADAD-7777777'))
check('verify تکراری ممنوع', expectErr(() => call('POST', '/api/wallet/gateway/verify', { tx_id: gw1.id, result: 'ok', ref: 'X' }), 400))
// انصراف از پرداخت
const gw2 = call('POST', '/api/wallet/charge', { amount: 5_000_000, wdate: '2026-11-15', method: 'gateway' })
const v2 = call('POST', '/api/wallet/gateway/verify', { tx_id: gw2.id, result: 'cancel' })
check('انصراف پرداخت → ناموفق', v2.ok === false && call('GET', '/api/wallet').txs.find(t => t.id === gw2.id).status === 'rejected')
check('شمارنده wallet', call('GET', '/api/wallet').txs.every(t => t.no.startsWith('WLT-1405-')))

// دسترسی: عضو کیف پول دیگر را نمی‌بیند؛ بدون ورود ممنوع
loginAs('sara')
check('کیف پول عضو دیگر ممنوع (tx)', expectErr(() => call('GET', '/api/wallet/tx/1'), 403))
check('کیف پول سارا فقط مال خودش', call('GET', '/api/wallet').txs.every(t => t.member_id === 2))
loginAs('ali')
check('تأیید شارژ توسط عضو ممنوع', expectErr(() => call('POST', `/api/wallet/charges/${c1.id}/approve`, {}), 403))
// وضعیت عضو شامل کیف پول
const stF = call('GET', '/api/members/1/statement')
check('statement شامل wallet_balance', typeof stF.totals.wallet_balance === 'number' && stF.wallet.length > 0)
check('تایم‌لاین شامل رویداد کیف پول', call('GET', '/api/members/1/timeline').some(x => x.kind === 'wallet'))

console.log(`\nنتیجه موتور پرتیبل: ${pass} موفق / ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
