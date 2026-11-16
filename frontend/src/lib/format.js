// قالب‌بندی مبالغ و اعداد فارسی — مبالغ پایه همیشه ریال است
export const faNum = (n) => (n === 0 || n ? Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 0 }) : '۰')

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
