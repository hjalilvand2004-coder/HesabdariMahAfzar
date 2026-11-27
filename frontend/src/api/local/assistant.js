// دستیار هوشمند مالیار — موتور قاعده‌محور تحلیل وضعیت حسابی کاربر
// راهنمایی و اقدامات پیشنهادی متناسب با نقش و سطح دسترسی هر کاربر،
// همیشه بر پایه داده واقعی سامانه (بدون عدد ساخته‌شده) — قرارداد یکسان با نسخه سرور
import { todayIso, isoToJalali } from '../../lib/jalali.js'
import { permOf, roleLabels } from '../../lib/format.js'
import * as E from './engine.js'
import { HttpError } from './store.js'

// ---------- ابزارهای کمکی ----------

const _dayDiff = (iso1, iso2) => {
  const [y1, m1, d1] = String(iso1).split('-').map(Number)
  const [y2, m2, d2] = String(iso2).split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

const fa = (n) => (n === 0 || n ? Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 0 }) : '۰')

const fmt = (rial, unit = 'toman') => {
  const v = Math.round(Number(rial || 0))
  if (unit === 'rial') return fa(v) + ' ریال'
  return fa(v / 10) + ' تومان'
}

const pctOf = (a, b) => (b ? Math.round(a * 100 / b) : 0)

const norm = (s) => String(s || '')
  .replace(/\u200c/g, ' ')
  .replace(/[؟?!.,،؛:«»"'\-()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const hasAny = (q, words) => words.some(w => q.includes(norm(w)))

// ---------- اسنپ‌شات وضعیت شرکت ----------

function companySnap (d) {
  const s = d.settings
  const cash = Object.values(E.cashBalance(d)).reduce((a, b) => a + b, 0)
  const pnlY = E.pnl(d, s.fiscal_start, s.fiscal_end)
  const profit = pnlY.total_revenue - pnlY.total_expense
  const fundings = d.funding.filter(f => f.status === 'approved')
  const approvedAmount = fundings.reduce((a, f) => a + f.amount, 0)
  let collected = 0
  let fundingRemaining = 0
  for (const f of fundings) {
    for (const c of d.commitments.filter(c => c.funding_id === f.id)) {
      const paid = E.commitmentPaid(d, c)
      collected += paid
      fundingRemaining += Math.max(c.amount - paid, 0)
    }
  }
  const approvedExp = d.expenses.filter(e => e.appr_status === 'approved')
  const vendorDebt = approvedExp.filter(e => e.payer_type === 'company')
    .reduce((a, e) => a + Math.max(e.total_amount - e.paid_amount, 0), 0)
  const drafts = d.expenses.filter(e => e.appr_status === 'draft')
  const pendingExp = d.expenses.filter(e => e.appr_status === 'pending')
  const declaredPays = d.payments.filter(p => p.status === 'declared')
  const pendingWallet = d.wallet.filter(w => w.type === 'charge' && w.status === 'pending')
  const pendingSvc = d.services.filter(x => ['draft', 'pending'].includes(x.status))
  const alerts = E.runAnalytics(d)
  const tb = E.trialBalance(d, s.fiscal_start, s.fiscal_end)
  const tbd = tb.reduce((a, x) => a + x.move_debit, 0)
  const tbc = tb.reduce((a, x) => a + x.move_credit, 0)
  return {
    cash, profit, revenue: pnlY.total_revenue, expense: pnlY.total_expense,
    approvedAmount, collected, fundingRemaining,
    vendorDebt, drafts, pendingExp, declaredPays, pendingWallet, pendingSvc,
    pendingFunding: d.funding.filter(f => f.status === 'pending'),
    alerts, dupCount: alerts.filter(a => a.type === 'duplicate').length,
    cashAlert: alerts.find(a => a.type === 'cash_forecast') || null,
    dueAlerts: alerts.filter(a => a.type === 'due'),
    tbBalanced: tbd === tbc, tbDiff: tbd - tbc,
    users: d.users.filter(u => u.is_active),
    periodClosed: !!s.period_closed,
    fiscalLabel: s.fiscal_label,
    unit: s.currency_display === 'rial' ? 'rial' : 'toman',
  }
}

// ---------- اسنپ‌شات وضعیت عضو ----------

function memberSnap (d, memberId) {
  const st = E.memberStatement(d, memberId)
  const unpaidComms = st.commitments.filter(c => !c.settled)
  const pendingWallet = d.wallet.filter(w => w.member_id === memberId && w.type === 'charge' && w.status === 'pending')
  const dueInfo = unpaidComms
    .filter(c => c.due_date)
    .map(c => ({ ...c, days: _dayDiff(todayIso(), c.due_date) }))
    .sort((a, b) => a.days - b.days)[0] || null
  return {
    st, unpaidComms, pendingWallet, dueInfo,
    remaining: st.totals.commitments_remaining,
    committed: st.totals.commitments,
    paid: st.totals.commitments_paid,
    walletBal: st.totals.wallet_balance,
    unallocated: Math.max(st.totals.unallocated_credit, 0),
    net: st.totals.net_balance,
    unit: d.settings.currency_display === 'rial' ? 'rial' : 'toman',
  }
}

// ---------- کارت‌های راهنمایی هر نقش ----------

function staffInsights (d, u, snap, perm) {
  const out = []
  const unit = snap.unit
  const isCeoLike = ['ceo', 'admin'].includes(u.role)
  const isFin = ['finance', 'admin'].includes(u.role)
  const isAcc = ['accountant', 'admin'].includes(u.role)
  const isAuditor = u.role === 'auditor'

  // کارتابل تأییدها — مدیرعامل و مدیر سامانه
  if (isCeoLike) {
    const items = []
    if (snap.pendingExp.length && perm('expenses')) items.push({ label: `بررسی ${fa(snap.pendingExp.length)} هزینه در انتظار تأیید`, path: '/expenses' })
    if (snap.pendingFunding.length && perm('funding')) items.push({ label: `تصمیم درباره ${fa(snap.pendingFunding.length)} مصوبه تأمین مالی`, path: '/funding' })
    if (snap.pendingSvc.length && perm('services')) items.push({ label: `بررسی ${fa(snap.pendingSvc.length)} خدمت عضو`, path: '/services' })
    const pendSum = snap.pendingExp.reduce((a, e) => a + e.total_amount, 0)
    if (items.length) {
      out.push({
        id: 'approvals', severity: 'warning', icon: 'checkCircle',
        title: 'کارتابل تأیید شما',
        text: `در انتظار تصمیم شماست: ${fa(snap.pendingExp.length)} هزینه (مبلغ ${fmt(pendSum, unit)})، ${fa(snap.pendingFunding.length)} مصوبه تأمین مالی و ${fa(snap.pendingSvc.length)} خدمت عضو. تأیید فقط از سمت شما (مدیرعامل) انجام می‌شود و تأخیر آن، روند پرداخت و تهاتر اعضا را متوقف می‌کند.`,
        actions: items,
      })
    } else {
      out.push({
        id: 'approvals', severity: 'success', icon: 'checkCircle',
        title: 'کارتابل تأیید شما خالی است',
        text: 'هیچ موردی در انتظار تأیید شما نیست؛ همه هزینه‌ها، مصوبه‌ها و خدمات تصمیم‌گرفته‌شده‌اند.',
        actions: [],
      })
    }
  }

  // مدیر مالی — وصول و پرداخت‌های در انتظار بررسی
  if (isFin && perm('payments')) {
    if (snap.declaredPays.length) {
      const sum = snap.declaredPays.reduce((a, p) => a + p.amount, 0)
      out.push({
        id: 'declared-payments', severity: 'warning', icon: 'payments',
        title: 'اعلام‌های پرداخت در انتظار بررسی',
        text: `${fa(snap.declaredPays.length)} اعلام پرداخت اعضا به‌مبلغ ${fmt(sum, unit)} منتظر رسیدگی شماست. تا وصول و تأیید، به تعهد عضو منظور نمی‌شود.`,
        actions: [{ label: 'بررسی پرداخت‌ها', path: '/payments' }],
      })
    }
    if (snap.pendingWallet.length && perm('wallet')) {
      const sum = snap.pendingWallet.reduce((a, w) => a + w.amount, 0)
      out.push({
        id: 'wallet-charges', severity: 'info', icon: 'wallet',
        title: 'شارژ دستی کیف پول در انتظار تأیید',
        text: `${fa(snap.pendingWallet.length)} اعلام شارژ دستی کیف پول به‌مبلغ ${fmt(sum, unit)} در انتظار تأیید مالی است؛ پس از تأیید، اسناد و اعتبار عضو خودکار صادر می‌شود.`,
        actions: [{ label: 'کیف پول اعضا', path: '/wallet' }],
      })
    }
  }

  // مسئول حسابداری — پیش‌نویس‌ها و تسویه فروشندگان
  if (isAcc && perm('expenses')) {
    if (snap.drafts.length) {
      const sum = snap.drafts.reduce((a, e) => a + e.total_amount, 0)
      out.push({
        id: 'draft-expenses', severity: 'info', icon: 'expenses',
        title: 'هزینه‌های پیش‌نویس ناتمام',
        text: `${fa(snap.drafts.length)} هزینه در حالت پیش‌نویس (مبلغ ${fmt(sum, unit)}) ثبت شده اما هنوز برای تأیید ارسال نشده است؛ پس از تکمیل مدارک، «ارسال برای تأیید» را بزنید.`,
        actions: [{ label: 'هزینه‌های پیش‌نویس', path: '/expenses' }],
      })
    }
    if (snap.vendorDebt > 0) {
      out.push({
        id: 'vendor-debt', severity: 'warning', icon: 'bank',
        title: 'بدهی به فروشندگان',
        text: `مجموع ${fmt(snap.vendorDebt, unit)} بابت هزینه‌های تأییدشده و پرداخت‌نشده به فروشندگان ثبت شده است؛ تسویه هر قلم از صفحه هزینه‌ها انجام می‌شود.`,
        actions: [{ label: 'هزینه‌های پرداخت‌نشده', path: '/expenses' }],
      })
    }
  }

  // وضعیت سود و زیان و نقدینگی — همه کارکنان با دسترسی داشبورد
  if (perm('dashboard')) {
    const pnlSeverity = snap.profit >= 0 ? 'success' : 'warning'
    out.push({
      id: 'pnl', severity: pnlSeverity, icon: 'pie',
      title: `وضعیت مالی سال ${fa(snap.fiscalLabel)}`,
      text: `درآمد ${fmt(snap.revenue, unit)} در برابر هزینه ${fmt(snap.expense, unit)} — ${snap.profit >= 0 ? 'سود' : 'زیان'} دوره ${fmt(Math.abs(snap.profit), unit)} و موجودی نقد و بانک ${fmt(snap.cash, unit)} است.`,
      actions: perm('statements') ? [{ label: 'صورت‌های مالی', path: '/statements' }] : [],
    })
    if (snap.cashAlert) {
      out.push({
        id: 'alert-cash', severity: snap.cashAlert.severity === 'danger' ? 'danger' : 'warning', icon: 'alert',
        title: snap.cashAlert.title, text: snap.cashAlert.text,
        actions: perm('analytics') ? [{ label: 'تحلیل‌های هوشمند', path: '/analytics' }] : [],
      })
    }
  }

  // وصول تأمین مالی
  if (perm('funding') && snap.approvedAmount > 0) {
    out.push({
      id: 'funding-progress', severity: 'info', icon: 'funding',
      title: 'پیشرفت وصول تأمین مالی',
      text: `از مجموع مصوبه‌های تأییدشده (${fmt(snap.approvedAmount, unit)}) تاکنون ${fmt(snap.collected, unit)} (${fa(pctOf(snap.collected, snap.approvedAmount))}٪) وصول و ${fmt(snap.fundingRemaining, unit)} باقی مانده است.`,
      actions: [{ label: 'تأمین مالی اعضا', path: '/funding' }],
    })
  }

  // سررسیدهای تعهد اعضا
  if (perm('members') && snap.dueAlerts.length) {
    out.push({
      id: 'alert-due', severity: snap.dueAlerts.some(a => a.severity === 'danger') ? 'danger' : 'warning', icon: 'clock',
      title: 'سررسید تعهد اعضا',
      text: snap.dueAlerts.slice(0, 2).map(a => a.text).join(' '),
      actions: [{ label: 'اعضا و سهامداران', path: '/members' }],
    })
  }

  // موارد مشکوک — حسابرس و همه با دسترسی تحلیل
  if (perm('analytics') && (isAuditor || snap.dupCount > 0)) {
    out.push({
      id: 'alert-dup', severity: isAuditor ? 'info' : 'warning', icon: 'audit',
      title: isAuditor ? 'خلاصه حسابرسی داده' : 'موارد مشکوک به ثبت تکراری',
      text: isAuditor
        ? `${snap.dupCount > 0 ? `${fa(snap.dupCount)} جفت هزینه با مبلغ و طرف‌حساب یکسان در بازه کمتر از ۴۵ روز ثبت شده و نیازمند رسیدگی است. ` : 'مورد مشکوکی به ثبت تکراری یافت نشد. '}تراز آزمایشی ${snap.tbBalanced ? 'متوازن است' : 'نامتوازن است'}؛ گزارش‌ها در «دفاتر و گزارش‌ها» قابل رسیدگی است.`
        : `${fa(snap.dupCount)} جفت هزینه با مبلغ و طرف‌حساب یکسان در فاصله کوتاه ثبت شده است؛ قبل از تأیید، اصالت آن‌ها بررسی شود.`,
      actions: [{ label: 'تحلیل‌های هوشمند', path: '/analytics' }],
    })
  }

  // وضعیت دوره مالی
  if (snap.periodClosed) {
    out.push({
      id: 'period', severity: 'danger', icon: 'lock',
      title: 'دوره مالی بسته است',
      text: 'ثبت و ویرایش اسناد دوره بسته برای همه نقش‌ها (به‌جز مدیر سامانه) مسدود است. در صورت نیاز به اصلاح، با مدیر سامانه هماهنگ کنید.',
      actions: u.role === 'admin' ? [{ label: 'تنظیمات دوره', path: '/settings' }] : [],
    })
  }

  // مدیر سامانه — سلامت سامانه و پروفایل شرکت
  if (u.role === 'admin') {
    const s = d.settings
    const incomplete = !s.company_name || !s.company_national_id ||
      String(s.company_national_id).includes('اصلاح شود') || !s.company_reg_no
    if (incomplete && perm('settings')) {
      out.push({
        id: 'profile-completeness', severity: 'info', icon: 'idcard',
        title: 'تکمیل پروفایل شرکت',
        text: 'برخی فیلدهای پروفایل شرکت (شناسه ملی، شماره ثبت و…) هنوز تکمیل یا پیش‌فرض است؛ این اطلاعات در سرصفحه گزارش‌ها و صورت‌های مالی نمایش داده می‌شود.',
        actions: [{ label: 'تنظیمات پروفایل', path: '/settings' }],
      })
    }
    if (perm('users')) {
      out.push({
        id: 'users', severity: 'info', icon: 'users',
        title: 'کاربران و سطح دسترسی',
        text: `هم‌اکنون ${fa(snap.users.length)} کاربر فعال در سامانه دارد. ماتریس سطح دسترسی نقش‌ها از «مدیریت کاربران و سطح دسترسی» قابل تنظیم است و دستیار هوشمند راهنمایی هر کاربر را با همین ماتریس هماهنگ می‌کند.`,
        actions: [{ label: 'مدیریت کاربران', path: '/users' }],
      })
    }
  }
  return out
}

function memberInsights (d, u, snap) {
  const out = []
  const unit = snap.unit
  const name = u.full_name
  out.push({
    id: 'member-commitment', severity: snap.unpaidComms.length ? 'warning' : 'success', icon: 'funding',
    title: 'وضعیت تعهد شما',
    text: snap.committed > 0
      ? `${name} عزیز؛ تعهد شما در مصوبه‌های تأییدشده ${fmt(snap.committed, unit)} است که تاکنون ${fmt(snap.paid, unit)} (${fa(pctOf(snap.paid, snap.committed))}٪) پرداخت شده و مانده ${fmt(snap.remaining, unit)} باقی مانده است.` +
        (snap.dueInfo ? ` نزدیک‌ترین سررسید: ${snap.dueInfo.funding_title} تا ${snap.dueInfo.due_date}${snap.dueInfo.days < 0 ? ' (گذشته — در اولویت پرداخت باشد)' : ` (${fa(snap.dueInfo.days)} روز مانده)`}.` : '')
      : 'تعهد مالی مصوبه‌ای برای شما ثبت نشده است؛ در صورت مصوبه جدید، وضعیت شما همین‌جا به‌روز می‌شود.',
    actions: snap.remaining > 0
      ? [{ label: 'پرداخت/اعلام پرداخت', path: '/my-account' }]
      : [{ label: 'وضعیت حساب من', path: '/my-account' }],
  })
  if (snap.pendingWallet.length) {
    const sum = snap.pendingWallet.reduce((a, w) => a + w.amount, 0)
    out.push({
      id: 'member-wallet-pending', severity: 'info', icon: 'wallet',
      title: 'شارژ کیف پول در انتظار تأیید',
      text: `اعلام شارژ ${fmt(sum, unit)} از سمت شما در انتظار تأیید مدیریت مالی است؛ پس از تأیید، به موجودی کیف پول شما افزوده می‌شود.`,
      actions: [],
    })
  }
  out.push({
    id: 'member-wallet', severity: 'info', icon: 'wallet',
    title: 'کیف پول شما',
    text: `موجودی کیف پول شما ${fmt(snap.walletBal, unit)} و اعتبار تهاتر قابل استفاده (پرداخت‌های بدون تخصیص + جبران خدمات) ${fmt(snap.unallocated, unit)} است. در صورت داشتن مانده تعهد، می‌توانید از درگاه بانک ملی پرداخت آنلاین انجام دهید.`,
    actions: [{ label: 'شارژ/کیف پول من', path: '/wallet' }],
  })
  if (snap.st.totals.services_pending > 0) {
    out.push({
      id: 'member-services', severity: 'info', icon: 'services',
      title: 'خدمات ثبت‌شده شما',
      text: `${fa(snap.st.services.length)} خدمت به مبلغ ${fmt(snap.st.totals.services_total, unit)} از سمت شما ثبت شده که ${fmt(snap.st.totals.services_pending, unit)} آن در جریان بررسی و جبران است.`,
      actions: [{ label: 'وضعیت حساب من', path: '/my-account' }],
    })
  }
  out.push({
    id: 'member-net', severity: snap.net >= 0 ? 'success' : 'info', icon: 'scale',
    title: 'جمع‌بندی حساب شما',
    text: snap.net >= 0
      ? `مجموع پرداخت‌ها و اعتبارهای شما (${fmt(snap.paid + snap.st.totals.expense_credits, unit)}) وضعیت تعهد ${fmt(snap.committed, unit)} را پوشش داده و مانده ${fmt(snap.remaining, unit)} باقی است.`
      : `مانده تعهد پرداخت‌نشده شما ${fmt(snap.remaining, unit)} است؛ برای جلوگیری از تأخیر در مصوبه‌ها، پرداخت را از پرتال خود انجام دهید.`,
    actions: [{ label: 'وضعیت حساب من', path: '/my-account' }],
  })
  return out
}

// ---------- پاسخ به پرسش‌ها ----------

function answer (d, u, snap, mSnap, q, perm) {
  const unit = snap.unit
  const link = (label, path, p) => (perm(p) ? [{ label, path }] : [])

  if (hasAny(q, ['سلام', 'درود', 'وقت بخیر'])) {
    return {
      answer: `سلام ${u.full_name} عزیز! من دستیار هوشمند مالیار هستم؛ وضعیت حسابی شما را تحلیل می‌کنم و راهنمایی و اقدام لازم را متناسب با نقش «${roleLabels[u.role]}» پیشنهاد می‌دهم. می‌توانید پرسش خود را بنویسید یا از پرسش‌های پیشنهادی بالا استفاده کنید.`,
      links: [], severity: 'info',
    }
  }
  if (hasAny(q, ['دسترسی', 'نقش من', 'اجازه', 'مجوز', 'سطح دسترسی'])) {
    const mods = ['dashboard', 'expenses', 'funding', 'payments', 'wallet', 'services', 'members', 'accounts', 'vouchers', 'reports', 'statements', 'analytics', 'audit', 'users', 'settings', 'my-account']
    const allowed = mods.filter(m => perm(m))
    return {
      answer: `نقش شما «${roleLabels[u.role]}» است و به این بخش‌ها دسترسی دارید: ${allowed.join('، ')}. هر راهنمایی و اقدامی که پیشنهاد می‌کنم فقط در همین محدوده است؛ بخش‌های دیگر برای نقش شما نمایش داده نمی‌شوند.`,
      links: [], severity: 'info',
    }
  }
  if (hasAny(q, ['تعهد', 'سهم من', 'پرداخت من', 'مساهم', 'وصول', 'سهام'])) {
    if (u.role === 'member') {
      const ms = mSnap
      return {
        answer: `تعهد شما در مصوبه‌های تأییدشده ${fmt(ms.committed, unit)} است؛ تاکنون ${fmt(ms.paid, unit)} پرداخت شده و مانده ${fmt(ms.remaining, unit)} باقی است.` +
          (ms.dueInfo ? ` نزدیک‌ترین سررسید «${ms.dueInfo.funding_title}» تا ${ms.dueInfo.due_date} است${ms.dueInfo.days < 0 ? ' و از تاریخ سررسید گذشته؛ در اولویت پرداخت قرار گیرد' : ''}.` : ' ') +
          `برای پرداخت آنلاین از درگاه بانک ملی یا اعلام پرداخت دستی، از پرتال خود استفاده کنید.`,
        links: link('وضعیت حساب من', '/my-account', 'my-account'), severity: ms.remaining > 0 ? 'warning' : 'success',
      }
    }
    return {
      answer: `از مصوبه‌های تأییدشده به مبلغ ${fmt(snap.approvedAmount, unit)}، تاکنون ${fmt(snap.collected, unit)} (${fa(pctOf(snap.collected, snap.approvedAmount))}٪) وصول شده و مانده اعضا ${fmt(snap.fundingRemaining, unit)} است.` +
        (snap.pendingFunding.length ? ` همچنین ${fa(snap.pendingFunding.length)} مصوبه جدید در انتظار تصویب شماست.` : ''),
      links: link('تأمین مالی اعضا', '/funding', 'funding'), severity: 'info',
    }
  }
  if (hasAny(q, ['کیف پول', 'شارژ', 'درگاه'])) {
    if (u.role === 'member') {
      const ms = mSnap
      return {
        answer: `موجودی کیف پول شما ${fmt(ms.walletBal, unit)} است.` +
          (ms.pendingWallet.length ? ` یک اعلام شارژ ${fmt(ms.pendingWallet.reduce((a, w) => a + w.amount, 0), unit)} از سمت شما در انتظار تأیید مالی است.` : '') +
          ` برای شارژ از درگاه بانک ملی یا اعلام واریز دستی، به کیف پول من بروید؛ اعتبار تهاتر قابل استفاده شما ${fmt(ms.unallocated, unit)} است.`,
        links: link('کیف پول من', '/wallet', 'wallet'), severity: 'info',
      }
    }
    const pend = snap.pendingWallet
    return {
      answer: pend.length
        ? `${fa(pend.length)} اعلام شارژ دستی کیف پول اعضا به‌مبلغ ${fmt(pend.reduce((a, w) => a + w.amount, 0), unit)} در انتظار تأیید شماست.`
        : 'هیچ اعلام شارژ دستی در انتظار تأیید نیست؛ شارژهای درگاه بانک ملی به‌صورت خودکار تأیید می‌شوند.',
      links: link('کیف پول اعضا', '/wallet', 'wallet'), severity: pend.length ? 'warning' : 'info',
    }
  }
  if (hasAny(q, ['سود', 'زیان', 'درآمد', 'نتیجه'])) {
    const p = snap.profit
    return {
      answer: `در سال مالی ${fa(snap.fiscalLabel)} درآمد ${fmt(snap.revenue, unit)} و هزینه ${fmt(snap.expense, unit)} ثبت شده که ${p >= 0 ? `سود ${fmt(p, unit)}` : `زیان ${fmt(Math.abs(p), unit)}`} را نشان می‌دهد؛ موجودی نقد و بانک ${fmt(snap.cash, unit)} است.` +
        (snap.cashAlert ? ` توجه: ${snap.cashAlert.title} — ${snap.cashAlert.text}` : ''),
      links: [...link('صورت‌های مالی', '/statements', 'statements'), ...link('تحلیل‌های هوشمند', '/analytics', 'analytics')],
      severity: p >= 0 ? 'success' : 'warning',
    }
  }
  if (hasAny(q, ['هزینه', 'خرید', 'فاکتور', 'فروشنده'])) {
    if (u.role === 'member') {
      return {
        answer: 'برای اعضا، هزینه‌های شخصی قابل مشاهده صرفاً هزینه‌هایی است که از حساب شخصی خود پرداخت کرده‌اید و در «وضعیت حساب من» به‌صورت اعتبار تهاتر نشان داده می‌شود.',
        links: link('وضعیت حساب من', '/my-account', 'my-account'), severity: 'info',
      }
    }
    const pendSum = snap.pendingExp.reduce((a, e) => a + e.total_amount, 0)
    return {
      answer: `وضعیت هزینه‌ها: ${fa(snap.pendingExp.length)} مورد در انتظار تأیید (${fmt(pendSum, unit)})، ${fa(snap.drafts.length)} پیش‌نویس و بدهی پرداخت‌نشده به فروشندگان ${fmt(snap.vendorDebt, unit)}.` +
        (['ceo', 'admin'].includes(u.role) && snap.pendingExp.length ? ' تأیید هزینه‌ها فقط از سمت شما (مدیرعامل) انجام می‌شود.' : ''),
      links: link('هزینه‌ها و خریدها', '/expenses', 'expenses'), severity: 'info',
    }
  }
  if (hasAny(q, ['تأمین مالی', 'مصوبه', 'وام', 'سرمایه'])) {
    return {
      answer: `مصوبه‌های تأییدشده: ${fmt(snap.approvedAmount, unit)} — وصول‌شده ${fmt(snap.collected, unit)} (${fa(pctOf(snap.collected, snap.approvedAmount))}٪) — مانده ${fmt(snap.fundingRemaining, unit)}.` +
        (snap.pendingFunding.length ? ` ${fa(snap.pendingFunding.length)} مصوبه در انتظار تصویب مدیرعامل است.` : ''),
      links: link('تأمین مالی اعضا', '/funding', 'funding'), severity: 'info',
    }
  }
  if (hasAny(q, ['خدمت', 'جبران'])) {
    const pend = snap.pendingSvc
    if (u.role === 'member') {
      const ms = mSnap
      return {
        answer: ms.st.services.length
          ? `${fa(ms.st.services.length)} خدمت به مبلغ ${fmt(ms.st.totals.services_total, unit)} از سمت شما ثبت شده که ${fmt(ms.st.totals.services_pending, unit)} آن در جریان بررسی است.`
          : 'تاکنون خدمتی از سمت شما ثبت نشده است.',
        links: link('وضعیت حساب من', '/my-account', 'my-account'), severity: 'info',
      }
    }
    return {
      answer: pend.length
        ? `${fa(pend.length)} خدمت عضو به مبلغ ${fmt(pend.reduce((a, x) => a + x.amount, 0), unit)} در جریان بررسی و جبران است؛ پس از تأیید، سند و اعتبار تهاتر خودکار صادر می‌شود.`
        : 'خدمت در جریان بررسی وجود ندارد.',
      links: link('خدمات اعضا', '/services', 'services'), severity: 'info',
    }
  }
  if (hasAny(q, ['هشدار', 'ریسک', 'مشکل', 'تکراری', 'نقدینگی', 'خطر'])) {
    const items = snap.alerts
    if (!items.length) return { answer: 'در تحلیل قاعده‌محور فعلی، هشدار فعال (رشد غیرعادی هزینه، تکراری مشکوک، کسری نقدینگی یا سررسید گذشته) یافت نشد.', links: link('تحلیل‌های هوشمند', '/analytics', 'analytics'), severity: 'success' }
    return {
      answer: `${fa(items.length)} هشدار فعال است: ${items.slice(0, 3).map(a => `«${a.title}»`).join('، ')}${items.length > 3 ? ' و…' : ''}؛ جزئیات و فرضیات هر هشدار در تحلیل‌های هوشمند آمده است.`,
      links: link('تحلیل‌های هوشمند', '/analytics', 'analytics'), severity: 'warning',
    }
  }
  if (hasAny(q, ['دوره', 'بستن', 'بازگشایی'])) {
    return {
      answer: snap.periodClosed
        ? 'دوره مالی فعلی بسته است؛ ثبت و تغییر اسناد مسدود است و فقط مدیر سامانه می‌تواند آن را بازگشایی کند.'
        : `دوره مالی ${fa(snap.fiscalLabel)} باز است. پس از نهایی‌شدن گزارش‌های سالانه، بستن دوره از تنظیمات انجام می‌شود و هر ثبت/ویرایش پس از آن محدود می‌شود؛ پیش از بستن، تراز آزمایشی ${snap.tbBalanced ? 'متوازن است و مانعی ندارد' : 'نامتوازن است — ابتدا مغایرت را رفع کنید'}.`,
      links: u.role === 'member' ? [] : link('تنظیمات', '/settings', 'settings'), severity: snap.periodClosed ? 'danger' : 'info',
    }
  }
  if (hasAny(q, ['تراز', 'دفتر', 'گزارش', 'سند'])) {
    return {
      answer: `تراز آزمایشی سال مالی ${snap.tbBalanced ? 'متوازن است (جمع بدهکار = بستانکار)' : `نامتوازن است (اختلاف ${fmt(Math.abs(snap.tbDiff), unit)})`}. دفاتر روزنامه، معین و تفصیلی و اسناد خودکار مرتبط با هر هزینه/پرداخت از بخش دفاتر و گزارش‌ها و اسناد حسابداری قابل دریافت است.`,
      links: [...link('دفاتر و گزارش‌ها', '/reports', 'reports'), ...link('اسناد حسابداری', '/vouchers', 'vouchers')],
      severity: snap.tbBalanced ? 'success' : 'warning',
    }
  }
  if (hasAny(q, ['راهنما', 'چه کاری', 'چه کنم', 'کمک', 'اقدام', 'باید'])) {
    const top = buildOverview(d, u).insights.filter(i => i.actions.length).slice(0, 3)
    return {
      answer: top.length
        ? `بر اساس وضعیت فعلی حساب‌ها، این اقدام‌ها را در اولویت بگذارید: ${top.map(i => i.title).join('؛ ')}. هر کارت راهنمایی در همین پنل دکمه اقدام مستقیم دارد.`
        : 'بر اساس وضعیت فعلی، اقدام فوری لازم نیست؛ همه موارد به‌روز است.',
      links: [], severity: 'info',
    }
  }
  return {
    answer: `این پرسش را دقیق متوجه نشدم، اما می‌توانم درباره این موضوعات راهنمایی کنم: وضعیت تعهد و پرداخت اعضا، کیف پول و شارژ درگاه، هزینه‌ها و تسویه فروشندگان، سود و زیان، مصوبه‌های تأمین مالی، خدمات و جبران اعضا، هشدارهای مالی و سطح دسترسی شما. یکی از پرسش‌های پیشنهادی را انتخاب کنید یا موضوع را دقیق‌تر بنویسید.`,
    links: [], severity: 'info',
  }
}

// ---------- نقطه ورود عمومی ----------

// کارت‌هایی که کل موضوعشان یک ماژول خاص است — بدون دسترسی، از خلاصه حذف می‌شوند
const INSIGHT_MODULE = {
  'member-wallet': 'wallet', 'member-wallet-pending': 'wallet', 'wallet-charges': 'wallet',
  'declared-payments': 'payments', 'draft-expenses': 'expenses', 'vendor-debt': 'expenses',
  'users': 'users', 'profile-completeness': 'settings',
}

// گیت نهایی سطح دسترسی: هیچ اقدام یا کارتی خارج از مجوز نقش پیشنهاد نمی‌شود
function gateInsights (insights, perm) {
  return insights
    .map(ins => ({
      ...ins,
      actions: (ins.actions || []).filter(a => perm(String(a.path || '').replace(/^\//, '').split('?')[0])),
    }))
    .filter(ins => !INSIGHT_MODULE[ins.id] || perm(INSIGHT_MODULE[ins.id]))
}

export function buildOverview (d, u) {
  const s = d.settings
  const role = u.role
  const perm = (moduleKey) => permOf(s, role, moduleKey)
  const snap = companySnap(d)
  const mSnap = role === 'member' && u.member_id ? memberSnap(d, u.member_id) : null

  let insights
  if (role === 'member') {
    insights = mSnap ? memberInsights(d, u, mSnap, perm) : []
  } else {
    insights = staffInsights(d, u, snap, perm)
  }
  insights = gateInsights(insights, perm)

  const chips = {
    ceo: ['چه چیزهایی در انتظار تأیید من است؟', 'وضعیت سود و زیان شرکت؟', 'هشدارهای مالی امروز؟', 'وضعیت وصول تأمین مالی؟'],
    admin: ['وضعیت کاربران و دسترسی‌ها؟', 'چه چیزهایی در انتظار تأیید است؟', 'وضعیت سود و زیان شرکت؟', 'پروفایل شرکت کامل است؟'],
    finance: ['اعلام‌های پرداخت در انتظار بررسی؟', 'شارژهای کیف پول در انتظار تأیید؟', 'وضعیت سود و زیان شرکت؟', 'هشدارهای مالی امروز؟'],
    accountant: ['هزینه‌های پیش‌نویس من؟', 'بدهی به فروشندگان چقدر است؟', 'وضعیت سود و زیان شرکت؟', 'وضعیت تراز آزمایشی؟'],
    auditor: ['خلاصه حسابرسی داده امروز؟', 'وضعیت تراز آزمایشی؟', 'موارد تکراری مشکوک؟', 'وضعیت دوره مالی؟'],
    member: ['وضعیت تعهد من؟', 'موجودی کیف پول من؟', 'چطور تعهدم را پرداخت کنم؟', 'اعتبار تهاتر من چقدر است؟'],
  }[role] || ['وضعیت مالی شرکت؟', 'هشدارهای امروز؟', 'سطح دسترسی من؟']

  const stats = role === 'member' && mSnap
    ? [
        { label: 'تعهد من', value: fmt(mSnap.committed, mSnap.unit) },
        { label: 'پرداخت‌شده', value: fmt(mSnap.paid, mSnap.unit) },
        { label: 'مانده تعهد', value: fmt(mSnap.remaining, mSnap.unit) },
        { label: 'کیف پول من', value: fmt(mSnap.walletBal, mSnap.unit) },
      ]
    : [
        { label: 'نقد و بانک', value: fmt(snap.cash, snap.unit) },
        { label: 'سود سال', value: fmt(snap.profit, snap.unit) },
        { label: 'وصول تأمین مالی', value: fmt(snap.collected, snap.unit) },
        { label: 'در انتظار تصمیم', value: fa(snap.pendingExp.length + snap.pendingFunding.length + snap.pendingSvc.length + snap.declaredPays.length) + ' مورد' },
      ]

  const roleGuide = {
    admin: 'شما مدیر سامانه هستید؛ علاوه بر کارتابل تأییدها، سلامت کاربران، ماتریس دسترسی، دوره مالی و پروفایل شرکت هم تحت راهنمایی شماست.',
    ceo: 'شما تصمیم‌گیر نهایی هزینه‌ها، مصوبه‌ها و جبران خدمات هستید؛ دستیار، کارتابل تأیید شما و وضعیت مالی کل شرکت را رصد می‌کند.',
    finance: 'شما مسئول وصول پرداخت‌ها، تأیید شارژ کیف پول و تسویه‌ها هستید؛ دستیار موارد در انتظار بررسی شما را پیگیری می‌کند.',
    accountant: 'شما مسئول ثبت و کامل‌کردن اسناد هستید؛ دستیار پیش‌نویس‌های ناتمام، بدهی فروشندگان و توازن دفاتر را نشان می‌دهد.',
    auditor: 'شما دسترسی فقط‌خواندنی دارید؛ دستیار وضعیت توازن دفاتر، موارد مشکوک و ردپای فعالیت‌ها را برای رسیدگی شما خلاصه می‌کند.',
    member: 'شما عضو و سهامدار هستید؛ دستیار وضعیت تعهد، پرداخت‌ها، اعتبار تهاتر و کیف پول شخصی شما را پیگیری می‌کند و فقط اطلاعات خودتان را نشان می‌دهد.',
  }[role] || ''

  const greeting = role === 'member'
    ? `سلام ${u.full_name} عزیز! این خلاصه وضعیت حساب شماست؛ برای هر موضوع پرسش کنید یا از اقدام‌های پیشنهادی استفاده کنید.`
    : `سلام ${u.full_name} عزیز! این خلاصه وضعیت شرکت از نگاه نقش «${roleLabels[role]}» شماست؛ هر کارت اقدام مستقیم دارد و فقط بخش‌های مجاز شما نشان داده می‌شود.`

  return {
    role, role_label: roleLabels[role] || role,
    full_name: u.full_name,
    greeting, role_guide: roleGuide,
    stats, chips, insights,
    disclaimer: 'پاسخ‌ها بر پایه داده واقعی سامانه تولید می‌شود؛ تصمیم نهایی با کاربر و فرایند مصوب شرکت است.',
  }
}

export function askAssistant (d, u, question) {
  const q = norm(question)
  if (!q) throw new HttpError(400, 'متن پرسش خالی است')
  const s = d.settings
  const perm = (moduleKey) => permOf(s, u.role, moduleKey)
  const snap = companySnap(d)
  const mSnap = u.role === 'member' && u.member_id ? memberSnap(d, u.member_id) : null
  return { ...answer(d, u, snap, mSnap, q, perm), role: u.role, role_label: roleLabels[u.role] || u.role }
}
