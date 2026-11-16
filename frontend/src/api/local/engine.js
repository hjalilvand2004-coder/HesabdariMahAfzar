// موتور مالی درون‌مرورگری — آینه منطق بک‌اند (تقسیم، سند دوبل، دفاتر، گزارش‌ها، تحلیل)
import { todayIso, isoToJalali } from '../../lib/jalali.js'
import { HttpError, nextId, nextNumber, log } from './store.js'

// دسترسی برای روتر
export function nextNumberLocal (db, entity, dateIso, prefixes) {
  return nextNumber(db, entity, dateIso, prefixes)
}
export function _baseRowsPublic (db, from, to) {
  return baseRows(db, from, to)
}

// ---------- تقسیم مبلغ با کنترل گرد کردن ----------

export function largestRemainder (amount, weights) {
  const totalW = weights.reduce((s, w) => s + w.w, 0)
  if (totalW <= 0) throw new HttpError(400, 'مجموع وزن‌ها باید بزرگ‌تر از صفر باشد')
  const raw = weights.map(w => ({ ...w, exact: amount * w.w / totalW, frac: (amount * w.w / totalW) % 1 }))
  const floors = raw.map(r => ({ id: r.id, v: Math.floor(r.exact) }))
  let remainder = amount - floors.reduce((s, f) => s + f.v, 0)
  const ordered = [...raw].sort((a, b) => (b.frac - a.frac) || (a.id - b.id))
  for (let i = 0; i < remainder; i++) {
    const f = floors.find(x => x.id === ordered[i % ordered.length].id)
    f.v += 1
  }
  const map = Object.fromEntries(floors.map(f => [f.id, f.v]))
  const sum = floors.reduce((s, f) => s + f.v, 0)
  if (sum !== amount) throw new HttpError(400, 'خطای گرد کردن در تقسیم')
  return weights.map(w => map[w.id])
}

export function memberShareBpAt (db, memberId, baseDate) {
  const shares = db.shares.filter(s => s.member_id === memberId).sort((a, b) => a.from_date.localeCompare(b.from_date))
  if (baseDate) {
    const exact = shares.filter(s => s.from_date <= baseDate && (!s.to_date || s.to_date >= baseDate))
    if (exact.length) return exact[exact.length - 1].percent_bp
  }
  return shares.length ? shares[shares.length - 1].percent_bp : 0
}

export function calcSplit (db, { amount, method, memberIds, percents = {}, fixedAmounts = {}, baseDate }) {
  if (amount <= 0) throw new HttpError(400, 'مبلغ باید مثبت باشد')
  if (!memberIds?.length) throw new HttpError(400, 'حداقل یک عضو باید انتخاب شود')
  const rows = []
  if (method === 'fixed') {
    let sum = 0
    for (const mid of memberIds) {
      const v = Number(fixedAmounts[mid] ?? fixedAmounts[String(mid)] ?? 0)
      sum += v
      rows.push({ member_id: mid, share_bp: memberShareBpAt(db, mid, baseDate), amount: v })
    }
    const diff = amount - sum
    if (diff !== 0) throw new HttpError(400, `مجموع مبالغ ثابت با مبلغ مصوب برابر نیست؛ اختلاف: ${diff.toLocaleString('fa-IR')} ریال`)
    return rows
  }
  if (method === 'equal') {
    const amounts = largestRemainder(amount, memberIds.map(id => ({ id, w: 1 })))
    memberIds.forEach((mid, i) => rows.push({ member_id: mid, share_bp: memberShareBpAt(db, mid, baseDate), amount: amounts[i] }))
    return rows
  }
  const weights = memberIds.map(mid => {
    const bp = method === 'custom'
      ? Number(percents[mid] ?? percents[String(mid)] ?? 0)
      : memberShareBpAt(db, mid, baseDate)
    if (bp <= 0) throw new HttpError(400, `درصد سهم عضو «${mid}» برای تاریخ مبنای انتخابی یافت نشد`)
    return { id: mid, w: bp }
  })
  if (method === 'custom' && weights.reduce((s, w) => s + w.w, 0) !== 10000) {
    throw new HttpError(400, 'مجموع درصدهای توافقی باید دقیقاً ۱۰۰٪ باشد')
  }
  const amounts = largestRemainder(amount, weights)
  memberIds.forEach((mid, i) => rows.push({ member_id: mid, share_bp: weights[i].w, amount: amounts[i] }))
  return rows
}

// ---------- حساب‌ها و تفصیلی ----------

export const accName = (db, code) => db.accounts.find(a => a.code === code)?.name || code
export const accType = (db, code) => db.accounts.find(a => a.code === code)?.acc_type || ''

export function tafsilForMember (db, mid) { return db.tafsils.find(t => t.ttype === 'member' && t.ref_id === mid) || null }
export function tafsilForBank (db, bid) { return db.tafsils.find(t => t.ttype === 'bank' && t.ref_id === bid) || null }
export function partyTafsil (db, name) {
  let t = db.tafsils.find(x => x.ttype === 'party' && x.name === name)
  if (!t) {
    t = { id: nextId(db, 'tafsils'), ttype: 'party', name, ref_id: null }
    db.tafsils.push(t)
  }
  return t
}

export function bankCode (db, bankId) {
  if (bankId) {
    const b = db.banks.find(x => x.id === bankId)
    if (!b) return '1101'
    if (b.kind === 'cash') return '1101'
    const moins = db.accounts.filter(a => a.parent_code === '1102').sort((x, y) => x.code.localeCompare(y.code))
    if (moins.length) {
      const idx = moins.length > 1 ? (b.id - 1) % moins.length : 0
      return moins[idx].code
    }
    return '1102'
  }
  return '1101'
}

// ---------- سند حسابداری ----------

function validateLines (db, lines) {
  if (!lines?.length) throw new HttpError(400, 'سند باید حداقل یک ردیف داشته باشد')
  const td = lines.reduce((s, l) => s + (l.debit || 0), 0)
  const tc = lines.reduce((s, l) => s + (l.credit || 0), 0)
  if (td <= 0) throw new HttpError(400, 'مبلغ سند نمی‌تواند صفر باشد')
  if (td !== tc) throw new HttpError(400, `سند نامتوازن است: بدهکار ${td.toLocaleString('fa-IR')} ≠ بستانکار ${tc.toLocaleString('fa-IR')} ریال`)
  for (const l of lines) {
    if ((l.debit || 0) < 0 || (l.credit || 0) < 0) throw new HttpError(400, 'مبالغ منفی مجاز نیست')
    if ((l.debit || 0) > 0 && (l.credit || 0) > 0) throw new HttpError(400, 'یک ردیف نمی‌تواند هم‌زمان بدهکار و بستانکار باشد')
    const acc = db.accounts.find(a => a.code === l.account_code)
    if (!acc) throw new HttpError(400, `کد حساب ${l.account_code} یافت نشد`)
    if (!acc.is_active) throw new HttpError(400, `حساب ${acc.name} غیرفعال است`)
  }
}

export function postVoucher (db, { vdate, description, lines, sourceType = 'manual', sourceId = null, idemKey = null, user, confirm = true }) {
  if (idemKey) {
    const ex = db.vouchers.find(v => v.idem_key === idemKey)
    if (ex) return ex
  }
  validateLines(db, lines)
  const v = {
    id: nextId(db, 'vouchers'),
    no: nextNumber(db, 'voucher', vdate, { voucher: 'V' }),
    vdate, description,
    status: confirm ? 'confirmed' : 'draft',
    source_type: sourceType, source_id: sourceId,
    idem_key: idemKey || '',
    reversal_of: null,
    created_by: user?.username || 'system',
    confirmed_by: confirm ? (user?.username || 'system') : '',
    confirmed_at: confirm ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    lines: lines.map(l => ({
      id: nextId(db, 'vlines'),
      account_code: l.account_code,
      tafsil_id: l.tafsil_id ?? null,
      tafsil_name: l.tafsil_name || '',
      debit: l.debit || 0, credit: l.credit || 0,
      description: l.description || description,
      project_id: l.project_id ?? null,
    })),
  }
  db.vouchers.push(v)
  log(db, user, 'post_voucher', 'voucher', v.id, { no: v.no, debit: v.lines.reduce((s, l) => s + l.debit, 0), source: `${sourceType}:${sourceId}` })
  return v
}

export function confirmVoucher (db, v, user) {
  if (v.status === 'confirmed') throw new HttpError(400, 'سند از قبل قطعی است')
  validateLines(db, v.lines.map(l => ({ account_code: l.account_code, debit: l.debit, credit: l.credit })))
  v.status = 'confirmed'
  v.confirmed_by = user?.username || ''
  v.confirmed_at = new Date().toISOString()
  log(db, user, 'confirm', 'voucher', v.id, { no: v.no })
}

export function reverseVoucher (db, v, user, reason = '') {
  if (v.status !== 'confirmed') throw new HttpError(400, 'فقط سند قطعی قابل ابطال است')
  if (db.vouchers.some(x => x.reversal_of === v.id)) throw new HttpError(400, 'این سند قبلاً ابطال شده است')
  const rv = postVoucher(db, {
    vdate: todayIso(),
    description: `ابطال سند ${v.no}${reason ? ' — ' + reason : ''}`,
    lines: v.lines.map(l => ({ account_code: l.account_code, tafsil_id: l.tafsil_id, tafsil_name: l.tafsil_name, debit: l.credit, credit: l.debit, description: `ابطال سند ${v.no} — ${l.description}` })),
    sourceType: 'reversal', sourceId: v.id, idemKey: `rev:${v.id}`, user,
  })
  rv.reversal_of = v.id
  log(db, user, 'reverse', 'voucher', v.id, { reversal_no: rv.no, reason })
  return rv
}

// ---------- دفاتر ----------

function baseRows (db, from, to) {
  const rows = []
  for (const v of db.vouchers) {
    if (v.status !== 'confirmed') continue
    if (from && v.vdate < from) continue
    if (to && v.vdate > to) continue
    for (const l of v.lines) rows.push({ l, v })
  }
  rows.sort((a, b) => (a.v.vdate.localeCompare(b.v.vdate)) || (a.v.id - b.v.id) || (a.l.id - b.l.id))
  return rows
}

export function journalRows (db, from, to, filters = {}) {
  const out = []
  for (const { l, v } of baseRows(db, from, to)) {
    if (filters.voucher_no && !v.no.toLowerCase().includes(filters.voucher_no.toLowerCase())) continue
    if (filters.account_code && !l.account_code.startsWith(filters.account_code)) continue
    if (filters.tafsil_id && l.tafsil_id !== filters.tafsil_id) continue
    out.push({
      voucher_id: v.id, voucher_no: v.no, date: v.vdate,
      voucher_desc: v.description, line_desc: l.description,
      account_code: l.account_code, account_name: accName(db, l.account_code),
      tafsil: l.tafsil_name, debit: l.debit, credit: l.credit,
      source_type: v.source_type, status: v.status,
    })
  }
  return out
}

function moinBalances (db, from, to) {
  const res = {}
  for (const { l } of baseRows(db, from, to)) {
    res[l.account_code] ??= { debit: 0, credit: 0 }
    res[l.account_code].debit += l.debit
    res[l.account_code].credit += l.credit
  }
  return res
}

export function generalLedger (db, from, to) {
  const moin = moinBalances(db, from, to)
  const agg = {}
  for (const [code, r] of Object.entries(moin)) {
    const col = code.slice(0, 4)
    agg[col] ??= { debit: 0, credit: 0 }
    agg[col].debit += r.debit
    agg[col].credit += r.credit
  }
  return Object.keys(agg).sort().map(col => {
    const acc = db.accounts.find(a => a.code === col)
    const net = agg[col].debit - agg[col].credit
    return {
      code: col, name: acc?.name || col, acc_type: acc?.acc_type || '',
      debit: agg[col].debit, credit: agg[col].credit,
      balance_debit: net > 0 ? net : 0, balance_credit: net < 0 ? -net : 0,
    }
  })
}

export function moinLedger (db, code, from, to) {
  const acc = db.accounts.find(a => a.code === code)
  const nature = acc?.nature || 'debit'
  const rows = []
  let bal = 0
  for (const { l, v } of baseRows(db, from, to)) {
    if (l.account_code !== code && !(code.length === 4 && l.account_code.startsWith(code))) continue
    bal += nature === 'debit' ? (l.debit - l.credit) : (l.credit - l.debit)
    rows.push({
      date: v.vdate, voucher_no: v.no, voucher_desc: v.description, line_desc: l.description,
      tafsil: l.tafsil_name, account_code: l.account_code, account_name: accName(db, l.account_code),
      debit: l.debit, credit: l.credit, balance: bal,
    })
  }
  return rows
}

export function tafsilLedger (db, tid, from, to) {
  const rows = []
  let bal = 0
  for (const { l, v } of baseRows(db, from, to)) {
    if (l.tafsil_id !== tid) continue
    bal += l.debit - l.credit
    rows.push({
      date: v.vdate, voucher_no: v.no, voucher_desc: v.description,
      account_code: l.account_code, account_name: accName(db, l.account_code),
      line_desc: l.description, debit: l.debit, credit: l.credit, balance: bal,
    })
  }
  return rows
}

const dayBefore = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  return dt.toISOString().slice(0, 10)
}

export function trialBalance (db, from, to) {
  const opening = from ? moinBalances(db, null, dayBefore(from)) : {}
  const movement = moinBalances(db, from, to)
  const cols = {}
  for (const [code, r] of Object.entries(opening)) {
    cols[code.slice(0, 4)] ??= { od: 0, oc: 0, md: 0, mc: 0 }
    cols[code.slice(0, 4)].od += r.debit
    cols[code.slice(0, 4)].oc += r.credit
  }
  for (const [code, r] of Object.entries(movement)) {
    cols[code.slice(0, 4)] ??= { od: 0, oc: 0, md: 0, mc: 0 }
    cols[code.slice(0, 4)].md += r.debit
    cols[code.slice(0, 4)].mc += r.credit
  }
  return Object.keys(cols).sort().map(col => {
    const acc = db.accounts.find(a => a.code === col)
    const c = cols[col]
    const o = c.od - c.oc
    const m = c.md - c.mc
    const closing = o + m
    return {
      code: col, name: acc?.name || col, acc_type: acc?.acc_type || '',
      open_debit: c.od, open_credit: c.oc, move_debit: c.md, move_credit: c.mc,
      close_debit: closing > 0 ? closing : 0, close_credit: closing < 0 ? -closing : 0,
    }
  })
}

export function pnl (db, from, to) {
  const gl = Object.fromEntries(generalLedger(db, from, to).map(g => [g.code, g]))
  const revenues = [], expenses = []
  for (const [code, g] of Object.entries(gl)) {
    if (code.startsWith('4')) revenues.push({ code, name: g.name, amount: g.credit - g.debit })
    else if (code.startsWith('5')) expenses.push({ code, name: g.name, amount: g.debit - g.credit })
  }
  return {
    revenues, expenses,
    total_revenue: revenues.reduce((s, r) => s + r.amount, 0),
    total_expense: expenses.reduce((s, e) => s + e.amount, 0),
  }
}

export function pnlProfit (db, from, to) {
  const p = pnl(db, from, to)
  return p.total_revenue - p.total_expense
}

export function balanceSheet (db, asOf) {
  const gl = Object.fromEntries(generalLedger(db, null, asOf).map(g => [g.code, g]))
  const assets = [], liabilities = [], equity = []
  for (const [code, g] of Object.entries(gl)) {
    if (code.startsWith('1')) assets.push({ code, name: g.name, amount: g.balance_debit - g.balance_credit })
    else if (code.startsWith('2')) liabilities.push({ code, name: g.name, amount: g.balance_credit - g.balance_debit })
    else if (code.startsWith('3')) equity.push({ code, name: g.name, amount: g.balance_credit - g.balance_debit })
  }
  const profit = pnlProfit(db, null, asOf)
  const totalAssets = assets.reduce((s, a) => s + a.amount, 0)
  const totalLiab = liabilities.reduce((s, a) => s + a.amount, 0)
  const totalEq = equity.reduce((s, a) => s + a.amount, 0)
  return {
    assets, liabilities, equity,
    total_assets: totalAssets, total_liabilities: totalLiab,
    total_equity: totalEq + profit, profit,
    check: totalAssets - totalLiab - totalEq - profit,
  }
}

export function cashBalance (db) {
  const out = {}
  for (const { l } of baseRows(db, null, null)) {
    if (l.account_code === '1101' || l.account_code.startsWith('1102')) {
      out[l.account_code] = (out[l.account_code] || 0) + l.debit - l.credit
    }
  }
  return out
}

// ---------- تعهدات و تخصیص ----------

export function commitmentPaid (db, c) {
  return db.allocations.filter(a => a.commitment_id === c.id).reduce((s, a) => s + a.amount, 0)
}

export function openCommitments (db, memberId, fundingId = null) {
  return db.commitments
    .filter(c => {
      if (c.member_id !== memberId) return false
      if (fundingId && c.funding_id !== fundingId) return false
      const f = db.funding.find(f => f.id === c.funding_id)
      return f && f.status === 'approved' && commitmentPaid(db, c) < c.amount
    })
    .sort((a, b) => a.id - b.id)
}

export function allocateAmount (db, { commitment, amount, paymentId = null, creditId = null, user }) {
  const remaining = commitment.amount - commitmentPaid(db, commitment)
  const take = Math.min(amount, remaining)
  if (take <= 0) return 0
  db.allocations.push({ id: nextId(db, 'allocations'), payment_id: paymentId, credit_id: creditId, commitment_id: commitment.id, amount: take, created_at: new Date().toISOString() })
  commitment.paid = commitmentPaid(db, commitment)
  log(db, user, 'allocate', 'commitment', commitment.id, { amount: take })
  return take
}

export function autoAllocate (db, { memberId, amount, paymentId = null, creditId = null, fundingId = null, user }) {
  let left = amount
  for (const c of openCommitments(db, memberId, fundingId)) {
    if (left <= 0) break
    left -= allocateAmount(db, { commitment: c, amount: left, paymentId, creditId, user })
  }
  return left
}

// ---------- وضعیت حساب عضو ----------

export function memberStatement (db, memberId) {
  const m = db.members.find(x => x.id === memberId)
  if (!m) throw new HttpError(404, 'عضو یافت نشد')
  const comms = db.commitments
    .filter(c => c.member_id === memberId)
    .filter(c => db.funding.find(f => f.id === c.funding_id)?.status === 'approved')
    .sort((a, b) => a.id - b.id)
  const commRows = comms.map(c => {
    const f = db.funding.find(x => x.id === c.funding_id)
    const paid = commitmentPaid(db, c)
    return {
      id: c.id, funding_id: c.funding_id, funding_no: f?.no || '', funding_title: f?.title || '',
      funding_type: f?.ftype || '', due_date: f?.due_date || '', share_bp: c.share_bp,
      amount: c.amount, paid, remaining: Math.max(c.amount - paid, 0), settled: paid >= c.amount,
    }
  })
  const payments = db.payments.filter(p => p.member_id === memberId).sort((a, b) => a.id - b.id)
  const payRows = payments.map(p => {
    const alloc = db.allocations.filter(a => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0)
    const f = p.funding_id ? db.funding.find(x => x.id === p.funding_id) : null
    return {
      id: p.id, no: p.no, pay_date: p.pay_date, amount: p.amount, method: p.method,
      status: p.status, tracking_no: p.tracking_no, funding_no: f?.no || '',
      allocated: alloc, unallocated: p.status === 'approved' ? p.amount - alloc : 0,
    }
  })
  const creditRows = db.credits.filter(c => c.member_id === memberId).map(cr => {
    const e = db.expenses.find(x => x.id === cr.expense_id)
    return { id: cr.id, amount: cr.amount, remaining: cr.remaining, expense_no: e?.no || '', expense_title: e?.title || '', date: e?.exp_date || '', note: cr.note }
  })
  const balances = { current: 0, loan: 0, capital: 0, debit_total: 0, credit_total: 0 }
  const taf = tafsilForMember(db, memberId)
  if (taf) {
    for (const { l } of baseRows(db, null, null)) {
      if (l.tafsil_id !== taf.id) continue
      if (l.account_code === '2102') balances.current += l.credit - l.debit
      else if (l.account_code === '2103') balances.loan += l.credit - l.debit
      else if (l.account_code === '3101') balances.capital += l.credit - l.debit
      balances.debit_total += l.debit
      balances.credit_total += l.credit
    }
  }
  const totalCommit = commRows.reduce((s, r) => s + r.amount, 0)
  const totalPaidCommit = commRows.reduce((s, r) => s + r.paid, 0)
  const totalPaidCash = payRows.filter(p => p.status === 'approved').reduce((s, p) => s + p.amount, 0)
  const totalCredit = creditRows.reduce((s, c) => s + c.amount, 0)
  const totalAlloc = db.allocations
    .filter(a => comms.some(c => c.id === a.commitment_id))
    .reduce((s, a) => s + a.amount, 0)
  return {
    member: { id: m.id, code: m.code, full_name: m.full_name, kind: m.kind, phone: m.phone },
    share_now: memberShareBpAt(db, memberId, null),
    commitments: commRows, payments: payRows, credits: creditRows,
    balances,
    totals: {
      commitments: totalCommit, commitments_paid: totalPaidCommit,
      commitments_remaining: totalCommit - totalPaidCommit,
      payments_cash: totalPaidCash, expense_credits: totalCredit,
      total_settled: totalAlloc,
      unallocated_credit: totalPaidCash + totalCredit - totalAlloc,
    },
  }
}

// ---------- تحلیل قاعده‌محور ----------

const monthKey = (iso) => { const [jy, jm] = isoToJalali(iso); return `${jy}-${String(jm).padStart(2, '0')}` }

export function runAnalytics (db) {
  const items = []
  const today = todayIso()
  // رشد غیرعادی هزینه
  const catMonth = {}
  for (const { l, v } of baseRows(db, null, null)) {
    if (l.account_code.startsWith('5') && l.debit > 0) {
      catMonth[l.account_code] ??= {}
      const mk = monthKey(v.vdate)
      catMonth[l.account_code][mk] = (catMonth[l.account_code][mk] || 0) + l.debit
    }
  }
  const currentMk = monthKey(today)
  for (const [code, months] of Object.entries(catMonth)) {
    const keys = Object.keys(months).sort()
    const cur = months[currentMk] || 0
    const prev = keys.filter(k => k < currentMk).slice(-3).map(k => months[k])
    if (cur > 0 && prev.length >= 2) {
      const avg = prev.reduce((s, x) => s + x, 0) / prev.length
      if (avg > 0 && cur >= 20_000_000 && cur > 2 * avg) {
        items.push({
          type: 'growth', severity: 'warning',
          title: `رشد غیرعادی هزینه «${accName(db, code)}»`,
          text: `هزینه این ماه ${cur.toLocaleString('fa-IR')} ریال است که بیش از دو برابر میانگین سه ماه گذشته (${Math.round(avg).toLocaleString('fa-IR')} ریال) می‌باشد.`,
          refs: [`کد حساب ${code}`, 'دفتر معین'], assumptions: 'آستانه: دو برابر میانگین ۳ ماه اخیر و حداقل ۲۰ میلیون ریال',
        })
      }
    }
  }
  // تکراری مشکوک
  const exps = db.expenses.filter(e => e.appr_status === 'approved').sort((a, b) => a.exp_date.localeCompare(b.exp_date))
  const seen = new Set()
  for (let i = 0; i < exps.length; i++) {
    for (let j = i + 1; j < exps.length; j++) {
      const a = exps[i], b = exps[j]
      if (!a.party_name || a.party_name !== b.party_name || a.total_amount !== b.total_amount) continue
      const dd = Math.abs(dayDiffDates(a.exp_date, b.exp_date))
      if (dd <= 45) {
        const pair = [a.id, b.id].sort().join(':')
        if (!seen.has(pair)) {
          seen.add(pair)
          items.push({
            type: 'duplicate', severity: 'warning', title: 'مورد مشکوک به ثبت تکراری',
            text: `هزینه‌های ${a.no} و ${b.no} با مبلغ یکسان (${a.total_amount.toLocaleString('fa-IR')} ریال) و طرف حساب یکسان «${a.party_name}» در فاصله ${dd.toLocaleString('fa-IR')} روز ثبت شده‌اند؛ صحت آن‌ها بررسی شود.`,
            refs: [a.no, b.no], assumptions: 'مبلغ و طرف حساب یکسان در بازه ۴۵ روز',
          })
        }
      }
    }
  }
  // پیش‌بینی کسری نقدینگی
  const cash = Object.values(cashBalance(db)).reduce((s, x) => s + x, 0)
  const monthlyNet = {}
  for (const { l, v } of baseRows(db, null, null)) {
    if (l.account_code === '1101' || l.account_code.startsWith('1102')) {
      const mk = monthKey(v.vdate)
      monthlyNet[mk] = (monthlyNet[mk] || 0) + l.debit - l.credit
    }
  }
  const last3 = Object.keys(monthlyNet).sort().slice(-3).map(k => monthlyNet[k])
  if (cash >= 0 && last3.length && last3.filter(x => x < 0).length >= 2) {
    const avgBurn = last3.reduce((s, x) => s + x, 0) / last3.length
    if (avgBurn < 0) {
      const monthsLeft = Math.floor(cash / Math.abs(avgBurn))
      items.push({
        type: 'cash_forecast', severity: monthsLeft <= 2 ? 'danger' : 'warning',
        title: 'پیش‌بینی کسری نقدینگی',
        text: monthsLeft > 0
          ? `میانگین خالص خروج نقد سه ماه اخیر ${Math.round(avgBurn).toLocaleString('fa-IR')} ریال در ماه و موجودی نقد و بانک ${cash.toLocaleString('fa-IR')} ریال است؛ با ادامه همین روند، نقدینگی حدوداً تا ${monthsLeft.toLocaleString('fa-IR')} ماه آینده به پایان می‌رسد.`
          : 'با روند فعلی، کسری نقدینگی در همین ماه رخ می‌دهد؛ اقدام تأمین مالی لازم است.',
        refs: ['حساب ۱۱۰۱ صندوق', 'حساب ۱۱۰۲ بانک‌ها'],
        assumptions: 'فرض: تداوم میانگین جریان نقد سه ماه اخیر و عدم دریافت جدید',
      })
    }
  }
  // سررسیدها
  for (const c of db.commitments) {
    const f = db.funding.find(x => x.id === c.funding_id)
    if (!f || f.status !== 'approved' || !f.due_date) continue
    const paid = commitmentPaid(db, c)
    const remaining = c.amount - paid
    if (remaining <= 0) continue
    const days = dayDiffDates(today, f.due_date)
    if (days <= 15) {
      const m = db.members.find(x => x.id === c.member_id)
      items.push({
        type: 'due', severity: days < 0 ? 'danger' : 'info',
        title: days < 0 ? 'سررسید گذشته تعهد عضو' : 'سررسید نزدیک تعهد عضو',
        text: `تعهد ${m?.full_name || ''} در درخواست «${f.title}»: مانده ${remaining.toLocaleString('fa-IR')} ریال، سررسید ${f.due_date} (${days < 0 ? 'گذشته' : `${days.toLocaleString('fa-IR')} روز مانده`}).`,
        refs: [f.no], assumptions: '',
      })
    }
  }
  return items
}

function dayDiffDates (iso1, iso2) {
  const [y1, m1, d1] = iso1.split('-').map(Number)
  const [y2, m2, d2] = iso2.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}
