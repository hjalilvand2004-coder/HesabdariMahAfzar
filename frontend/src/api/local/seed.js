// داده نمونه اولیه نسخه پرتیبل — همان سناریوی بک‌اند؛ مبالغ ریال
import { hashPassword } from '../../lib/sha256.js'
import { jalaliToIso, fiscalYearRange } from '../../lib/jalali.js'
import { nextId, log } from './store.js'
import { DEFAULT_ROLE_PERMS } from '../../lib/format.js'
import * as E from './engine.js'

const T = 10 // نوشتن به تومان × ۱۰ = ریال

const ACCOUNTS = [
  ['1', 'دارایی‌ها', 'group', null, 'asset', 'debit'],
  ['2', 'بدهی‌ها', 'group', null, 'liability', 'credit'],
  ['3', 'حقوق مالکانه', 'group', null, 'equity', 'credit'],
  ['4', 'درآمدها', 'group', null, 'income', 'credit'],
  ['5', 'هزینه‌ها', 'group', null, 'expense', 'debit'],
  ['1101', 'صندوق', 'col', '1', 'asset', 'debit'],
  ['1102', 'بانک‌ها', 'col', '1', 'asset', 'debit'],
  ['11021', 'بانک ملت — جاری شرکت', 'moin', '1102', 'asset', 'debit'],
  ['1103', 'حساب‌های دریافتنی از اعضا', 'col', '1', 'asset', 'debit'],
  ['1201', 'پیش‌پرداخت‌ها و سپرده‌ها', 'col', '1', 'asset', 'debit'],
  ['1301', 'دارایی‌های ثابت — تجهیزات', 'col', '1', 'asset', 'debit'],
  ['2101', 'حساب‌های پرداختنی تجاری', 'col', '2', 'liability', 'credit'],
  ['2102', 'جاری شرکا و اعضا', 'col', '2', 'liability', 'credit'],
  ['2103', 'وام‌های دریافتی از اعضا', 'col', '2', 'liability', 'credit'],
  ['2104', 'ودیعه‌ها و سایر پرداختنی‌ها', 'col', '2', 'liability', 'credit'],
  ['3101', 'سرمایه', 'col', '3', 'equity', 'credit'],
  ['3102', 'سود انباشته', 'col', '3', 'equity', 'credit'],
  ['4101', 'درآمد ارائه خدمات و فروش', 'col', '4', 'income', 'credit'],
  ['4102', 'سایر درآمدها', 'col', '4', 'income', 'credit'],
  ['5101', 'هزینه پرسنلی', 'col', '5', 'expense', 'debit'],
  ['51011', 'حقوق و دستمزد', 'moin', '5101', 'expense', 'debit'],
  ['51012', 'بیمه و عوارض پرسنلی', 'moin', '5101', 'expense', 'debit'],
  ['5102', 'هزینه اجاره', 'col', '5', 'expense', 'debit'],
  ['51021', 'اجاره دفتر مرکزی', 'moin', '5102', 'expense', 'debit'],
  ['5103', 'تجهیزات و ملزومات', 'col', '5', 'expense', 'debit'],
  ['51031', 'تجهیزات اداری', 'moin', '5103', 'expense', 'debit'],
  ['51032', 'ملزومات مصرفی', 'moin', '5103', 'expense', 'debit'],
  ['5104', 'خدمات و مشاوره', 'col', '5', 'expense', 'debit'],
  ['51041', 'خدمات فنی و نرم‌افزاری', 'moin', '5104', 'expense', 'debit'],
  ['51042', 'خدمات اعضا و جبران خدمات', 'moin', '5104', 'expense', 'debit'],
  ['5105', 'هزینه حمل‌ونقل', 'col', '5', 'expense', 'debit'],
  ['5106', 'تبلیغات و بازاریابی', 'col', '5', 'expense', 'debit'],
  ['5107', 'ارتباطات و انرژی', 'col', '5', 'expense', 'debit'],
  ['51071', 'اینترنت و ارتباطات', 'moin', '5107', 'expense', 'debit'],
  ['51072', 'آب، برق و گاز', 'moin', '5107', 'expense', 'debit'],
  ['5108', 'بیمه و مالیات و عوارض', 'col', '5', 'expense', 'debit'],
  ['5109', 'سایر هزینه‌های عملیاتی', 'col', '5', 'expense', 'debit'],
]

const JMONTH = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']

export function seedDemo (db) {
  const [fs, fe] = fiscalYearRange(1405)
  db.settings = {
    id: 1, company_name: 'شرکت توسعه فناوری پارس‌داده', company_national_id: '14009876543',
    currency_display: 'toman', member_sees_all_expenses: false, auto_offset: true,
    fiscal_label: '1405', fiscal_start: fs, fiscal_end: fe,
    period_closed: false, secret: 'portable-' + Math.random().toString(36).slice(2),
    base_share_date: '2025-03-21',
    role_perms: JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS)),
  }
  db.counters = {}
  let uid = 1
  for (const [u, name, role] of [
    ['admin', 'مدیر سامانه', 'admin'], ['finance', 'هما صفایی', 'finance'],
    ['acc', 'امیر توکلی', 'accountant'], ['ceo', 'دکتر بهرام نادری', 'ceo'],
    ['audit', 'شرکت حسابرسی راهبر', 'auditor'],
  ]) {
    db.users.push({ id: uid++, username: u, pw_hash: hashPassword('123456'), full_name: name, role, member_id: null, pin_hash: null, is_active: true })
  }
  const memberIds = {}
  const membersData = [
    ['M-1001', 'علی محمدی', 'person', '0076543210', '۰۹۱۲۱۲۳۴۵۶۷', 'ali@parsdadeh.ir', 'ملت ۳۳۲۱۱۰۹۸۷۶', 5000],
    ['M-1002', 'سارا احمدی', 'person', '0045678912', '۰۹۳۵۱۱۲۲۳۳۴', 'sara@parsdadeh.ir', 'سامان ۰۴۵۶۷۸۹۰۱۲۳', 3000],
    ['M-1003', 'رضا کریمی', 'legal', '14001234567', '۰۹۱۹۷۷۷۸۸۹۹', 'reza@karimi-co.ir', 'تجارت ۲۱۵۵۴۴۳۳۲۲', 2000],
    ['M-1004', 'مینا رضایی', 'person', '0067891234', '۰۹۳۳۵۵۵۱۲۳۴', 'mina@parsdadeh.ir', '', 0],
  ]
  let mid = 1
  for (const [code, name, kind, nid, phone, email, bank, bp] of membersData) {
    memberIds[code] = mid
    db.members.push({ id: mid, code, full_name: name, kind, national_id: nid, phone, email, bank_account: bank, note: '', is_active: true, created_at: new Date().toISOString() })
    db.tafsils.push({ id: nextId(db, 'tafsils'), ttype: 'member', name, ref_id: mid })
    if (bp) db.shares.push({ id: nextId(db, 'shares'), member_id: mid, percent_bp: bp, from_date: '2025-03-21', to_date: null, doc_ref: 'صورتجلسه مجمع ۱۴۰۳', note: '' })
    mid++
  }
  for (const [u, name, code] of [['ali', 'علی محمدی (عضو)', 'M-1001'], ['sara', 'سارا احمدی (عضو)', 'M-1002'], ['reza', 'رضا کریمی (عضو)', 'M-1003']]) {
    db.users.push({ id: uid++, username: u, pw_hash: hashPassword('123456'), full_name: name, role: 'member', member_id: memberIds[code], pin_hash: null, is_active: true })
  }
  db.banks.push({ id: 1, name: 'بانک ملت — جاری شرکت', bank_name: 'ملت', account_no: '3321109876', kind: 'bank', is_active: true })
  db.banks.push({ id: 2, name: 'صندوق شرکت', bank_name: '', account_no: '', kind: 'cash', is_active: true })
  db.tafsils.push({ id: nextId(db, 'tafsils'), ttype: 'bank', name: 'بانک ملت — جاری شرکت', ref_id: 1 })
  db.tafsils.push({ id: nextId(db, 'tafsils'), ttype: 'bank', name: 'صندوق شرکت', ref_id: 2 })
  for (const name of ['پلتفرم فروش آنلاین', 'سامانه داخلی', 'عمومی']) {
    db.projects.push({ id: nextId(db, 'projects'), name, is_active: true })
  }
  for (const [code, name, level, parent, t, nat] of ACCOUNTS) {
    db.accounts.push({ id: nextId(db, 'accounts'), code, name, level, parent_code: parent, acc_type: t, nature: nat, is_active: true })
  }

  const sys = { username: 'system' }
  let idx = 0
  const addExp = (kw) => {
    idx++
    const e = {
      id: nextId(db, 'expenses'), no: `H-1405-${String(idx).padStart(4, '0')}`,
      exp_date: kw.exp_date, entry_date: kw.exp_date,
      title: kw.title, description: kw.description || '',
      base_amount: kw.base_amount || 0, tax_amount: kw.tax_amount || 0,
      total_amount: (kw.base_amount || 0) + (kw.tax_amount || 0),
      party_name: kw.party_name || '', category_code: kw.category_code || '51091',
      project_id: kw.project_id ?? 3, payer_type: kw.payer_type || 'company',
      payer_member_id: kw.payer_member_id ?? null,
      paid_via: kw.paid_via || 'bank', bank_id: kw.bank_id ?? 1,
      pay_status: kw.pay_status || 'unpaid', paid_amount: 0,
      appr_status: kw.appr_status || 'draft', invoice_no: kw.invoice_no || '',
      asset_kind: kw.asset_kind || 'expense', note: kw.note || '',
      created_by: 'acc', approved_by: kw.approved_by || '',
      approved_at: null, created_at: new Date().toISOString(),
    }
    db.expenses.push(e)
    return e
  }
  // اجاره دفتر اردیبهشت تا آبان
  for (let jm = 2; jm <= 8; jm++) {
    addExp({ exp_date: jalaliToIso(1405, jm, 10), title: `اجاره دفتر مرکزی — ماه ${JMONTH[jm - 1]}`, description: 'قرارداد اجاره سالانه دفتر مرکزی، اقساط ماهانه', base_amount: 60_000_000 * T, party_name: 'ملکیت آریا', category_code: '51021', project_id: 3, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo', invoice_no: `RENT-1405${String(jm).padStart(2, '0')}` })
  }
  // حقوق پرسنلی تیر/مرداد/شهریور
  for (const jm of [4, 5, 6]) {
    addExp({ exp_date: jalaliToIso(1405, jm, 28), title: `حقوق و دستمزد کارکنان — ${JMONTH[jm - 1]}`, description: 'حقوق ثابت، مزایا و بیمه سهم شرکت', base_amount: 45_000_000 * T, party_name: 'پرسنل شرکت', category_code: '51011', project_id: 3, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo' })
  }
  addExp({ exp_date: jalaliToIso(1405, 6, 5), title: 'خرید تجهیزات سرور و ایستگاه کاری', description: '۲ سرور و ۳ ایستگاه کاری — خرید نسیه، اقساط به فروشنده', base_amount: 85_000_000 * T, tax_amount: 8_500_000 * T, party_name: 'فروشگاه تجهیزات پیشتاز', category_code: '1301', asset_kind: 'asset', project_id: 1, pay_status: 'unpaid', appr_status: 'approved', approved_by: 'ceo', invoice_no: 'INV-4521' })
  addExp({ exp_date: jalaliToIso(1405, 7, 12), title: 'توسعه ماژول درگاه پرداخت', description: 'پرداخت مستقیم از حساب شخصی عضو توسط رضا کریمی', base_amount: 38_000_000 * T, party_name: 'استودیو داده‌پرداز', category_code: '51041', project_id: 1, payer_type: 'member', payer_member_id: memberIds['M-1003'], pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo', invoice_no: 'DP-9123' })
  addExp({ exp_date: jalaliToIso(1405, 7, 20), title: 'کمپین تبلیغات دیجیتال مهر', description: 'تبلیغات شبکه‌های اجتماعی و گوگل', base_amount: 22_000_000 * T, party_name: 'آژانس دیجیتال مارکتینگ گستر', category_code: '5106', project_id: 1, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo' })
  addExp({ exp_date: jalaliToIso(1405, 7, 25), title: 'هزینه حمل‌ونقل و پیک مهر', description: 'ارسال مرسولات و پیک', base_amount: 7_500_000 * T, party_name: 'سرویس پیک سریع‌رسان', category_code: '5105', project_id: 3, paid_via: 'cash', bank_id: 2, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo' })
  for (const jm of [5, 6, 7]) {
    addExp({ exp_date: jalaliToIso(1405, jm, 15), title: `اینترنت و ارتباطات — ${JMONTH[jm - 1]}`, base_amount: 4_500_000 * T, party_name: 'شرکت ارتباطات نگارنپا', category_code: '51071', project_id: 3, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo' })
  }
  addExp({ exp_date: jalaliToIso(1405, 6, 30), title: 'آب، برق و گاز دفتر — مرداد', base_amount: 3_200_000 * T, party_name: 'خدمات شهری', category_code: '51072', project_id: 3, pay_status: 'paid', appr_status: 'approved', approved_by: 'ceo' })
  addExp({ exp_date: jalaliToIso(1405, 8, 20), title: 'خرید ملزومات مصرفی اتاق سرور', base_amount: 3_800_000 * T, party_name: 'فروشگاه تجهیزات پیشتاز', category_code: '51032', project_id: 1, appr_status: 'pending', invoice_no: 'INV-4710' })
  addExp({ exp_date: jalaliToIso(1405, 8, 23), title: 'سفارش طراحی هویت بصری جدید', base_amount: 9_000_000 * T, party_name: 'استودیو داده‌پرداز', category_code: '51041', project_id: 1, appr_status: 'draft' })

  // اسناد همه هزینه‌های تأییدشده با موتور واقعی
  const approved = db.expenses.filter(e => e.appr_status === 'approved')
  for (const e of approved) {
    e.approved_by = 'ceo'
    const drCode = e.asset_kind === 'asset' ? '1301' : e.category_code
    const dr = { account_code: drCode, debit: e.total_amount, description: `${e.no} — ${e.title}`, project_id: e.project_id }
    let lines
    if (e.payer_type === 'member') {
      const m = db.members.find(m => m.id === e.payer_member_id)
      const taf = E.tafsilForMember(db, e.payer_member_id)
      lines = [dr, { account_code: '2102', tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '', credit: e.total_amount, description: `پرداخت ${m?.full_name || ''} از حساب شخصی` }]
    } else if (e.pay_status === 'paid') {
      const acc = e.paid_via === 'cash' ? '1101' : '11021'
      const bt = e.paid_via === 'cash' ? E.tafsilForBank(db, 2) : E.tafsilForBank(db, 1)
      lines = [dr, { account_code: acc, tafsil_id: bt?.id ?? null, tafsil_name: bt?.name || 'صندوق شرکت', credit: e.total_amount, description: 'پرداخت از حساب شرکت' }]
    } else {
      const pt = E.partyTafsil(db, e.party_name)
      lines = [dr, { account_code: '2101', tafsil_id: pt.id, tafsil_name: pt.name, credit: e.total_amount, description: `بدهی به ${pt.name}` }]
    }
    E.postVoucher(db, { vdate: e.exp_date, description: `ثبت هزینه ${e.no} — ${e.title}`, lines, sourceType: 'expense', sourceId: e.id, idemKey: `exp:${e.id}`, user: sys })
    if (e.payer_type === 'member') {
      const cr = { id: nextId(db, 'credits'), member_id: e.payer_member_id, expense_id: e.id, amount: e.total_amount, remaining: e.total_amount, note: `هزینه ${e.no} پرداخت‌شده توسط عضو`, created_at: new Date().toISOString() }
      db.credits.push(cr)
      cr.remaining = E.autoAllocate(db, { memberId: cr.member_id, amount: cr.amount, creditId: cr.id, user: sys })
    }
  }
  // تسویه بخشی از بدهی تجهیزات
  const equip = db.expenses.find(e => e.invoice_no === 'INV-4521')
  {
    const pt = E.partyTafsil(db, equip.party_name)
    const bt = E.tafsilForBank(db, 1)
    const amount = 50_000_000 * T // ۵۰ میلیون تومان از ۹۳.۵ میلیون تومان بدهی
    E.postVoucher(db, {
      vdate: jalaliToIso(1405, 7, 18), description: `تسویه بخشی از بدهی هزینه ${equip.no}`,
      lines: [
        { account_code: '2101', tafsil_id: pt.id, tafsil_name: pt.name, debit: amount, description: `پرداخت به ${pt.name}` },
        { account_code: '11021', tafsil_id: bt.id, tafsil_name: bt.name, credit: amount, description: 'پرداخت از بانک ملت' },
      ],
      sourceType: 'expense_settle', sourceId: equip.id, idemKey: 'seed:settle:1', user: sys,
    })
    equip.paid_amount = amount
    equip.pay_status = 'partial'
  }
  // درآمدها
  const inc = [
    [3, 21, 280_000_000, '4101', 'درآمد پلتفرم فروش — بهار ۱۴۰۵'],
    [5, 18, 190_000_000, '4101', 'درآمد پلتفرم فروش — مرداد ۱۴۰۵'],
    [7, 27, 350_000_000, '4101', 'درآمد پلتفرم فروش — مهر ۱۴۰۵'],
    [8, 15, 120_000_000, '4102', 'درآمد پشتیبانی و آموزش — آبان ۱۴۰۵'],
  ]
  inc.forEach(([jm, jd, amount, code, desc], i) => {
    const bt = E.tafsilForBank(db, 1)
    E.postVoucher(db, {
      vdate: jalaliToIso(1405, jm, jd), description: desc,
      lines: [
        { account_code: '11021', tafsil_id: bt.id, tafsil_name: bt.name, debit: amount * T, description: 'واریز درآمد فروش' },
        { account_code: code, credit: amount * T, description: desc },
      ],
      sourceType: 'seed', idemKey: `seed:inc:${i + 1}`, user: sys,
    })
  })

  // درخواست تأمین مالی
  const f = {
    id: nextId(db, 'funding'), no: 'F-1405-0001', title: 'تأمین مالی فاز نخست پلتفرم فروش آنلاین',
    description: 'مصوبه مجمع فوق‌العاده — تأمین هزینه‌های توسعه پلتفرم تا پایان سال',
    amount: 200_000_000 * T, split_method: 'share',
    percents: {}, fixed_amounts: {},
    member_ids: [memberIds['M-1001'], memberIds['M-1002'], memberIds['M-1003']],
    base_date: '2025-03-21', due_date: jalaliToIso(1405, 10, 1),
    ftype: 'current', doc_ref: 'صورتجلسه ۱۴۰۵/۰۳ مورخ ۱۴۰۵/۰۲/۲۵',
    project_id: 1, status: 'approved', created_by: 'acc', approved_by: 'ceo',
    approved_at: new Date().toISOString(), note: '', created_at: new Date().toISOString(),
  }
  db.funding.push(f)
  const rows = E.calcSplit(db, { amount: f.amount, method: 'share', memberIds: f.member_ids, baseDate: f.base_date })
  for (const r of rows) {
    db.commitments.push({ id: nextId(db, 'commitments'), funding_id: f.id, member_id: r.member_id, share_bp: r.share_bp, amount: r.amount, paid: 0 })
  }
  db.funding.push({
    id: nextId(db, 'funding'), no: 'F-1405-0002', title: 'خرید تجهیزات زیرساخت ابری',
    description: 'درخواست در انتظار تصویب مدیرعامل', amount: 30_000_000 * T,
    split_method: 'equal', percents: {}, fixed_amounts: {},
    member_ids: [memberIds['M-1001'], memberIds['M-1002'], memberIds['M-1003']],
    base_date: '2025-03-21', due_date: jalaliToIso(1405, 11, 1),
    ftype: 'loan', doc_ref: '', project_id: 1, status: 'pending',
    created_by: 'acc', approved_by: '', approved_at: null, note: '', created_at: new Date().toISOString(),
  })

  // پرداخت‌های اعضا
  const addPay = (no, code, amount, jm, jd, status, tracking, fundingId = null, note = '') => {
    const p = {
      id: nextId(db, 'payments'), no, pay_date: jalaliToIso(1405, jm, jd),
      member_id: memberIds[code], amount: amount * T, method: 'transfer', bank_id: 1,
      tracking_no: tracking, receipt_ref: '', funding_id: fundingId, note,
      status, declared_by: 'member', approved_by: status === 'approved' ? 'finance' : '',
      approved_at: null, voucher_id: null, created_at: new Date().toISOString(),
    }
    db.payments.push(p)
    return p
  }
  const p1 = addPay('P-1405-0001', 'M-1001', 100_000_000, 3, 15, 'approved', 'MLT-889201')
  const p2 = addPay('P-1405-0002', 'M-1002', 60_000_000, 4, 20, 'approved', 'Saman-551230')
  const p3 = addPay('P-1405-0003', 'M-1003', 25_000_000, 5, 10, 'approved', 'TEJ-774512')
  addPay('P-1405-0004', 'M-1002', 15_000_000, 8, 20, 'declared', 'Saman-991823', f.id, 'اعلام پرداخت توسط عضو — در انتظار بررسی')
  for (const p of [p1, p2, p3]) {
    postPay(db, p, sys)
    E.autoAllocate(db, { memberId: p.member_id, amount: p.amount, paymentId: p.id, fundingId: f.id, user: sys })
  }

  // خدمات اعضا و جبران خدمات — داده نمونه
  const addService = (no, code, kw) => {
    const s = {
      id: nextId(db, 'services'), no,
      member_id: memberIds[code], sdate: kw.sdate,
      stype: kw.stype || 'other', title: kw.title, description: kw.description || '',
      qty: kw.qty, unit: kw.unit || 'ساعت', unit_price: kw.unit_price,
      amount: kw.qty * kw.unit_price, calc_note: kw.calc_note || '',
      status: kw.status || 'draft', comp_method: kw.comp_method || null,
      comp_date: kw.comp_date || '', comp_note: kw.comp_note || '',
      voucher_id: null, credit_id: null,
      created_by: kw.created_by || 'finance', approved_by: kw.approved_by || '',
      approved_at: kw.approved_at || null, created_at: new Date().toISOString(),
    }
    db.services.push(s)
    return s
  }
  const sv1 = addService('SV-1405-0001', 'M-1003', {
    sdate: jalaliToIso(1405, 6, 12), stype: 'legal', title: 'تنظیم و بازبینی قراردادهای فروشندگان پلتفرم',
    description: 'بررسی حقوقی ۴ قرارداد تأمین‌کننده و پیوست‌های آن',
    qty: 12, unit: 'ساعت', unit_price: 20_000_000, calc_note: '۱۲ ساعت × نرخ توافقی ۲ میلیون تومان بر ساعت (صورتجلسه هیئت‌مدیره ۱۴۰۵/۰۴)',
    status: 'approved', comp_method: 'credit', comp_date: jalaliToIso(1405, 6, 20),
    comp_note: 'جبران از محل اعتبار حساب عضو — تهاتر با تعهد تأمین مالی', approved_by: 'ceo',
    approved_at: new Date().toISOString(),
  })
  addService('SV-1405-0002', 'M-1002', {
    sdate: jalaliToIso(1405, 7, 28), stype: 'accounting', title: 'بستن حساب‌ها و تنظیم گزارش مالی فصل تابستان',
    description: 'طبقه‌بندی اسناد، مغایرت‌گیری بانکی و پیش‌نویس گزارش فصلی',
    qty: 8, unit: 'ساعت', unit_price: 15_000_000, calc_note: '۸ ساعت × نرخ مصوب ۱.۵ میلیون تومان بر ساعت',
    status: 'pending', created_by: 'finance',
  })
  addService('SV-1405-0003', 'M-1001', {
    sdate: jalaliToIso(1405, 8, 10), stype: 'tech', title: 'مشاوره فنی زیرساخت و معماری امنیتی سرورها',
    description: 'طراحی توپولوژی شبکه، سیاست دسترسی و پشتیبان‌گیری',
    qty: 6, unit: 'ساعت', unit_price: 18_000_000, calc_note: '۶ ساعت × نرخ پیشنهادی ۱.۸ میلیون تومان بر ساعت',
    status: 'draft', created_by: 'finance',
  })
  // سند و اعتبار خدمات تأییدشده با موتور واقعی
  {
    const m = db.members.find(m => m.id === sv1.member_id)
    const taf = E.tafsilForMember(db, sv1.member_id)
    const v = E.postVoucher(db, {
      vdate: sv1.comp_date, description: `جبران خدمات ${sv1.no} — ${m?.full_name || ''} (${sv1.title})`,
      lines: [
        { account_code: '51042', debit: sv1.amount, description: `هزینه جبران خدمات عضو — ${sv1.title}`, project_id: 3 },
        { account_code: '2102', tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '', credit: sv1.amount, description: 'اعتبار جبران خدمات به جاری عضو منظور شد' },
      ],
      sourceType: 'service', sourceId: sv1.id, idemKey: `service:${sv1.id}`, user: sys,
    })
    sv1.voucher_id = v.id
    const cr = {
      id: nextId(db, 'credits'), member_id: sv1.member_id, expense_id: null,
      amount: sv1.amount, remaining: sv1.amount,
      note: `جبران خدمات ${sv1.no} — ${sv1.title}`, created_at: new Date().toISOString(),
    }
    db.credits.push(cr)
    sv1.credit_id = cr.id
    cr.remaining = E.autoAllocate(db, { memberId: sv1.member_id, amount: sv1.amount, creditId: cr.id, user: sys })
  }

  // همگام‌سازی شمارنده‌ها
  db.counters['expense:1405'] = idx
  db.counters['funding:1405'] = 2
  db.counters['payment:1405'] = 4
  db.counters['service:1405'] = 3
  db.counters['voucher:1405'] = db.vouchers.length
  log(db, sys, 'seed', 'system', null, { message: 'داده نمونه اولیه ایجاد شد' })
}

function postPay (db, p, user) {
  const m = db.members.find(m => m.id === p.member_id)
  const taf = E.tafsilForMember(db, p.member_id)
  const bt = E.tafsilForBank(db, 1)
  const ftype = p.funding_id ? (db.funding.find(f => f.id === p.funding_id)?.ftype || 'current') : 'current'
  const crCode = { current: '2102', loan: '2103', capital: '3101' }[ftype]
  const crDesc = { current: 'جاری عضو', loan: 'وام عضو به شرکت', capital: 'افزایش سرمایه' }[ftype]
  const v = E.postVoucher(db, {
    vdate: p.pay_date, description: `وصول پرداخت ${p.no} — ${m?.full_name || ''}`,
    lines: [
      { account_code: '11021', tafsil_id: bt.id, tafsil_name: bt.name, debit: p.amount, description: `وصول ${p.no} از ${m?.full_name || ''}` },
      { account_code: crCode, tafsil_id: taf?.id ?? null, tafsil_name: m?.full_name || '', credit: p.amount, description: crDesc },
    ],
    sourceType: 'payment', sourceId: p.id, idemKey: `pay:${p.id}`, user,
  })
  p.voucher_id = v.id
}
