// قالب‌بندی مبالغ و اعداد فارسی — مبالغ پایه همیشه ریال است
export const faNum = (n) => (n === 0 || n ? Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 0 }) : '۰')
// رقم فارسی بدون جداکننده (برای سال شمسی و کدها)
export const faDigit = (n) => String(n ?? '').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

// تبدیل نمایشی ریال به واحد نمایش (تومان = ÷۱۰)
export function fmtMoney (rial, unit = 'toman') {
  const v = Math.round(Number(rial || 0))
  if (unit === 'rial') return faNum(v) + ' ریال'
  return faNum(v / 10) + ' تومان'
}

export function fmtMoneyShort (rial, unit = 'toman') {
  const v = Math.round(Number(rial || 0))
  const base = unit === 'rial' ? v : v / 10
  const abs = Math.abs(base)
  const s = (num, suffix) => `${faNum(num)} ${suffix}`
  if (abs >= 1e9) return s(base / 1e9, unit === 'rial' ? 'میلیارد ریال' : 'میلیارد تومان')
  if (abs >= 1e6) return s(base / 1e6, unit === 'rial' ? 'میلیون ریال' : 'میلیون تومان')
  return fmtMoney(rial, unit)
}

export function fmtBp (bp) {
  const pct = Math.round(bp / 100 * 100) / 100
  return faNum(pct) + '٪'
}

// ورودی مبالغ: رشته با جداکننده هزارگان → عدد
export function parseMoney (str) {
  if (!str) return 0
  const digits = String(str)
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[^\d]/g, '')
  return parseInt(digits || '0', 10)
}

export function groupMoney (str) {
  const v = parseMoney(str)
  return v ? v.toLocaleString('en-US') : ''
}

export const statusLabels = {
  draft: 'پیش‌نویس', pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده',
  unpaid: 'پرداخت‌نشده', partial: 'بخشی پرداخت‌شده', paid: 'تسویه‌شده',
  declared: 'اعلام‌شده (در انتظار وصول)', confirmed: 'قطعی',
  current: 'جاری شرکا', loan: 'وام عضو', capital: 'افزایش سرمایه',
  share: 'متناسب با درصد سهام', equal: 'مساوی بین اعضا', custom: 'درصدهای توافقی', fixed: 'مبلغ ثابت هر عضو',
  person: 'شخص حقیقی', legal: 'شخص حقوقی', expense: 'هزینه عملیاتی', asset: 'خرید دارایی', deposit: 'پیش‌پرداخت/ودیعه',
  cash: 'نقدی', transfer: 'انتقال بانکی', cheque: 'چک',
}

export const roleLabels = {
  admin: 'مدیر سامانه', finance: 'مدیر مالی', accountant: 'مسئول حسابداری',
  ceo: 'مدیرعامل / تأییدکننده', member: 'عضو / سهامدار', auditor: 'حسابرس',
}

export const actionLabels = {
  create: 'ایجاد', update: 'ویرایش', delete: 'حذف', approve: 'تأیید', reject: 'رد',
  submit: 'ارسال برای تأیید', confirm: 'قطعی‌سازی', reverse: 'ابطال سند',
  post_voucher: 'ثبت سند خودکار', allocate: 'تخصیص به تعهد', declare: 'اعلام پرداخت',
  settle: 'تسویه فروشنده', login: 'ورود به سامانه', upload: 'بارگذاری پیوست',
  close_period: 'بستن دوره', open_period: 'بازگشایی دوره', deactivate: 'غیرفعال‌سازی',
  seed: 'ایجاد داده اولیه',
}

// ---------- خدمات اعضا ----------
export const stypeLabels = {
  legal: 'حقوقی و قراردادها', accounting: 'حسابداری و مالی', tech: 'فنی و نرم‌افزاری',
  management: 'مدیریت و مشاوره', marketing: 'بازاریابی و فروش', other: 'سایر خدمات',
}
export const serviceStatusLabels = {
  draft: 'پیش‌نویس', pending: 'در انتظار تأیید و جبران', approved: 'تأییدشده',
  compensated: 'جبران‌شده', rejected: 'ردشده',
}
export const compMethodLabels = { credit: 'از محل اعتبار حساب (تهاتر)', cash: 'پرداخت نقدی' }

// ---------- کیف پول اعضا ----------
export const walletTypeLabels = {
  charge: 'شارژ کیف پول', settle: 'تسویه تعهدات از کیف پول', spend: 'برداشت از کیف پول',
}
export const walletStatusLabels = {
  pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده', failed: 'ناموفق (بانک)',
}
export const walletMethodLabels = { gateway: 'درگاه بانک ملی', manual: 'اعلام واریز دستی' }

// ---------- مدیریت کاربران و سطح دسترسی ----------
export const MODULES = [
  { key: 'dashboard', label: 'داشبورد مدیریتی', group: 'میزکار' },
  { key: 'analytics', label: 'تحلیل‌های هوشمند', group: 'میزکار' },
  { key: 'expenses', label: 'هزینه‌ها و خریدها', group: 'عملیات مالی' },
  { key: 'funding', label: 'تأمین مالی اعضا', group: 'عملیات مالی' },
  { key: 'payments', label: 'پرداخت‌ها و وصول', group: 'عملیات مالی' },
  { key: 'wallet', label: 'کیف پول اعضا', group: 'عملیات مالی' },
  { key: 'services', label: 'خدمات اعضا و جبران خدمات', group: 'عملیات مالی' },
  { key: 'members', label: 'اعضا و سهامداران', group: 'عملیات مالی' },
  { key: 'profiles', label: 'پروفایل اشخاص', group: 'عملیات مالی' },
  { key: 'accounts', label: 'کدینگ حساب‌ها', group: 'حسابداری' },
  { key: 'vouchers', label: 'اسناد حسابداری', group: 'حسابداری' },
  { key: 'reports', label: 'دفاتر و گزارش‌ها', group: 'حسابداری' },
  { key: 'statements', label: 'صورت‌های مالی', group: 'حسابداری' },
  { key: 'audit', label: 'ردپای حسابرسی', group: 'نظارت و پیکربندی' },
  { key: 'users', label: 'مدیریت کاربران و سطح دسترسی', group: 'نظارت و پیکربندی' },
  { key: 'settings', label: 'تنظیمات', group: 'نظارت و پیکربندی' },
  { key: 'my-account', label: 'پرتال عضو (وضعیت حساب من)', group: 'میزکار' },
]

const ALL = MODULES.map(m => m.key)
const STAFF_MODULES = ALL.filter(k => k !== 'users' && k !== 'my-account')

export const DEFAULT_ROLE_PERMS = {
  admin: [...ALL],
  finance: [...STAFF_MODULES, 'audit'].filter(k => k !== 'users'),
  accountant: [...STAFF_MODULES],
  ceo: [...STAFF_MODULES],
  auditor: ['dashboard', 'analytics', 'members', 'profiles', 'accounts', 'vouchers', 'reports', 'statements', 'audit'],
  member: ['my-account', 'wallet'],
}

// دسترسی مؤثر: ماتریس ذخیره‌شده در تنظیمات، وگرنه پیش‌فرض.
// اگر ماژولی بعد از آخرین ذخیره‌ی ماتریس به سامانه اضافه شده باشد (در هیچ نقشی ثبت نشده است)
// از پیش‌فرض استاندارد استفاده می‌شود تا قابلیت جدید برای همه نقش‌های مجاز قفل نشود.
export function permOf (settings, role, moduleKey) {
  const matrix = settings?.role_perms
  if (matrix && Array.isArray(matrix[role])) {
    const known = Object.values(matrix).some(a => Array.isArray(a) && a.includes(moduleKey))
    if (!known) return (DEFAULT_ROLE_PERMS[role] || []).includes(moduleKey)
    return matrix[role].includes(moduleKey)
  }
  return (DEFAULT_ROLE_PERMS[role] || []).includes(moduleKey)
}

export function csvDownload (filename, rows, headers) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
