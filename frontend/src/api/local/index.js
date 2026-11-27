// روتر درون‌مرورگری — همان قرارداد API بک‌اند، اجرا روی localStorage
import { loadDB, saveDB, emptyDB, nextId, log, getSession, setSession, HttpError } from './store.js'
import * as E from './engine.js'
import { seedDemo } from './seed.js'
import { buildOverview, askAssistant } from './assistant.js'
import { hashPassword, verifyPassword, randomHex } from '../../lib/sha256.js'
import { todayIso, currentJYear, isoToJalali } from '../../lib/jalali.js'
import { DEFAULT_ROLE_PERMS } from '../../lib/format.js'

let _db = null

// ---------- ارتای پایگاه‌داده نسخه‌های قدیمی ----------
// پایگاه‌داده نسخه‌های ۱.۰ و ۱.۱ جدول‌های services، wallet و... را ندارد؛
// بدون ارتا، هر فراخوانی با خطا متوقف می‌شود. داده نمونه قدیمی «پارس‌داده»
// نیز مطابق سیاست نسخه سرور با سناریوی مه‌آی بازسازی می‌شود.
const REQUIRED_TABLES = ['users', 'members', 'shares', 'projects', 'banks', 'tafsils',
  'accounts', 'expenses', 'attachments', 'funding', 'commitments', 'payments',
  'allocations', 'credits', 'services', 'wallet', 'vouchers', 'audit']

const SETTINGS_DEFAULTS = {
  company_name_en: '', company_reg_no: '', company_economic_code: '',
  company_activity: '', company_address: '', company_phone: '',
  company_email: '', company_website: '', company_logo: '',
  member_sees_all_expenses: false, auto_offset: true,
  period_closed: false, base_share_date: '2025-03-21',
}

function migrateDB (db) {
  const reseed = () => {
    const nd = emptyDB()
    seedDemo(nd)
    nd.meta.scenario = 3
    saveDB(nd)
    return nd
  }
  // داده خراب یا ناتمام → داده نمونه جدید
  if (!db || typeof db !== 'object' || !db.settings || typeof db.settings !== 'object') return reseed()
  // سناریوی نمونه قدیمی «پارس‌داده» (نسخه‌های ۱.۰ تا ۱.۲) → بازسازی با سناریوی مه‌آی
  if (String(db.settings.company_name || '').includes('پارس‌داده')) return reseed()
  // سناریوی نمونه قدیمی نسخه ۱.۵ (طراحی لوگو، پنل پیامک، سرور) → بازسازی با تم هزینه‌های راه‌اندازی
  // (هاست، ثبت شرکت، دامنه، SSL، مهر و لوازم ضروری) — نشانگر: فاکتور LOGO-1405 که در نسخه ۳ حذف شده است
  if (Number((db.meta && db.meta.scenario) || 0) < 3 && (db.expenses || []).some(e => e.invoice_no === 'LOGO-1405')) return reseed()

  let touched = false
  for (const t of REQUIRED_TABLES) {
    if (!Array.isArray(db[t])) { db[t] = []; touched = true }
  }
  if (!db.seq || typeof db.seq !== 'object') { db.seq = {}; touched = true }
  if (!db.counters || typeof db.counters !== 'object') { db.counters = {}; touched = true }
  if (!db.meta || typeof db.meta !== 'object') { db.meta = { version: 1, createdAt: todayIso() }; touched = true }
  if (db.meta.scenario !== 3) { db.meta.scenario = 3; touched = true }
  // فیلدهای پروفایل شرکت و ماتریس دسترسی
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
    if (db.settings[k] === undefined) { db.settings[k] = v; touched = true }
  }
  if (!db.settings.role_perms || typeof db.settings.role_perms !== 'object') {
    db.settings.role_perms = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS))
    touched = true
  } else if (Array.isArray(db.settings.role_perms.member)) {
    // پرتال عضو بدون «وضعیت حساب من» و «کیف پول من» بی‌معناست — در ماتریس قدیمی تضمین می‌شود
    const mp = db.settings.role_perms.member
    for (const key of ['my-account', 'wallet']) {
      if (!mp.includes(key)) { mp.push(key); touched = true }
    }
  }
  if (touched) saveDB(db)
  return db
}

function db () {
  if (_db === null) {
    _db = loadDB()
    if (!_db) {
      _db = emptyDB()
      seedDemo(_db)
      _db.meta.scenario = 3
      saveDB(_db)
    } else {
      _db = migrateDB(_db)
    }
  }
  return _db
}

function commit () { saveDB(_db) }

// ---------- احراز هویت ----------

function currentUser () {
  const s = getSession()
  if (!s) throw new HttpError(401, 'ورود لازم است')
  const u = db().users.find(x => x.id === s.user_id)
  if (!u || !u.is_active) throw new HttpError(401, 'کاربر غیرفعال است')
  return u
}

function require (roles = []) {
  const u = currentUser()
  if (roles.length && !roles.includes(u.role)) {
    throw new HttpError(403, 'این عملیات با نقش شما مجاز نیست')
  }
  return u
}

function guardPeriod () {
  const u = currentUser()
  if (db().settings.period_closed && u.role !== 'admin') {
    throw new HttpError(403, 'دوره مالی بسته است؛ ثبت یا تغییر با مجوز ویژه (مدیر سامانه) امکان‌پذیر است')
  }
}

const userPub = (u) => ({
  id: u.id, username: u.username, full_name: u.full_name,
  role: u.role, member_id: u.member_id, is_active: u.is_active,
  has_pin: !!u.pin_hash,
})

const roleLabels = {
  admin: 'مدیر سامانه', finance: 'مدیر مالی', accountant: 'مسئول حسابداری',
  ceo: 'مدیرعامل / تأییدکننده', member: 'عضو / سهامدار', auditor: 'حسابرس',
}

// ---------- سریالایز ----------

const memberPub = (m) => ({ ...m })
const sharePub = (s) => ({ ...s })
const accountPub = (a) => ({ ...a })
const expensePub = (db2, e, withAtts = true) => ({
  ...e,
  category_name: E.accName(db2, e.category_code),
  project_name: db2.projects.find(p => p.id === e.project_id)?.name || '',
  payer_name: db2.members.find(m => m.id === e.payer_member_id)?.full_name || '',
  attachments: withAtts ? db2.attachments.filter(a => a.entity_type === 'expense' && a.entity_id === e.id) : undefined,
})
const fundingPub = (db2, f, detail = false) => {
  const rows = []
  let collected = 0
  if (detail) {
    for (const c of db2.commitments.filter(c => c.funding_id === f.id)) {
      const m = db2.members.find(m => m.id === c.member_id)
      const paid = E.commitmentPaid(db2, c)
      collected += paid
      rows.push({
        id: c.id, member_id: c.member_id, member_name: m?.full_name || '',
        share_bp: c.share_bp, amount: c.amount, paid,
        remaining: Math.max(c.amount - paid, 0), settled: paid >= c.amount,
      })
    }
  }
  const collectedAll = rows.length ? collected
    : db2.commitments.filter(c => c.funding_id === f.id).reduce((s, c) => s + E.commitmentPaid(db2, c), 0)
  return {
    ...f, commitments: rows, collected: collectedAll,
    progress: f.amount ? Math.floor(collectedAll * 100 / f.amount) : 0,
    project_name: db2.projects.find(p => p.id === f.project_id)?.name || '',
  }
}
const paymentPub = (db2, p) => {
  const alloc = db2.allocations.filter(a => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0)
  return {
    ...p,
    member_name: db2.members.find(m => m.id === p.member_id)?.full_name || '',
    funding_no: db2.funding.find(f => f.id === p.funding_id)?.no || '',
    bank_name: db2.banks.find(b => b.id === p.bank_id)?.name || '',
    allocated: alloc, unallocated: p.status === 'approved' ? p.amount - alloc : 0,
  }
}
const voucherPub = (db2, v) => ({
  ...v,
  total_debit: v.lines.reduce((s, l) => s + l.debit, 0),
  total_credit: v.lines.reduce((s, l) => s + l.credit, 0),
  lines: v.lines.map(l => ({ ...l, account_name: E.accName(db2, l.account_code) })),
})
const auditPub = (a) => ({ ...a })

// ---------- منطق هزینه ----------

function postExpenseVoucher (db2, e, user) {
  const drCode = e.asset_kind === 'asset' ? '1301' : (e.asset_kind === 'deposit' ? '1201' : e.category_code)
  const dr = { account_code: drCode, debit: e.total_amount, description: `${e.no} — ${e.title}`, project_id: e.project_id }
  let lines
  if (e.payer_type === 'member') {
    const m = db2.members.find(m => m.id === e.payer_member_id)
    const taf = E.tafsilForMember(db2, e.payer_member_id)
    lines = [dr, {
      account_code: '2102', tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '',
      credit: e.total_amount, description: `پرداخت ${m?.full_name || ''} از حساب شخصی`,
    }]
  } else if (e.pay_status === 'paid' && e.paid_amount >= e.total_amount) {
    const acc = E.bankCode(db2, e.bank_id)
    const bt = e.bank_id ? E.tafsilForBank(db2, e.bank_id) : null
    lines = [dr, {
      account_code: acc, tafsil_id: bt?.id ?? null,
      tafsil_name: bt?.name || (acc === '1101' ? 'صندوق' : ''),
      credit: e.total_amount, description: 'پرداخت از حساب شرکت',
    }]
  } else {
    const pt = E.partyTafsil(db2, e.party_name || 'طرف حساب')
    lines = [dr, {
      account_code: '2101', tafsil_id: pt.id, tafsil_name: pt.name,
      credit: e.total_amount, description: `بدهی به ${pt.name}`,
    }]
  }
  E.postVoucher(db2, { vdate: e.exp_date, description: `ثبت هزینه ${e.no} — ${e.title}`, lines, sourceType: 'expense', sourceId: e.id, idemKey: `exp:${e.id}`, user })
  if (e.payer_type === 'member') {
    const cr = {
      id: nextId(db2, 'credits'), member_id: e.payer_member_id, expense_id: e.id,
      amount: e.total_amount, remaining: e.total_amount,
      note: `هزینه ${e.no} پرداخت‌شده توسط عضو`, created_at: new Date().toISOString(),
    }
    db2.credits.push(cr)
    if (db2.settings.auto_offset) {
      cr.remaining = E.autoAllocate(db2, { memberId: e.payer_member_id, amount: e.total_amount, creditId: cr.id, user })
    }
  }
}

function postPaymentVoucher (db2, p, user) {
  const acc = p.method === 'cash' ? '1101' : E.bankCode(db2, p.bank_id)
  const bt = p.method !== 'cash' && p.bank_id ? E.tafsilForBank(db2, p.bank_id) : null
  const m = db2.members.find(m => m.id === p.member_id)
  const taf = E.tafsilForMember(db2, p.member_id)
  const ftype = p.funding_id ? (db2.funding.find(f => f.id === p.funding_id)?.ftype || 'current') : 'current'
  const crCode = { current: '2102', loan: '2103', capital: '3101' }[ftype] || '2102'
  const crDesc = { current: 'جاری عضو', loan: 'وام عضو به شرکت', capital: 'افزایش سرمایه' }[ftype]
  const v = E.postVoucher(db2, {
    vdate: p.pay_date, description: `وصول پرداخت ${p.no} — ${m?.full_name || ''}`,
    lines: [
      { account_code: acc, tafsil_id: bt?.id ?? null, tafsil_name: bt?.name || (acc === '1101' ? 'صندوق' : ''), debit: p.amount, description: `وصول ${p.no} از ${m?.full_name || ''}` },
      { account_code: crCode, tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '', credit: p.amount, description: crDesc },
    ],
    sourceType: 'payment', sourceId: p.id, idemKey: `pay:${p.id}`, user,
  })
  p.voucher_id = v.id
}

// ---------- روتر ----------

const routes = {}
const regexRoutes = new Set()
const route = (method, path, fn) => {
  const p = path instanceof RegExp ? path.source : path
  routes[`${method} ${p}`] = fn
  if (path instanceof RegExp) regexRoutes.add(`${method} ${p}`)
}

// auth
route('POST', '/api/auth/login', ({ body }) => {
  const d = db()
  const u = d.users.find(x => x.username === (body.username || '').trim())
  if (!u || !u.is_active || !verifyPassword(body.password || '', u.pw_hash)) {
    throw new HttpError(401, 'نام کاربری یا رمز عبور نادرست است')
  }
  if (u.pin_hash) {
    if (!body.pin) throw new HttpError(401, 'PIN_REQUIRED')
    if (!verifyPassword(body.pin, u.pin_hash)) throw new HttpError(401, 'رمز دومرحله‌ای نادرست است')
  }
  setSession({ user_id: u.id, token: randomHex(16) })
  log(d, u, 'login', 'user', u.id, {})
  commit()
  return { token: randomHex(8), user: { ...userPub(u), role_label: roleLabels[u.role] } }
})
route('POST', '/api/auth/logout', () => { setSession(null); return { ok: true } })
route('GET', '/api/auth/me', () => {
  const u = currentUser()
  return { ...userPub(u), role_label: roleLabels[u.role] }
})
route('POST', '/api/auth/pin', ({ body }) => {
  const u = currentUser()
  if (body.pin && /^\d{4,}$/.test(body.pin)) u.pin_hash = hashPassword(body.pin)
  else if (!body.pin) u.pin_hash = null
  else throw new HttpError(400, 'PIN باید ۴ رقم یا بیشتر و فقط عدد باشد')
  commit()
  return { has_pin: !!u.pin_hash }
})

// users
route('GET', '/api/users', () => {
  require(['admin'])
  return db().users.map(userPub)
})
route('POST', '/api/users', ({ body }) => {
  const user = require(['admin'])
  if (!roleLabels[body.role]) throw new HttpError(400, 'نقش نامعتبر است')
  if (db().users.some(u => u.username === body.username)) throw new HttpError(400, 'نام کاربری تکراری است')
  if (body.role === 'member' && !body.member_id) throw new HttpError(400, 'کاربر نقش عضو باید به یک عضو متصل شود')
  if (!body.password || body.password.length < 6) throw new HttpError(400, 'رمز عبور باید حداقل ۶ نویسه باشد')
  const u = { id: nextId(db(), 'users'), ...body, pw_hash: hashPassword(body.password), pin_hash: null }
  db().users.push(u)
  log(db(), user, 'create', 'user', u.id, { username: u.username, role: u.role })
  commit()
  return userPub(u)
})
route('PATCH', /^\/api\/users\/(\d+)$/, ({ body, match }) => {
  const user = require(['admin'])
  const u = db().users.find(x => x.id === Number(match[1]))
  if (!u) throw new HttpError(404, 'کاربر یافت نشد')
  const before = { role: u.role, is_active: u.is_active, member_id: u.member_id }
  Object.assign(u, { full_name: body.full_name, role: body.role, member_id: body.member_id, is_active: body.is_active })
  if (body.password) {
    if (body.password.length < 6) throw new HttpError(400, 'رمز عبور باید حداقل ۶ نویسه باشد')
    u.pw_hash = hashPassword(body.password)
  }
  log(db(), user, 'update', 'user', u.id, { before, after: body })
  commit()
  return userPub(u)
})
route('DELETE', /^\/api\/users\/(\d+)$/, ({ match }) => {
  const user = require(['admin'])
  const u = db().users.find(x => x.id === Number(match[1]))
  if (!u) throw new HttpError(404, 'کاربر یافت نشد')
  if (u.id === user.id) throw new HttpError(400, 'حذف کاربر خودی مجاز نیست')
  u.is_active = false
  log(db(), user, 'deactivate', 'user', u.id, { username: u.username })
  commit()
  return { ok: true }
})

// settings
route('GET', '/api/settings/public', () => {
  // برندینگ عمومی برای صفحه ورود — بدون احراز هویت
  const s = db().settings
  return { company_name: s.company_name, company_name_en: s.company_name_en || '', company_logo: s.company_logo || '' }
})
route('GET', '/api/settings', () => {
  require()
  const s = db().settings
  const { secret, ...pub } = s
  return pub
})
route('PATCH', '/api/settings', ({ body }) => {
  const user = require(['admin', 'finance'])
  const s = db().settings
  Object.assign(s, body)
  log(db(), user, 'update', 'settings', 1, body)
  commit()
  return { ok: true }
})
route('POST', '/api/settings/period', ({ body }) => {
  const user = require(['finance', 'admin'])
  db().settings.period_closed = !!body.closed
  log(db(), user, body.closed ? 'close_period' : 'open_period', 'settings', 1, { reason: body.reason })
  commit()
  return { period_closed: db().settings.period_closed }
})
route('GET', '/api/settings/backup', () => {
  require(['admin', 'finance'])
  const d = db()
  const clone = JSON.parse(JSON.stringify(d))
  delete clone.meta
  return clone
})

// members
route('GET', '/api/members', () => {
  const u = require()
  let rows = db().members
  if (u.role === 'member') rows = rows.filter(m => m.id === u.member_id)
  return rows.map(m => ({ ...memberPub(m), share_now_bp: E.memberShareBpAt(db(), m.id, null) }))
})
route('POST', '/api/members', ({ body }) => {
  const user = require(['admin', 'finance'])
  if (db().members.some(m => m.code === body.code)) throw new HttpError(400, 'کد عضو تکراری است')
  const m = { id: nextId(db(), 'members'), ...body }
  db().members.push(m)
  db().tafsils.push({ id: nextId(db(), 'tafsils'), ttype: 'member', name: m.full_name, ref_id: m.id })
  log(db(), user, 'create', 'member', m.id, { code: m.code, name: m.full_name })
  commit()
  return memberPub(m)
})
route('PATCH', /^\/api\/members\/(\d+)$/, ({ body, match }) => {
  const user = require(['admin', 'finance'])
  const m = db().members.find(x => x.id === Number(match[1]))
  if (!m) throw new HttpError(404, 'عضو یافت نشد')
  Object.assign(m, body)
  const taf = db().tafsils.find(t => t.ttype === 'member' && t.ref_id === m.id)
  if (taf) taf.name = m.full_name
  log(db(), user, 'update', 'member', m.id, body)
  commit()
  return memberPub(m)
})
route('GET', /^\/api\/members\/(\d+)\/statement$/, ({ match }) => {
  const u = require()
  const mid = Number(match[1])
  if (u.role === 'member' && u.member_id !== mid) throw new HttpError(403, 'فقط وضعیت حساب خودتان قابل مشاهده است')
  return E.memberStatement(db(), mid)
})
route('GET', /^\/api\/members\/(\d+)\/timeline$/, ({ match }) => {
  const u = require()
  const mid = Number(match[1])
  if (u.role === 'member' && u.member_id !== mid) throw new HttpError(403, 'دسترسی مجاز نیست')
  return E.memberTimeline(db(), mid)
})

// پروفایل اشخاص شرکت — اعضا (وضعیت مالی کامل) و کارکنان (فعالیت)
route('GET', '/api/profiles', () => {
  const u = require()
  const d = db()
  const members = d.members.map(m => {
    const st = E.memberStatement(d, m.id)
    return {
      id: m.id, code: m.code, full_name: m.full_name, kind: m.kind, phone: m.phone, email: m.email,
      share_now: st.share_now, totals: st.totals,
    }
  })
  const staff = d.users.filter(x => x.is_active).map(x => {
    const acts = d.audit.filter(a => a.username === x.username)
    const lastLogin = acts.find(a => a.action === 'login')
    return {
      id: x.id, username: x.username, full_name: x.full_name, role: x.role,
      member_id: x.member_id, last_login: lastLogin?.ts?.slice(0, 10) || '',
      action_count: acts.length,
    }
  })
  if (u.role === 'member') {
    return { members: members.filter(m => m.id === u.member_id), staff: [] }
  }
  return { members, staff }
})
route('GET', /^\/api\/members\/(\d+)\/shares$/, ({ match }) => {
  const u = require()
  const mid = Number(match[1])
  if (u.role === 'member' && u.member_id !== mid) throw new HttpError(403, 'دسترسی مجاز نیست')
  return db().shares.filter(s => s.member_id === mid).sort((a, b) => a.from_date.localeCompare(b.from_date)).map(sharePub)
})
route('POST', /^\/api\/members\/(\d+)\/shares$/, ({ body, match }) => {
  const user = require(['admin', 'finance'])
  const mid = Number(match[1])
  if (!db().members.some(m => m.id === mid)) throw new HttpError(404, 'عضو یافت نشد')
  if (body.percent_bp <= 0 || body.percent_bp > 10000) throw new HttpError(400, 'درصد سهم باید بین ۰ و ۱۰۰ باشد')
  if (body.to_date && body.to_date < body.from_date) throw new HttpError(400, 'تاریخ پایان باید پس از تاریخ شروع باشد')
  const m = db().members.find(x => x.id === mid)
  const lastTo = m.shares_id_hint // noop
  const shareRows = db().shares.filter(s => s.member_id === mid)
  const maxTo = shareRows.length ? shareRows.map(s => s.to_date || '9999').sort().pop() : '0000'
  if (body.from_date <= maxTo) throw new HttpError(400, 'سهم جدید باید پس از دوره قبلی شروع شود')
  const s = { id: nextId(db(), 'shares'), member_id: mid, ...body }
  db().shares.push(s)
  log(db(), user, 'create', 'share', s.id, { member: m.full_name, percent: body.percent_bp / 100, from: body.from_date })
  commit()
  return sharePub(s)
})
route('DELETE', /^\/api\/members\/(\d+)\/shares\/(\d+)$/, ({ match }) => {
  const user = require(['admin', 'finance'])
  const d = db()
  const s = d.shares.find(x => x.id === Number(match[2]) && x.member_id === Number(match[1]))
  if (!s) throw new HttpError(404, 'رکورد سهم یافت نشد')
  d.shares = d.shares.filter(x => x.id !== s.id)
  log(d, user, 'delete', 'share', s.id, { member_id: Number(match[1]) })
  commit()
  return { ok: true }
})

// accounts / projects / banks
route('GET', '/api/accounts', () => {
  require()
  return db().accounts.map(accountPub)
})
route('POST', '/api/accounts', ({ body }) => {
  const user = require(['admin', 'finance'])
  const d = db()
  if (d.accounts.some(a => a.code === body.code)) throw new HttpError(400, 'این کد حساب قبلاً ثبت شده است')
  if (body.level === 'moin' && !body.parent_code) throw new HttpError(400, 'حساب معین باید زیر یک حساب کل تعریف شود')
  const a = { id: nextId(d, 'accounts'), ...body, parent_code: body.parent_code || null }
  d.accounts.push(a)
  log(d, user, 'create', 'account', a.id, { code: a.code, name: a.name })
  commit()
  return accountPub(a)
})
route('PATCH', /^\/api\/accounts\/(\d+)$/, ({ body, match }) => {
  const user = require(['admin', 'finance'])
  const d = db()
  const a = d.accounts.find(x => x.id === Number(match[1]))
  if (!a) throw new HttpError(404, 'حساب یافت نشد')
  const hasMove = d.vouchers.some(v => v.status === 'confirmed' && v.lines.some(l => l.account_code === a.code))
  if (a.code !== body.code && hasMove) throw new HttpError(400, 'حساب دارای گردش است؛ تغییر کد مجاز نیست')
  Object.assign(a, { name: body.name, is_active: body.is_active })
  log(d, user, 'update', 'account', a.id, { name: body.name })
  commit()
  return accountPub(a)
})
route('DELETE', /^\/api\/accounts\/(\d+)$/, ({ match }) => {
  const user = require(['admin', 'finance'])
  const d = db()
  const a = d.accounts.find(x => x.id === Number(match[1]))
  if (!a) throw new HttpError(404, 'حساب یافت نشد')
  const hasMove = d.vouchers.some(v => v.status === 'confirmed' && v.lines.some(l => l.account_code === a.code))
  if (hasMove) throw new HttpError(400, 'حساب دارای گردش است و حذف آن مجاز نیست')
  if (d.accounts.some(x => x.parent_code === a.code)) throw new HttpError(400, 'ابتدا حساب‌های زیرمجموعه را حذف کنید')
  d.accounts = d.accounts.filter(x => x.id !== a.id)
  log(d, user, 'delete', 'account', a.id, { code: a.code })
  commit()
  return { ok: true }
})
route('GET', '/api/projects', () => { require(); return db().projects })
route('POST', '/api/projects', ({ body }) => {
  const user = require(['admin', 'finance', 'accountant'])
  const p = { id: nextId(db(), 'projects'), ...body }
  db().projects.push(p)
  log(db(), user, 'create', 'project', p.id, { name: p.name })
  commit()
  return p
})
route('GET', '/api/banks', () => {
  require()
  return db().banks.map(b => ({
    ...b,
    tafsil_name: db().tafsils.find(t => t.ttype === 'bank' && t.ref_id === b.id)?.name || '',
  }))
})
route('POST', '/api/banks', ({ body }) => {
  const user = require(['admin', 'finance'])
  const d = db()
  const b = { id: nextId(d, 'banks'), is_active: true, ...body }
  d.banks.push(b)
  d.tafsils.push({ id: nextId(d, 'tafsils'), ttype: 'bank', name: b.name, ref_id: b.id })
  log(d, user, 'create', 'bank', b.id, { name: b.name })
  commit()
  return b
})
route('GET', '/api/banks/tafsils', () => {
  require()
  return db().tafsils
})

// expenses
route('GET', '/api/expenses', ({ query }) => {
  const u = require()
  const d = db()
  let rows = [...d.expenses].sort((a, b) => b.id - a.id)
  if (u.role === 'member') {
    rows = d.settings.member_sees_all_expenses ? rows : rows.filter(e => e.payer_member_id === u.member_id)
  }
  const q = query || {}
  if (q.q) rows = rows.filter(e => (e.title + e.party_name + e.no + e.invoice_no).includes(q.q))
  if (q.status) rows = rows.filter(e => e.appr_status === q.status)
  if (q.pay_status) rows = rows.filter(e => e.pay_status === q.pay_status)
  if (q.date_from) rows = rows.filter(e => e.exp_date >= q.date_from)
  if (q.date_to) rows = rows.filter(e => e.exp_date <= q.date_to)
  if (q.project_id) rows = rows.filter(e => e.project_id === Number(q.project_id))
  if (q.member_id) rows = rows.filter(e => e.payer_member_id === Number(q.member_id))
  return rows.map(e => expensePub(d, e, false))
})
route('GET', '/api/expenses/dupcheck', ({ query }) => {
  require(['admin', 'finance', 'accountant'])
  const q = query || {}
  const hits = db().expenses.filter(e => e.appr_status !== 'rejected').map(e => {
    let score = 0
    if (q.invoice_no && e.invoice_no === q.invoice_no) score += 2
    if (q.party_name && e.party_name === q.party_name && q.total_amount) {
      const diff = Math.abs(e.total_amount - Number(q.total_amount))
      if (diff === 0) score += 3
      else if (diff <= Math.max(1, Number(q.total_amount) / 10000)) score += 2
    }
    return score >= 2 ? {
      id: e.id, no: e.no, title: e.title, date: e.exp_date, party_name: e.party_name,
      invoice_no: e.invoice_no, total_amount: e.total_amount, score,
    } : null
  }).filter(Boolean)
  return { duplicates: hits }
})
route('POST', '/api/expenses', ({ body }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const total = Number(body.base_amount || 0) + Number(body.tax_amount || 0)
  if (total <= 0) throw new HttpError(400, 'مبلغ هزینه باید بزرگ‌تر از صفر باشد')
  if (body.payer_type === 'member' && !body.payer_member_id) throw new HttpError(400, 'پرداخت‌کننده عضو باید مشخص شود')
  const e = {
    id: nextId(d, 'expenses'),
    no: E.nextNumberLocal(d, 'expense', body.exp_date, { expense: 'H' }),
    exp_date: body.exp_date, entry_date: todayIso(),
    title: body.title, description: body.description || '',
    base_amount: Number(body.base_amount || 0), tax_amount: Number(body.tax_amount || 0),
    total_amount: total, party_name: body.party_name || '',
    category_code: body.category_code || '51091',
    project_id: body.project_id ?? null,
    payer_type: body.payer_type || 'company',
    payer_member_id: body.payer_type === 'member' ? body.payer_member_id : null,
    paid_via: body.paid_via || 'bank', bank_id: body.bank_id ?? null,
    pay_status: body.payer_type === 'member' ? 'paid' : (body.pay_status || 'unpaid'),
    paid_amount: 0, appr_status: 'draft',
    invoice_no: body.invoice_no || '', asset_kind: body.asset_kind || 'expense',
    note: body.note || '', created_by: user.username, approved_by: '',
    created_at: new Date().toISOString(),
  }
  d.expenses.push(e)
  log(d, user, 'create', 'expense', e.id, { no: e.no, total })
  commit()
  return expensePub(d, e)
})
route('GET', /^\/api\/expenses\/(\d+)$/, ({ match }) => {
  const u = require()
  const e = db().expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (u.role === 'member' && e.payer_member_id !== u.member_id && !db().settings.member_sees_all_expenses) {
    throw new HttpError(403, 'دسترسی به این هزینه مجاز نیست')
  }
  return expensePub(db(), e)
})
route('PATCH', /^\/api\/expenses\/(\d+)$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const e = d.expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (e.appr_status === 'approved') throw new HttpError(400, 'هزینه تأییدشده قابل ویرایش نیست؛ اصلاح فقط با سند ابطال/اصلاحی انجام می‌شود')
  const total = Number(body.base_amount || 0) + Number(body.tax_amount || 0)
  Object.assign(e, {
    exp_date: body.exp_date, title: body.title, description: body.description || '',
    base_amount: Number(body.base_amount || 0), tax_amount: Number(body.tax_amount || 0),
    total_amount: total, party_name: body.party_name || '',
    category_code: body.category_code, project_id: body.project_id ?? null,
    payer_type: body.payer_type, payer_member_id: body.payer_type === 'member' ? body.payer_member_id : null,
    paid_via: body.paid_via, bank_id: body.bank_id ?? null,
    pay_status: body.payer_type === 'member' ? 'paid' : (e.paid_amount > 0 ? e.pay_status : (body.pay_status || 'unpaid')),
    invoice_no: body.invoice_no || '', asset_kind: body.asset_kind, note: body.note || '',
  })
  log(d, user, 'update', 'expense', e.id, { title: e.title, total })
  commit()
  return expensePub(d, e)
})
route('DELETE', /^\/api\/expenses\/(\d+)$/, ({ match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const e = d.expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (e.appr_status !== 'draft') throw new HttpError(400, 'فقط پیش‌نویس قابل حذف است')
  d.expenses = d.expenses.filter(x => x.id !== e.id)
  log(d, user, 'delete', 'expense', e.id, { no: e.no })
  commit()
  return { ok: true }
})
route('POST', /^\/api\/expenses\/(\d+)\/submit$/, ({ match }) => {
  const user = require(['admin', 'finance', 'accountant'])
  const e = db().expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (!['draft', 'rejected'].includes(e.appr_status)) throw new HttpError(400, 'این هزینه در جریان تأیید است')
  e.appr_status = 'pending'
  log(db(), user, 'submit', 'expense', e.id, { no: e.no })
  commit()
  return { ok: true, status: e.appr_status }
})
route('POST', /^\/api\/expenses\/(\d+)\/approve$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['ceo'])
  const d = db()
  const e = d.expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (e.appr_status !== 'pending') throw new HttpError(400, 'فقط هزینه «در انتظار تأیید» قابل تصمیم‌گیری است')
  if (body.decision === 'reject') {
    e.appr_status = 'rejected'
    e.note = (e.note ? e.note + '\n' : '') + `رد توسط ${user.username}: ${body.note || ''}`
    log(d, user, 'reject', 'expense', e.id, { note: body.note })
    commit()
    return { ok: true, status: 'rejected' }
  }
  e.appr_status = 'approved'
  e.approved_by = user.username
  e.approved_at = new Date().toISOString()
  postExpenseVoucher(d, e, user)
  commit()
  return { ok: true, status: 'approved' }
})
route('POST', /^\/api\/expenses\/(\d+)\/settle$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const e = d.expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (e.appr_status !== 'approved') throw new HttpError(400, 'فقط هزینه تأییدشده قابل تسویه است')
  if (e.payer_type === 'member') throw new HttpError(400, 'هزینه پرداخت‌شده توسط عضو نیازی به تسویه ندارد')
  const remaining = e.total_amount - e.paid_amount
  if (body.amount <= 0 || body.amount > remaining) {
    throw new HttpError(400, `مبلغ باید بین ۱ و ${remaining.toLocaleString('fa-IR')} ریال باشد`)
  }
  const pt = E.partyTafsil(d, e.party_name || 'طرف حساب')
  const acc = body.via === 'cash' ? '1101' : E.bankCode(d, body.bank_id)
  const bt = body.via === 'bank' && body.bank_id ? E.tafsilForBank(d, body.bank_id) : null
  const seq = d.vouchers.filter(v => v.idem_key.startsWith(`expsettle:${e.id}:`)).length
  E.postVoucher(d, {
    vdate: body.date, description: `تسویه هزینه ${e.no} — ${e.title}`,
    lines: [
      { account_code: '2101', tafsil_id: pt.id, tafsil_name: pt.name, debit: body.amount, description: `پرداخت به ${pt.name}` },
      { account_code: acc, tafsil_id: bt?.id ?? null, tafsil_name: bt?.name || (acc === '1101' ? 'صندوق' : ''), credit: body.amount, description: 'پرداخت از حساب شرکت' },
    ],
    sourceType: 'expense_settle', sourceId: e.id, idemKey: `expsettle:${e.id}:${seq + 1}`, user,
  })
  e.paid_amount += body.amount
  e.pay_status = e.paid_amount >= e.total_amount ? 'paid' : 'partial'
  log(d, user, 'settle', 'expense', e.id, { amount: body.amount })
  commit()
  return expensePub(d, e)
})
route('POST', /^\/api\/expenses\/(\d+)\/attachments$/, ({ body, match }) => {
  const user = require(['admin', 'finance', 'accountant', 'member'])
  const e = db().expenses.find(x => x.id === Number(match[1]))
  if (!e) throw new HttpError(404, 'هزینه یافت نشد')
  if (user.role === 'member' && e.payer_member_id !== user.member_id) throw new HttpError(403, 'دسترسی مجاز نیست')
  if ((body.dataUrl || '').length > 10 * 1024 * 1024) throw new HttpError(400, 'حجم فایل بیش از حد مجاز است')
  const a = {
    id: nextId(db(), 'attachments'), entity_type: 'expense', entity_id: e.id,
    name: body.name, size: body.size || 0, mime: body.mime || '',
    path: body.dataUrl || '', uploaded_by: user.username,
    created_at: new Date().toISOString(),
  }
  db().attachments.push(a)
  log(db(), user, 'upload', 'attachment', a.id, { expense: e.no, name: a.name })
  commit()
  return { ...a }
})
route('DELETE', /^\/api\/expenses\/(\d+)\/attachments\/(\d+)$/, ({ match }) => {
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const a = d.attachments.find(x => x.id === Number(match[2]))
  if (!a) throw new HttpError(404, 'پیوست یافت نشد')
  d.attachments = d.attachments.filter(x => x.id !== a.id)
  commit()
  return { ok: true }
})

// funding
route('GET', '/api/funding', ({ query }) => {
  const u = require()
  let rows = [...db().funding].sort((a, b) => b.id - a.id)
  if (u.role === 'member') {
    rows = rows.filter(f => f.status === 'approved' && (f.member_ids || []).includes(u.member_id))
  }
  if (query?.status) rows = rows.filter(f => f.status === query.status)
  return rows.map(f => fundingPub(db(), f))
})
route('POST', '/api/funding/preview', ({ body }) => {
  require()
  const rows = E.calcSplit(db(), {
    amount: body.amount, method: body.method, memberIds: body.member_ids,
    percents: body.percents, fixedAmounts: body.fixed_amounts,
    baseDate: body.base_date || null,
  })
  return {
    rows: rows.map(r => ({ ...r, member_name: db().members.find(m => m.id === r.member_id)?.full_name || '' })),
    total: rows.reduce((s, r) => s + r.amount, 0),
  }
})
route('POST', '/api/funding', ({ body }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  E.calcSplit(d, { amount: body.amount, method: body.method, memberIds: body.member_ids, percents: body.percents, fixedAmounts: body.fixed_amounts, baseDate: body.base_date || null })
  const f = {
    id: nextId(d, 'funding'),
    no: E.nextNumberLocal(d, 'funding', todayIso(), { funding: 'F' }),
    title: body.title, description: body.description || '', amount: body.amount,
    split_method: body.method, percents: body.percents || {}, fixed_amounts: body.fixed_amounts || {},
    member_ids: body.member_ids, base_date: body.base_date || '', due_date: body.due_date || '',
    ftype: body.ftype || 'current', doc_ref: body.doc_ref || '',
    project_id: body.project_id ?? null, status: 'draft',
    created_by: user.username, approved_by: '', note: body.note || '',
    created_at: new Date().toISOString(),
  }
  d.funding.push(f)
  log(d, user, 'create', 'funding', f.id, { no: f.no, amount: f.amount, method: f.split_method })
  commit()
  return fundingPub(d, f)
})
route('GET', /^\/api\/funding\/(\d+)$/, ({ match }) => {
  const u = require()
  const f = db().funding.find(x => x.id === Number(match[1]))
  if (!f) throw new HttpError(404, 'درخواست یافت نشد')
  if (u.role === 'member' && !(f.member_ids || []).includes(u.member_id)) throw new HttpError(403, 'دسترسی مجاز نیست')
  return fundingPub(db(), f, true)
})
route('PATCH', /^\/api\/funding\/(\d+)$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const f = d.funding.find(x => x.id === Number(match[1]))
  if (!f) throw new HttpError(404, 'درخواست یافت نشد')
  if (f.status === 'approved') throw new HttpError(400, 'مصوبه تأییدشده قابل ویرایش نیست')
  Object.assign(f, {
    title: body.title, description: body.description || '', amount: body.amount,
    split_method: body.method, percents: body.percents || {}, fixed_amounts: body.fixed_amounts || {},
    member_ids: body.member_ids, base_date: body.base_date || '', due_date: body.due_date || '',
    ftype: body.ftype, doc_ref: body.doc_ref || '', project_id: body.project_id ?? null, note: body.note || '',
  })
  E.calcSplit(d, { amount: f.amount, method: f.split_method, memberIds: f.member_ids, percents: f.percents, fixedAmounts: f.fixed_amounts, baseDate: f.base_date || null })
  log(d, user, 'update', 'funding', f.id, { title: f.title, amount: f.amount })
  commit()
  return fundingPub(d, f, true)
})
route('POST', /^\/api\/funding\/(\d+)\/submit$/, ({ match }) => {
  const user = require(['admin', 'finance', 'accountant'])
  const f = db().funding.find(x => x.id === Number(match[1]))
  if (!f || !['draft', 'rejected'].includes(f.status)) throw new HttpError(400, 'وضعیت درخواست برای ارسال مناسب نیست')
  f.status = 'pending'
  log(db(), user, 'submit', 'funding', f.id, { no: f.no })
  commit()
  return { ok: true }
})
route('POST', /^\/api\/funding\/(\d+)\/approve$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['ceo'])
  const d = db()
  const f = d.funding.find(x => x.id === Number(match[1]))
  if (!f || f.status !== 'pending') throw new HttpError(400, 'فقط درخواست «در انتظار تأیید» قابل تصمیم‌گیری است')
  if (body.decision === 'reject') {
    f.status = 'rejected'
    f.note = (f.note ? f.note + '\n' : '') + `رد توسط ${user.username}: ${body.note || ''}`
    log(d, user, 'reject', 'funding', f.id, { note: body.note })
    commit()
    return { ok: true, status: 'rejected' }
  }
  const rows = E.calcSplit(d, { amount: f.amount, method: f.split_method, memberIds: f.member_ids, percents: f.percents, fixedAmounts: f.fixed_amounts, baseDate: f.base_date || null })
  d.commitments = d.commitments.filter(c => c.funding_id !== f.id)
  for (const r of rows) {
    d.commitments.push({ id: nextId(d, 'commitments'), funding_id: f.id, member_id: r.member_id, share_bp: r.share_bp, amount: r.amount, paid: 0 })
  }
  f.status = 'approved'
  f.approved_by = user.username
  f.approved_at = new Date().toISOString()
  log(d, user, 'approve', 'funding', f.id, { no: f.no, amount: f.amount, rows })
  commit()
  return fundingPub(d, f, true)
})

// payments
route('GET', '/api/payments', ({ query }) => {
  const u = require()
  let rows = [...db().payments].sort((a, b) => b.id - a.id)
  if (u.role === 'member') rows = rows.filter(p => p.member_id === u.member_id)
  if (query?.status) rows = rows.filter(p => p.status === query.status)
  if (query?.member_id) rows = rows.filter(p => p.member_id === Number(query.member_id))
  return rows.map(p => paymentPub(db(), p))
})
route('POST', '/api/payments', ({ body }) => {
  guardPeriod()
  const u = require()
  const d = db()
  let memberId = body.member_id
  if (u.role === 'member') {
    if (!u.member_id) throw new HttpError(403, 'کاربر شما به عضوی متصل نیست')
    memberId = u.member_id
  }
  if (!memberId) throw new HttpError(400, 'پرداخت‌کننده باید مشخص شود')
  if (body.amount <= 0) throw new HttpError(400, 'مبلغ باید مثبت باشد')
  const p = {
    id: nextId(d, 'payments'),
    no: E.nextNumberLocal(d, 'payment', body.pay_date, { payment: 'P' }),
    pay_date: body.pay_date, member_id: memberId, amount: body.amount,
    method: body.method || 'transfer', bank_id: body.bank_id ?? null,
    tracking_no: body.tracking_no || '', receipt_ref: body.receipt_ref || '',
    funding_id: body.funding_id ?? null, note: body.note || '',
    status: 'declared', declared_by: u.username, approved_by: '',
    voucher_id: null, created_at: new Date().toISOString(),
  }
  d.payments.push(p)
  log(d, u, 'declare', 'payment', p.id, { no: p.no, amount: p.amount })
  commit()
  return paymentPub(d, p)
})
route('POST', /^\/api\/payments\/(\d+)\/approve$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['finance', 'admin'])
  const d = db()
  const p = d.payments.find(x => x.id === Number(match[1]))
  if (!p) throw new HttpError(404, 'پرداخت یافت نشد')
  if (p.status !== 'declared') throw new HttpError(400, 'فقط پرداخت «اعلام‌شده» قابل تأیید است')
  if (body.decision === 'reject') {
    p.status = 'rejected'
    p.note = (p.note ? p.note + '\n' : '') + `رد توسط ${user.username}: ${body.note || ''}`
    log(d, user, 'reject', 'payment', p.id, { note: body.note })
    commit()
    return { ok: true, status: 'rejected' }
  }
  p.status = 'approved'
  p.approved_by = user.username
  p.approved_at = new Date().toISOString()
  postPaymentVoucher(d, p, user)
  if (d.settings.auto_offset) {
    E.autoAllocate(d, { memberId: p.member_id, amount: p.amount, paymentId: p.id, fundingId: p.funding_id, user })
  }
  commit()
  return paymentPub(d, p)
})
route('POST', '/api/payments/allocate', ({ body }) => {
  guardPeriod()
  const user = require(['finance', 'admin', 'accountant'])
  const d = db()
  const c = d.commitments.find(x => x.id === body.commitment_id)
  if (!c) throw new HttpError(404, 'تعهد یافت نشد')
  const taken = E.allocateAmount(d, {
    commitment: c, amount: body.amount,
    paymentId: body.target === 'payment' ? body.id : null,
    creditId: body.target === 'credit' ? body.id : null, user,
  })
  commit()
  return { allocated: taken }
})
route('POST', '/api/payments/auto-allocate', ({ body }) => {
  guardPeriod()
  const user = require(['finance', 'admin', 'accountant'])
  const d = db()
  let left = 0
  if (body.target === 'payment') {
    const p = d.payments.find(x => x.id === body.id)
    if (!p) throw new HttpError(404, 'پرداخت یافت نشد')
    const alloc = d.allocations.filter(a => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0)
    left = E.autoAllocate(d, { memberId: p.member_id, amount: p.amount - alloc, paymentId: p.id, fundingId: p.funding_id, user })
  } else {
    const cr = d.credits.find(x => x.id === body.id)
    if (!cr) throw new HttpError(404, 'اعتبار یافت نشد')
    left = E.autoAllocate(d, { memberId: cr.member_id, amount: cr.remaining, creditId: cr.id, user })
    cr.remaining = left
  }
  commit()
  return { unallocated: left }
})

// ---------- خدمات اعضا و جبران خدمات ----------

const servicePub = (d, s) => ({
  ...s,
  member_name: d.members.find(m => m.id === s.member_id)?.full_name || '',
  member_code: d.members.find(m => m.id === s.member_id)?.code || '',
})

route('GET', '/api/services', ({ query }) => {
  const u = require()
  let rows = [...db().services].sort((a, b) => b.id - a.id)
  if (u.role === 'member') rows = rows.filter(s => s.member_id === u.member_id)
  if (query?.status) rows = rows.filter(s => s.status === query.status)
  if (query?.member_id) rows = rows.filter(s => s.member_id === Number(query.member_id))
  return rows.map(s => servicePub(db(), s))
})

route('POST', '/api/services', ({ body }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const amount = Number(body.qty || 0) * Number(body.unit_price || 0)
  if (!body.member_id) throw new HttpError(400, 'عضو ارائه‌دهنده خدمت باید مشخص شود')
  if (!body.title?.trim()) throw new HttpError(400, 'عنوان خدمت الزامی است')
  if (amount <= 0) throw new HttpError(400, 'مبلغ خدمت باید بزرگ‌تر از صفر باشد (تعداد × نرخ)')
  if (!body.sdate) throw new HttpError(400, 'تاریخ ارائه خدمت الزامی است')
  const s = {
    id: nextId(d, 'services'),
    no: E.nextNumberLocal(d, 'service', body.sdate, { service: 'SV' }),
    member_id: Number(body.member_id), sdate: body.sdate,
    stype: body.stype || 'other', title: body.title, description: body.description || '',
    qty: Number(body.qty || 0), unit: body.unit || 'ساعت', unit_price: Number(body.unit_price || 0),
    amount, calc_note: body.calc_note || '',
    status: 'draft', comp_method: null, comp_date: '', comp_note: '',
    voucher_id: null, credit_id: null,
    created_by: user.username, approved_by: '', approved_at: null,
    created_at: new Date().toISOString(),
  }
  d.services.push(s)
  log(d, user, 'create', 'service', s.id, { no: s.no, amount })
  commit()
  return servicePub(d, s)
})

route('PATCH', /^\/api\/services\/(\d+)$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const s = d.services.find(x => x.id === Number(match[1]))
  if (!s) throw new HttpError(404, 'خدمت یافت نشد')
  if (s.status !== 'draft') throw new HttpError(400, 'فقط پیش‌نویس خدمت قابل ویرایش است')
  Object.assign(s, {
    member_id: Number(body.member_id), sdate: body.sdate, stype: body.stype || 'other',
    title: body.title, description: body.description || '',
    qty: Number(body.qty || 0), unit: body.unit || 'ساعت', unit_price: Number(body.unit_price || 0),
    amount: Number(body.qty || 0) * Number(body.unit_price || 0), calc_note: body.calc_note || '',
  })
  log(d, user, 'update', 'service', s.id, { no: s.no, amount: s.amount })
  commit()
  return servicePub(d, s)
})

route('DELETE', /^\/api\/services\/(\d+)$/, ({ match }) => {
  guardPeriod()
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const s = d.services.find(x => x.id === Number(match[1]))
  if (!s) throw new HttpError(404, 'خدمت یافت نشد')
  if (s.status !== 'draft') throw new HttpError(400, 'فقط پیش‌نویس قابل حذف است')
  d.services = d.services.filter(x => x.id !== s.id)
  log(d, user, 'delete', 'service', s.id, { no: s.no })
  commit()
  return { ok: true }
})

route('POST', /^\/api\/services\/(\d+)\/submit$/, ({ match }) => {
  const user = require(['admin', 'finance', 'accountant'])
  const d = db()
  const s = d.services.find(x => x.id === Number(match[1]))
  if (!s) throw new HttpError(404, 'خدمت یافت نشد')
  if (!['draft', 'rejected'].includes(s.status)) throw new HttpError(400, 'این خدمت در جریان بررسی است')
  s.status = 'pending'
  log(d, user, 'submit', 'service', s.id, { no: s.no })
  commit()
  return { ok: true, status: s.status }
})

route('POST', /^\/api\/services\/(\d+)\/approve$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['ceo'])
  const d = db()
  const s = d.services.find(x => x.id === Number(match[1]))
  if (!s) throw new HttpError(404, 'خدمت یافت نشد')
  if (s.status !== 'pending') throw new HttpError(400, 'فقط خدمت «در انتظار تأیید» قابل تصمیم‌گیری است')
  if (body.decision === 'reject') {
    s.status = 'rejected'
    s.comp_note = `رد توسط ${user.username}: ${body.note || ''}`
    log(d, user, 'reject', 'service', s.id, { note: body.note })
    commit()
    return { ok: true, status: 'rejected' }
  }
  const method = body.comp_method || 'credit'
  if (!['credit', 'cash'].includes(method)) throw new HttpError(400, 'روش جبران نامعتبر است')
  const m = d.members.find(m => m.id === s.member_id)
  const taf = E.tafsilForMember(d, s.member_id)
  let lines
  if (method === 'credit') {
    if (!taf) throw new HttpError(400, 'تفصیلی عضو یافت نشد')
    lines = [
      { account_code: '51042', debit: s.amount, description: `هزینه جبران خدمات عضو — ${s.title}`, project_id: null },
      { account_code: '2102', tafsil_id: taf.id, tafsil_name: m?.full_name || '', credit: s.amount, description: 'اعتبار جبران خدمات به جاری عضو منظور شد' },
    ]
  } else {
    if (!body.bank_id) throw new HttpError(400, 'برای پرداخت نقدی، حساب بانکی/صندوق باید انتخاب شود')
    const acc = E.bankCode(d, body.bank_id)
    const bt = E.tafsilForBank(d, body.bank_id)
    lines = [
      { account_code: '51042', debit: s.amount, description: `هزینه جبران خدمات عضو — ${s.title}`, project_id: null },
      { account_code: acc, tafsil_id: bt?.id ?? null, tafsil_name: bt?.name || (acc === '1101' ? 'صندوق' : ''), credit: s.amount, description: 'پرداخت نقدی جبران خدمات' },
    ]
  }
  const v = E.postVoucher(d, {
    vdate: body.comp_date || s.sdate, description: `جبران خدمات ${s.no} — ${m?.full_name || ''} (${s.title})`,
    lines, sourceType: 'service', sourceId: s.id, idemKey: `service:${s.id}`, user,
  })
  s.voucher_id = v.id
  s.status = 'compensated'
  s.comp_method = method
  s.comp_date = body.comp_date || s.sdate
  s.comp_note = body.note || (method === 'credit' ? 'جبران از محل اعتبار حساب عضو' : 'پرداخت نقدی جبران خدمات')
  s.approved_by = user.username
  s.approved_at = new Date().toISOString()
  if (method === 'credit') {
    const cr = {
      id: nextId(d, 'credits'), member_id: s.member_id, expense_id: null,
      amount: s.amount, remaining: s.amount,
      note: `جبران خدمات ${s.no} — ${s.title}`, created_at: new Date().toISOString(),
    }
    d.credits.push(cr)
    s.credit_id = cr.id
    if (d.settings.auto_offset) {
      cr.remaining = E.autoAllocate(d, { memberId: s.member_id, amount: s.amount, creditId: cr.id, user })
    }
  }
  log(d, user, 'approve', 'service', s.id, { no: s.no, amount: s.amount, method })
  commit()
  return servicePub(d, s)
})

// ---------- کیف پول اعضا و درگاه بانک ملی ----------

const walletPub = (d, w) => ({
  ...w,
  member_name: d.members.find(m => m.id === w.member_id)?.full_name || '',
  commitment_no: w.commitment_id ? (d.funding.find(f => f.id === (d.commitments.find(c => c.id === w.commitment_id)?.funding_id))?.no || '') : '',
})

// سند شارژ کیف پول: بدهکار بانک / بستانکار جاری عضو + ردیف اعتبار
function postWalletCharge (d, w, user) {
  const m = d.members.find(m => m.id === w.member_id)
  const taf = E.tafsilForMember(d, w.member_id)
  const bt = E.tafsilForBank(d, w.bank_id || 1)
  const accCode = bt?.ref_id === 2 ? '1101' : '11021'
  const v = E.postVoucher(d, {
    vdate: w.wdate, description: `شارژ کیف پول ${w.no} — ${m?.full_name || ''}${w.gateway_ref ? ` (درگاه بانک ملی، مرجع ${w.gateway_ref})` : ''}`,
    lines: [
      { account_code: accCode, tafsil_id: bt?.id ?? null, tafsil_name: bt?.name || '', debit: w.amount, description: 'واریز به حساب شرکت' },
      { account_code: '2102', tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '', credit: w.amount, description: 'شارژ کیف پول عضو — مطالبه عضو از شرکت' },
    ],
    sourceType: 'wallet', sourceId: w.id, idemKey: `wallet:${w.id}`, user,
  })
  w.voucher_id = v.id
  const cr = {
    id: nextId(d, 'credits'), member_id: w.member_id, expense_id: null,
    amount: w.amount, remaining: w.amount,
    note: `شارژ کیف پول ${w.no}`, created_at: new Date().toISOString(),
  }
  d.credits.push(cr)
  return cr
}

// تخصیص اعتبار به یک تعهد مشخص (برای پرداخت مستقیم از کارتابل)
function allocateCreditToCommitment (d, credit, commitmentId, user) {
  const c = d.commitments.find(x => x.id === commitmentId)
  if (!c) throw new HttpError(404, 'تعهد یافت نشد')
  const remaining = Math.max(c.amount - E.commitmentPaid(d, c), 0)
  const take = Math.min(credit.remaining, remaining)
  if (take <= 0) return 0
  d.allocations.push({
    id: nextId(d, 'allocations'), commitment_id: c.id,
    payment_id: null, credit_id: credit.id, amount: take,
    created_at: new Date().toISOString(),
  })
  credit.remaining -= take
  return take
}

route('GET', '/api/wallet', ({ query }) => {
  const u = require()
  const d = db()
  if (u.role === 'member') {
    const mid = u.member_id
    const st = E.memberStatement(d, mid)
    return {
      balance: E.walletBalance(d, mid),
      txs: st.wallet.map(w => walletPub(d, w)),
      commitments: st.commitments.filter(c => c.remaining > 0),
    }
  }
  const mid = query?.member_id ? Number(query.member_id) : null
  let txs = [...d.wallet].sort((a, b) => b.id - a.id).map(w => walletPub(d, w))
  if (mid) txs = txs.filter(w => w.member_id === mid)
  const members = d.members.map(m => ({
    member_id: m.id, full_name: m.full_name, code: m.code,
    balance: E.walletBalance(d, m.id),
    pending: d.wallet.filter(w => w.member_id === m.id && w.type === 'charge' && w.status === 'pending').reduce((s, w) => s + w.amount, 0),
  }))
  return { balance: null, txs, members }
})

// شارژ کیف پول — عضو از پرتال خودش یا کارمند برای عضو
route('POST', '/api/wallet/charge', ({ body }) => {
  const u = require()
  const d = db()
  const mid = u.role === 'member' ? u.member_id : Number(body.member_id)
  if (!mid) throw new HttpError(400, 'عضو باید مشخص شود')
  const amount = Number(body.amount || 0)
  if (amount <= 0) throw new HttpError(400, 'مبلغ شارژ باید بزرگ‌تر از صفر باشد')
  if (!body.wdate) throw new HttpError(400, 'تاریخ شارژ الزامی است')
  const method = body.method === 'gateway' ? 'gateway' : 'manual'
  if (method === 'manual' && !body.bank_id) throw new HttpError(400, 'برای اعلام واریز دستی، حساب بانکی باید انتخاب شود')
  const w = {
    id: nextId(d, 'wallet'),
    no: E.nextNumberLocal(d, 'wallet', body.wdate, { wallet: 'WLT' }),
    wdate: body.wdate, member_id: mid, type: 'charge', amount,
    method, gateway: method === 'gateway' ? 'melli' : null,
    bank_id: body.bank_id ?? null, tracking_no: body.tracking_no || '',
    gateway_ref: '', note: body.note || (method === 'gateway' ? 'شارژ کیف پول از درگاه بانک ملی' : 'اعلام شارژ کیف پول — واریز دستی'),
    purpose: body.commitment_id ? 'commitment' : null,
    commitment_id: body.commitment_id ? Number(body.commitment_id) : null,
    status: 'pending', approved_by: '', voucher_id: null,
    created_by: u.username, created_at: new Date().toISOString(),
  }
  d.wallet.push(w)
  log(d, u, 'create', 'wallet', w.id, { no: w.no, amount, method })
  commit()
  const out = walletPub(d, w)
  if (method === 'gateway') {
    // نقطه اتصال به وب‌سرویس بانک ملی — در نسخه سرور، url واقعی درگاه برگردانده می‌شود
    out.gateway_url = `#/gateway?tx=${w.id}`
    out.gateway_mode = 'simulator'
  }
  return out
})

route('GET', /^\/api\/wallet\/tx\/(\d+)$/, ({ match }) => {
  const u = require()
  const d = db()
  const w = d.wallet.find(x => x.id === Number(match[1]))
  if (!w) throw new HttpError(404, 'تراکنش کیف پول یافت نشد')
  if (u.role === 'member' && w.member_id !== u.member_id) throw new HttpError(403, 'فقط تراکنش‌های خودتان قابل مشاهده است')
  const m = d.members.find(m => m.id === w.member_id)
  return {
    ...walletPub(d, w),
    merchant: d.settings.company_name,
    order_no: w.no,
    gateway_label: 'بانک ملی ایران — درگاه پرداخت اینترنتی',
  }
})

// تأیید/رد شارژ دستی توسط مدیر مالی
route('POST', /^\/api\/wallet\/charges\/(\d+)\/approve$/, ({ body, match }) => {
  const user = require(['finance', 'admin'])
  const d = db()
  const w = d.wallet.find(x => x.id === Number(match[1]))
  if (!w) throw new HttpError(404, 'تراکنش کیف پول یافت نشد')
  if (w.status !== 'pending') throw new HttpError(400, 'این تراکنش در جریان بررسی است')
  if (body.decision === 'reject') {
    w.status = 'rejected'
    w.approved_by = user.username
    w.note += ` — رد توسط ${user.username}: ${body.note || ''}`
    log(d, user, 'reject', 'wallet', w.id, { no: w.no })
    commit()
    return { ok: true, status: 'rejected' }
  }
  if (w.type !== 'charge') throw new HttpError(400, 'فقط شارژ قابل تأیید است')
  w.status = 'approved'
  w.approved_by = user.username
  const cr = postWalletCharge(d, w, user)
  log(d, user, 'approve', 'wallet', w.id, { no: w.no, amount: w.amount, voucher: w.voucher_id })
  commit()
  return { ok: true, status: 'approved', balance: E.walletBalance(d, w.member_id), credit_id: cr.id, voucher_id: w.voucher_id }
})

// تسویه تعهدات از کیف پول — تا سقف موجودی، تعهدهای باز به ترتیب مصوبه
route('POST', '/api/wallet/settle', ({ body }) => {
  const u = require()
  const d = db()
  const mid = u.role === 'member' ? u.member_id : Number(body.member_id)
  if (!mid) throw new HttpError(400, 'عضو باید مشخص شود')
  const balance = E.walletBalance(d, mid)
  if (balance <= 0) throw new HttpError(400, 'موجودی کیف پول برای تسویه صفر است')
  const open = d.commitments
    .filter(c => c.member_id === mid)
    .filter(c => d.funding.find(f => f.id === c.funding_id)?.status === 'approved')
    .sort((a, b) => a.id - b.id)
  let left = body.amount ? Math.min(Number(body.amount), balance) : balance
  if (left <= 0) throw new HttpError(400, 'مبلغ تسویه نامعتبر است')
  const today = todayIso()
  const w = {
    id: nextId(d, 'wallet'),
    no: E.nextNumberLocal(d, 'wallet', today, { wallet: 'WLT' }),
    wdate: today, member_id: mid, type: 'settle', amount: left,
    method: 'wallet', gateway: null, bank_id: null, tracking_no: '',
    gateway_ref: '', note: 'تسویه تعهدات مصوب از موجودی کیف پول',
    purpose: null, commitment_id: null, status: 'approved',
    approved_by: u.username, voucher_id: null, created_by: u.username,
    created_at: new Date().toISOString(),
  }
  d.wallet.push(w)
  let allocatedTotal = 0
  for (const c of open) {
    if (left <= 0) break
    const remaining = Math.max(c.amount - E.commitmentPaid(d, c), 0)
    if (remaining <= 0) continue
    const take = Math.min(left, remaining)
    const walletCredit = d.credits.find(cr => cr.member_id === mid && cr.remaining > 0 && cr.note?.startsWith('شارژ کیف پول'))
    if (!walletCredit) break
    d.allocations.push({
      id: nextId(d, 'allocations'), commitment_id: c.id,
      payment_id: null, credit_id: walletCredit.id, amount: take,
      created_at: new Date().toISOString(),
    })
    walletCredit.remaining -= take
    left -= take
    allocatedTotal += take
  }
  if (allocatedTotal <= 0) {
    d.wallet = d.wallet.filter(x => x.id !== w.id)
    throw new HttpError(400, 'تعهد باز قابل تسویه یافت نشد')
  }
  w.amount = allocatedTotal
  log(d, u, 'settle', 'wallet', w.id, { no: w.no, amount: allocatedTotal })
  commit()
  return { ok: true, allocated: allocatedTotal, balance: E.walletBalance(d, mid), tx: walletPub(d, w) }
})

// بازگشت از درگاه بانک ملی — نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس اعمال می‌شود
route('POST', '/api/wallet/gateway/verify', ({ body }) => {
  const u = require()
  const d = db()
  const w = d.wallet.find(x => x.id === Number(body.tx_id))
  if (!w) throw new HttpError(404, 'تراکنش کیف پول یافت نشد')
  if (u.role === 'member' && w.member_id !== u.member_id) throw new HttpError(403, 'دسترسی مجاز نیست')
  if (w.status !== 'pending') throw new HttpError(400, 'این تراکنش قبلاً نتیجه‌گیری شده است')
  if (w.method !== 'gateway') throw new HttpError(400, 'این تراکنش از طریق درگاه آغاز نشده است')
  if (body.result !== 'ok') {
    w.status = body.result === 'cancel' ? 'rejected' : 'failed'
    w.note += body.result === 'cancel' ? ' — انصراف کاربر از پرداخت' : ' — پرداخت ناموفق در بانک'
    log(d, u, 'update', 'wallet', w.id, { no: w.no, result: body.result })
    commit()
    return { ok: false, status: w.status, message: w.status === 'rejected' ? 'پرداخت لغو شد' : 'پرداخت ناموفق بود' }
  }
  if (!body.ref) throw new HttpError(400, 'شماره مرجع بانکی برای تأیید الزامی است')
  // در استقرار واقعی: اینجا Verify وب‌سرویس بانک ملی (مطابقت مبلغ و توکن) فراخوانی می‌شود
  w.status = 'approved'
  w.gateway_ref = body.ref
  w.approved_by = 'gateway-melli'
  w.approved_at = new Date().toISOString()
  const cr = postWalletCharge(d, w, u)
  let allocated = 0
  if (w.commitment_id) {
    // پرداخت مستقیم هزینه/تعهد از کارتابل: بلافاصله از کیف پول به تعهد تخصیص می‌یابد
    const target = d.commitments.find(c => c.id === w.commitment_id)
    if (target) {
      allocated = allocateCreditToCommitment(d, cr, target.id, u)
      if (allocated > 0) {
        const today = todayIso()
        const s = {
          id: nextId(d, 'wallet'),
          no: E.nextNumberLocal(d, 'wallet', today, { wallet: 'WLT' }),
          wdate: today, member_id: w.member_id, type: 'settle', amount: allocated,
          method: 'wallet', gateway: null, bank_id: null, tracking_no: '',
          gateway_ref: body.ref, note: `تسویه تعهد مصوبه با شارژ ${w.no} — پرداخت آنلاین بانک ملی`,
          purpose: null, commitment_id: target.id, status: 'approved',
          approved_by: u.username, voucher_id: null, created_by: u.username,
          created_at: new Date().toISOString(),
        }
        d.wallet.push(s)
      }
    }
  }
  log(d, u, 'approve', 'wallet', w.id, { no: w.no, amount: w.amount, ref: body.ref, allocated })
  commit()
  return {
    ok: true, status: 'approved', ref: body.ref, amount: w.amount,
    allocated, balance: E.walletBalance(d, w.member_id),
    message: allocated > 0
      ? `پرداخت موفق — مبلغ به تعهد مصوب تخصیص یافت (${allocated.toLocaleString('fa-IR')} ریال)`
      : 'شارژ کیف پول با موفقیت انجام شد',
  }
})

// vouchers
route('GET', '/api/vouchers', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  let rows = [...db().vouchers].sort((a, b) => b.id - a.id)
  const q = query || {}
  if (q.status) rows = rows.filter(v => v.status === q.status)
  if (q.source_type) rows = rows.filter(v => v.source_type === q.source_type)
  if (q.date_from) rows = rows.filter(v => v.vdate >= q.date_from)
  if (q.date_to) rows = rows.filter(v => v.vdate <= q.date_to)
  if (q.no) rows = rows.filter(v => v.no.toLowerCase().includes(q.no.toLowerCase()))
  return rows.map(v => voucherPub(db(), v))
})
route('POST', '/api/vouchers', ({ body }) => {
  guardPeriod()
  const user = require(['finance', 'accountant', 'admin'])
  const v = E.postVoucher(db(), {
    vdate: body.date, description: body.description,
    lines: body.lines, sourceType: 'manual', idemKey: null, user,
    confirm: body.status === 'confirmed',
  })
  commit()
  return voucherPub(db(), v)
})
route('GET', /^\/api\/vouchers\/(\d+)$/, ({ match }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  const v = db().vouchers.find(x => x.id === Number(match[1]))
  if (!v) throw new HttpError(404, 'سند یافت نشد')
  return voucherPub(db(), v)
})
route('POST', /^\/api\/vouchers\/(\d+)\/confirm$/, ({ match }) => {
  guardPeriod()
  const user = require(['finance', 'admin'])
  const v = db().vouchers.find(x => x.id === Number(match[1]))
  if (!v) throw new HttpError(404, 'سند یافت نشد')
  E.confirmVoucher(db(), v, user)
  commit()
  return voucherPub(db(), v)
})
route('POST', /^\/api\/vouchers\/(\d+)\/reverse$/, ({ body, match }) => {
  guardPeriod()
  const user = require(['finance', 'admin'])
  const v = db().vouchers.find(x => x.id === Number(match[1]))
  if (!v) throw new HttpError(404, 'سند یافت نشد')
  const rv = E.reverseVoucher(db(), v, user, body.reason || '')
  commit()
  return voucherPub(db(), rv)
})

// reports
route('GET', '/api/reports/journal', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  const q = query || {}
  return E.journalRows(db(), q.date_from || null, q.date_to || null, q)
})
route('GET', '/api/reports/general', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.generalLedger(db(), query?.date_from || null, query?.date_to || null)
})
route('GET', /^\/api\/reports\/moin\/(\w+)$/, ({ match, query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.moinLedger(db(), match[1], query?.date_from || null, query?.date_to || null)
})
route('GET', /^\/api\/reports\/tafsil\/(\d+)$/, ({ match, query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.tafsilLedger(db(), Number(match[1]), query?.date_from || null, query?.date_to || null)
})
route('GET', '/api/reports/trial-balance', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.trialBalance(db(), query?.date_from || null, query?.date_to || null)
})
route('GET', '/api/reports/pnl', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  const p = E.pnl(db(), query?.date_from || null, query?.date_to || null)
  return { ...p, profit: p.total_revenue - p.total_expense }
})
route('GET', '/api/reports/balance-sheet', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.balanceSheet(db(), query?.as_of || null)
})
route('GET', '/api/reports/member-settlement', () => {
  const u = require()
  const d = db()
  if (u.role === 'member') return [E.memberStatement(d, u.member_id)]
  return d.members.filter(m => m.is_active).map(m => E.memberStatement(d, m.id))
})

// دریل‌داون هزینه‌ها — سه سطح: دسته ← پروژه ← اسناد
route('GET', '/api/reports/expense-drill', ({ query }) => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  const d = db()
  const q = query || {}
  const month = q.month || null
  let rows = []
  for (const { l, v } of E._baseRowsPublic(d, null, null)) {
    if (l.debit <= 0) continue
    const code = l.account_code
    if (!(code.startsWith('5') || code === '1301')) continue
    if (month) {
      const [jy, jm] = isoToJalali(v.vdate)
      if (month !== `${jy}-${String(jm).padStart(2, '0')}`) continue
    }
    rows.push({ l, v })
  }
  const level = Number(q.level || 1)
  if (level === 1) {
    const byCat = {}
    for (const { l } of rows) {
      const col = l.account_code === '1301' ? '1301' : l.account_code.slice(0, 4)
      byCat[col] = (byCat[col] || 0) + l.debit
    }
    return {
      scope: 'category',
      rows: Object.entries(byCat).map(([code, amount]) => ({ key: code, label: E.accName(d, code), amount }))
        .sort((a, b) => b.amount - a.amount),
      total: Object.values(byCat).reduce((s, x) => s + x, 0),
    }
  }
  const cat = q.cat || ''
  rows = rows.filter(({ l }) => (l.account_code === '1301' ? '1301' : l.account_code.slice(0, 4)) === cat)
  if (level === 2) {
    const byProj = {}
    for (const { l } of rows) {
      const key = l.project_id || 0
      byProj[key] = (byProj[key] || 0) + l.debit
    }
    return {
      scope: 'project', cat,
      rows: Object.entries(byProj).map(([pid, amount]) => ({
        key: Number(pid),
        label: Number(pid) ? (d.projects.find(p => p.id === Number(pid))?.name || 'پروژه') : 'بدون پروژه',
        amount,
      })).sort((a, b) => b.amount - a.amount),
      total: rows.reduce((s, { l }) => s + l.debit, 0),
    }
  }
  const proj = Number(q.project || -1)
  rows = rows.filter(({ l }) => (l.project_id || 0) === proj)
  rows.sort((a, b) => b.v.vdate.localeCompare(a.v.vdate))
  return {
    scope: 'rows', cat, project: proj,
    rows: rows.map(({ l, v }) => ({
      voucher_no: v.no, voucher_id: v.id, date: v.vdate,
      desc: l.description || v.description, account: E.accName(d, l.account_code),
      amount: l.debit,
    })),
    total: rows.reduce((s, { l }) => s + l.debit, 0),
  }
})

// dashboard / analytics / audit
route('GET', '/api/dashboard', () => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return buildDashboard(db())
})
// دستیار هوشمند — برای همه نقش‌ها، متناسب با نقش و ماتریس سطح دسترسی
route('GET', '/api/assistant', () => {
  const u = require([])
  return buildOverview(db(), u)
})
route('POST', '/api/assistant/ask', ({ body }) => {
  const u = require([])
  return askAssistant(db(), u, body?.question || '')
})
route('GET', '/api/analytics', () => {
  require(['admin', 'finance', 'accountant', 'ceo', 'auditor'])
  return E.runAnalytics(db())
})
route('GET', '/api/audit', ({ query }) => {
  require(['admin', 'finance', 'auditor'])
  let rows = db().audit
  if (query?.entity) rows = rows.filter(a => a.entity === query.entity)
  if (query?.username) rows = rows.filter(a => a.username.includes(query.username))
  return rows.slice(0, 500).map(auditPub)
})

// ---------- داشبورد ----------

function buildDashboard (d) {
  const s = d.settings
  const cash = E.cashBalance(d)
  const pnlYear = E.pnl(d, s.fiscal_start, s.fiscal_end)
  const fundings = d.funding.filter(f => f.status === 'approved')
  const approvedAmount = fundings.reduce((s2, f) => s2 + f.amount, 0)
  let collected = 0
  let commitmentsRemaining = 0
  for (const f of fundings) {
    for (const c of d.commitments.filter(c => c.funding_id === f.id)) {
      const paid = E.commitmentPaid(d, c)
      collected += paid
      commitmentsRemaining += Math.max(c.amount - paid, 0)
    }
  }
  const unpaid = d.expenses
    .filter(e => e.appr_status === 'approved' && e.payer_type === 'company')
    .reduce((s2, e) => s2 + (e.total_amount - e.paid_amount), 0)
  const members = d.members.filter(m => m.is_active).map(m => {
    const comms = d.commitments.filter(c => {
      if (c.member_id !== m.id) return false
      return d.funding.find(f => f.id === c.funding_id)?.status === 'approved'
    })
    const total = comms.reduce((s2, c) => s2 + c.amount, 0)
    const paid = comms.reduce((s2, c) => s2 + E.commitmentPaid(d, c), 0)
    const shares = d.shares.filter(sh => sh.member_id === m.id)
    return {
      id: m.id, name: m.full_name,
      share_bp: shares.length ? shares[shares.length - 1].percent_bp : 0,
      commitment: total, paid, remaining: Math.max(total - paid, 0),
    }
  })
  const series = {}
  for (const { l, v } of E._baseRowsPublic(d, null, null)) {
    const [jy, jm] = isoToJalali(v.vdate)
    const key = `${jy}-${String(jm).padStart(2, '0')}`
    series[key] ??= { income: 0, expense: 0 }
    if (l.account_code.startsWith('4')) series[key].income += l.credit - l.debit
    else if (l.account_code.startsWith('5')) series[key].expense += l.debit - l.credit
  }
  const monthly = Object.keys(series).sort().slice(-6).map(mk => ({ month: mk, ...series[mk] }))
  const byCat = {}
  for (const { l } of E._baseRowsPublic(d, s.fiscal_start, s.fiscal_end)) {
    if (l.account_code.startsWith('5') && l.debit > 0) {
      const name = E.accName(d, l.account_code)
      byCat[name] ??= { code: name, name, amount: 0 }
      byCat[name].amount += l.debit
    }
  }
  const categories = Object.values(byCat).sort((a, b) => b.amount - a.amount).slice(0, 7)
  const byProject = {}
  for (const { l } of E._baseRowsPublic(d, s.fiscal_start, s.fiscal_end)) {
    if (l.debit > 0 && l.project_id) {
      const name = d.projects.find(p => p.id === l.project_id)?.name || 'بدون پروژه'
      byProject[name] = (byProject[name] || 0) + l.debit
    }
  }
  const projects = Object.entries(byProject).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  const fundingList = fundings.map(f => {
    let fCollected = 0
    for (const c of d.commitments.filter(c => c.funding_id === f.id)) fCollected += E.commitmentPaid(d, c)
    return {
      id: f.id, no: f.no, title: f.title, amount: f.amount, collected: fCollected,
      remaining: Math.max(f.amount - fCollected, 0),
      progress: f.amount ? Math.floor(fCollected * 100 / f.amount) : 0, due_date: f.due_date || '',
    }
  }).sort((a, b) => b.id - a.id)
  const svcRows = d.services
  const alerts = E.runAnalytics(d).filter(a => ['due', 'cash_forecast'].includes(a.type)).slice(0, 4)
  return {
    cash_total: Object.values(cash).reduce((s2, x) => s2 + x, 0),
    cash_detail: Object.entries(cash).map(([code, amount]) => ({ code, amount })),
    pnl_year: { ...pnlYear, profit: pnlYear.total_revenue - pnlYear.total_expense },
    funding: { approved_amount: approvedAmount, collected, remaining: commitmentsRemaining },
    fundings: fundingList,
    services: {
      pending_count: svcRows.filter(s => ['draft', 'pending'].includes(s.status)).length,
      pending_amount: svcRows.filter(s => ['draft', 'pending'].includes(s.status)).reduce((s2, x) => s2 + x.amount, 0),
      compensated_amount: svcRows.filter(s => s.status === 'compensated').reduce((s2, x) => s2 + x.amount, 0),
    },
    unpaid_expenses: unpaid,
    members, monthly, categories, projects, alerts,
    recent_activity: d.audit.slice(0, 10),
    fiscal: { label: s.fiscal_label, start: s.fiscal_start, end: s.fiscal_end, closed: s.period_closed },
    today_jalali: currentJYear(),
  }
}

// ---------- اجرا ----------

export function localCall (method, path, body = null, query = null) {
  const key = `${method} ${path}`
  let fn = routes[key]
  let match = null
  if (!fn) {
    for (const [k, f] of Object.entries(routes)) {
      const [m, p] = k.split(' ')
      if (m !== method || !regexRoutes.has(k)) continue
      match = path.match(new RegExp(`^(?:${p})$`))
      if (match) { fn = f; break }
    }
  }
  if (!fn) throw new HttpError(404, `مسیر یافت نشد: ${method} ${path}`)
  const result = fn({ body, query, match: match || [], path })
  return result === undefined ? { ok: true } : result
}

export function resetDB () {
  _db = emptyDB()
  seedDemo(_db)
  _db.meta.scenario = 3
  saveDB(_db)
}
export function importDB (json) {
  _db = typeof json === 'string' ? JSON.parse(json) : json
  if (!_db.settings) throw new HttpError(400, 'فایل پشتیبان معتبر نیست')
  _db = migrateDB(_db)
  saveDB(_db)
}
export function exportDB () {
  db()
  return JSON.parse(JSON.stringify(_db))
}
