import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatJalali, todayIso, isoToJalali, jalaliToIso, JMONTHS, jalaliMonthLength, currentJYear } from '../lib/jalali.js'
import { parseMoney, groupMoney, fmtMoney, faNum } from '../lib/format.js'
import { useApp } from '../App.jsx'
import { useToast } from './Toast.jsx'

/* ================= آیکون‌ها (استروک، ۲۴×۲۴) ================= */
const PATHS = {
  dashboard: 'M3 12h7V3H3v9Zm0 9h7v-6H3v6Zm11 0h7V9h-7v12Zm0-15v3h7V6h-7Z',
  expenses: 'M4 7h16M4 12h16M4 17h10 | circle cx=18 cy=17 r=2.6',
  funding: 'M12 3v18M7 7h7a3.5 3.5 0 0 1 0 7H8a3.5 3.5 0 0 0 0 7h9',
  payments: 'M3 7h18v10H3zM3 10h18 | circle cx=16.5 cy=12.5 r=1.6',
  members: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-12 9c1.6-3 4.2-4.5 8-4.5S18.4 17 20 20',
  accounts: 'M4 4h16v16H4zM8 4v16M4 9h4M4 14h4',
  vouchers: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 7h6M9 11h6',
  reports: 'M4 20V9m5 11V4m5 16v-8m5 8V7',
  statements: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h3',
  analytics: 'M5 19V12m4.5 7V6m4.5 13v-9m4.5 9V9 | circle cx=18 cy=5.5 r=1.6',
  audit: 'M12 3a9 9 0 1 0 9 9 | M12 7v5l3.5 2',
  users: 'M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  help: 'circle cx=12 cy=12 r=9 | M9.3 9.2a2.8 2.8 0 0 1 5.5.7c0 1.6-2.3 2.2-2.8 3.5 | M12 16.8h.01',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 | M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z',
  services: 'M14.2 6.4a4.3 4.3 0 0 1-6.1 4.9L4.6 14.8a1.8 1.8 0 0 0 0 2.6l2 2a1.8 1.8 0 0 0 2.6 0l3.5-3.5a4.3 4.3 0 0 1 4.9-6.1l-2.6 2.6-2.3-2.3 2.6-2.6Z',
  idcard: 'M3 5.5h18v13H3zM7.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 16.5c.4-1.5 1.4-2 2.5-2s2.1.5 2.5 2 | M14.5 10h4M14.5 13.5h4',
  chevronL: 'M14 6l-6 6 6 6',
  chevronR: 'M10 6l6 6-6 6',
  sparkle: 'M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z | circle cx=12 cy=12 r=3',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16',
  upload: 'M12 21V9m0 0 4 4m-4-4-4 4M4 3h16',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-8 | circle cx=16 cy=16 r=1.4',
  bank: 'M3 10l9-7 9 7M4 10v10M8 20v-7M12 20v-7M16 20v-7M20 10v10M2 20h20',
  clock: 'circle cx=12 cy=12 r=9 | M12 7v5l3 3',
  alert: 'M12 2 2 20h20L12 2Zm0 6v5m0 3v.5',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  search: 'circle cx=11 cy=11 r=7 | M21 21l-4.3-4.3',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4',
  arrowL: 'M19 12H5m0 0 6 6m-6-6 6-6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  pie: 'M21 12A9 9 0 1 1 12 3v9h9Z',
  doc: 'M14 2H6v20h12V8l-4-6Zm0 0v6h6M9 13h6M9 17h6',
  scale: 'M12 3v18M5 8l7-3 7 3M5 8l-3 6a3.5 3.5 0 0 0 6 0L5 8Zm14 0 3 6a3.5 3.5 0 0 1-6 0l3-6Z',
  sun: 'circle cx=12 cy=12 r=4.4 | M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6',
  moon: 'M20.6 14.2A8.8 8.8 0 1 1 9.8 3.4a7 7 0 1 0 10.8 10.8Z',
  checkCircle: 'circle cx=12 cy=12 r=9 | M8.5 12.3l2.4 2.4 4.8-5',
  xCircle: 'circle cx=12 cy=12 r=9 | M9 9l6 6M15 9l-6 6',
  info: 'circle cx=12 cy=12 r=9 | M12 11v5M12 7.8h.01',
}

export function Icon ({ name, size = 19, stroke = 1.7 }) {
  const raw = PATHS[name] || ''
  const parts = raw.split('|')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}
      aria-hidden="true">
      {parts.map((p, i) => {
        p = p.trim()
        if (p.startsWith('circle')) {
          const [, attrs] = p.split(' ')
          const m = p.match(/cx=([\d.]+) cy=([\d.]+) r=([\d.]+)/)
          return m ? <circle key={i} cx={m[1]} cy={m[2]} r={m[3]} /> : null
        }
        return <path key={i} d={p} />
      })}
    </svg>
  )
}

/* ================= نشان وضعیت ================= */
const BADGE_MAP = {
  draft: ['b-draft', 'پیش‌نویس'], pending: ['b-pending', 'در انتظار تأیید'],
  approved: ['b-approved', 'تأییدشده'], rejected: ['b-rejected', 'ردشده'],
  unpaid: ['b-unpaid', 'پرداخت‌نشده'], partial: ['b-partial', 'بخشی پرداخت‌شده'],
  paid: ['b-paid', 'تسویه‌شده'], declared: ['b-declared', 'اعلام‌شده'],
  confirmed: ['b-confirmed', 'قطعی'], current: ['b-info', 'جاری شرکا'],
  loan: ['b-muted', 'وام عضو'], capital: ['b-approved', 'افزایش سرمایه'],
  expense: ['b-info', 'هزینه'], asset: ['b-muted', 'دارایی'], deposit: ['b-muted', 'ودیعه'],
  person: ['b-info', 'حقیقی'], legal: ['b-muted', 'حقوقی'],
}
export function Badge ({ k, text }) {
  const [cls, label] = BADGE_MAP[k] || ['b-muted', k]
  return <span className={`badge ${cls}`}>{text || label}</span>
}

/* ================= مودال ================= */
export function Modal ({ title, children, onClose, wide, foot }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="close" onClick={onClose} aria-label="بستن"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}

/* ================= تایید ================= */
export function Confirm ({ title, message, onYes, onNo, danger }) {
  return (
    <Modal title={title} onClose={onNo} foot={
      <>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onYes}>تأیید</button>
        <button className="btn btn-ghost" onClick={onNo}>انصراف</button>
      </>
    }>
      <p style={{ fontSize: 14.5, lineHeight: 2 }}>{message}</p>
    </Modal>
  )
}

/* ================= ورودی مبلغ (تومان/ریال) ================= */
export function MoneyInput ({ value, onChange, unit, placeholder }) {
  const [text, setText] = useState(value ? groupMoney(String(value / (unit === 'toman' ? 10 : 1))) : '')
  const ref = useRef(null)
  useEffect(() => {
    const el = document.activeElement
    if (el !== ref.current) {
      const rial = Number(value || 0)
      setText(rial ? groupMoney(String(rial / (unit === 'toman' ? 10 : 1))) : '')
    }
  }, [value, unit])
  return (
    <input ref={ref} className="input num" inputMode="numeric" placeholder={placeholder || '۰'}
      value={text}
      onChange={(e) => {
        const n = parseMoney(e.target.value)
        setText(e.target.value === '' ? '' : n ? groupMoney(String(n)) : '')
        onChange(n * (unit === 'toman' ? 10 : 1) || null)
      }} />
  )
}

export function Money ({ rial, unit, bold }) {
  return <span className="num" style={bold ? { fontWeight: 700 } : null}>{fmtMoney(rial, unit)}</span>
}

/* ================= ورودی تاریخ شمسی ================= */
export function JDate ({ value, onChange, from = 1390, to }) {
  const [jy, jm, jd] = value ? isoToJalali(value) : [null, null, null]
  const endY = to || currentJYear() + 1
  const years = useMemo(() => {
    const arr = []
    for (let y = endY; y >= from; y--) arr.push(y)
    return arr
  }, [from, endY])
  const days = jd && jy && jm ? jalaliMonthLength(jy, jm) : 31
  const upd = (y, m, d) => {
    if (!y || !m || !d) return onChange(null)
    const dd = Math.min(d, jalaliMonthLength(y, m))
    onChange(jalaliToIso(y, m, dd))
  }
  return (
    <div className="jdate">
      <select className="input" value={jy || ''} onChange={(e) => upd(Number(e.target.value), jm || 1, jd || 1)}>
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y.toLocaleString('fa-IR')}</option>)}
      </select>
      <select className="input" value={jm || ''} onChange={(e) => upd(jy || endY - 15, Number(e.target.value), jd || 1)}>
        <option value="">ماه</option>
        {JMONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}
      </select>
      <select className="input" value={jd || ''} onChange={(e) => upd(jy || endY - 15, jm || 1, Number(e.target.value))}>
        <option value="">روز</option>
        {Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d.toLocaleString('fa-IR')}</option>)}
      </select>
      <button type="button" className="btn btn-ghost btn-sm" title="امروز" onClick={() => onChange(todayIso())}>امروز</button>
    </div>
  )
}

/* ================= رنگ‌های نمودار (سازگار با تم) ================= */
const C_INCOME = 'var(--chart-income, #059669)'
const C_EXPENSE = 'var(--chart-expense, #e11d48)'
const C_GRID = 'var(--chart-grid, #e2eae6)'
const C_TEXT = 'var(--ink-3, #7e968d)'
const C_PRIMARY = 'var(--primary, #0f766e)'

/* ================= نمودار میله‌ای ================= */
export function BarChart ({ data, height = 220, money = true, unit = 'toman', colors = [C_PRIMARY, C_EXPENSE], onItemClick }) {
  if (!data.length) return <div className="empty">داده‌ای برای نمایش نیست</div>
  const max = Math.max(...data.flatMap(d => d.values))
  const W = 640, H = height, padB = 34, padT = 16
  const gw = (W - 20) / data.length
  const bw = Math.min(30, gw / (data[0].values.length + 1.2))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ direction: 'ltr' }} role="img" aria-label="نمودار میله‌ای">
      <defs>
        {colors.map((c, i) => (
          <linearGradient key={i} id={`bg${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: c, stopOpacity: 0.95 }} />
            <stop offset="100%" style={{ stopColor: c, stopOpacity: 0.4 }} />
          </linearGradient>
        ))}
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1="10" x2={W - 10} y1={padT + (H - padB - padT) * (1 - f)} y2={padT + (H - padB - padT) * (1 - f)}
          style={{ stroke: C_GRID }} strokeDasharray="3 4" />
      ))}
      {data.map((d, i) => {
        const x0 = 10 + i * gw
        const clickable = onItemClick && d.values.length === 1
        return (
          <g key={d.label} className={clickable ? 'chart-click' : ''} onClick={clickable ? () => onItemClick(d) : undefined}>
            {d.values.map((v, j) => {
              const h = max ? (v / max) * (H - padB - padT) : 0
              const x = x0 + gw / 2 - (bw * d.values.length) / 2 + j * bw + 2
              return (
                <g key={j}>
                  <rect x={x} y={H - padB - h} width={bw - 4} height={Math.max(h, 2)} rx="6"
                    fill={`url(#bg${j})`}>
                    <title>{`${d.series?.[j] || ''}: ${fmtMoney(v, unit)}`}</title>
                  </rect>
                </g>
              )
            })}
            <text x={x0 + gw / 2} y={H - 12} textAnchor="middle" className="chart-tip"
              style={{ fill: C_TEXT }}>{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* ================= نمودار خطی ================= */
export function LineChart ({ data, height = 230, unit = 'toman', onItemClick }) {
  if (!data.length) return <div className="empty">داده‌ای برای نمایش نیست</div>
  const W = 660, H = height, padB = 36, padT = 18, padS = 12
  const max = Math.max(1, ...data.flatMap(d => d.values))
  const iw = W - padS * 2
  const ih = H - padB - padT
  const step = data.length > 1 ? iw / (data.length - 1) : 0
  const pts = data.map((d, i) => d.values.map((v, j) => [padS + i * step, padT + ih - (v / max) * ih]))
  const line = (j) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[j][0]},${p[j][1]}`).join(' ')
  const area = (j) => `${line(j)} L${padS + (data.length - 1) * step},${padT + ih} L${padS},${padT + ih} Z`
  const seriesColors = [C_INCOME, C_EXPENSE]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ direction: 'ltr' }} role="img" aria-label="نمودار روند">
      <defs>
        <linearGradient id="lg0" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: C_INCOME, stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: C_INCOME, stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: C_EXPENSE, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: C_EXPENSE, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={padS} x2={W - padS} y1={padT + ih * (1 - f)} y2={padT + ih * (1 - f)}
          style={{ stroke: C_GRID }} strokeDasharray="3 4" />
      ))}
      <path d={area(0)} fill="url(#lg0)" />
      <path d={area(1)} fill="url(#lg1)" />
      <path d={line(0)} fill="none" style={{ stroke: C_INCOME }} strokeWidth="2.6" strokeLinecap="round" />
      <path d={line(1)} fill="none" style={{ stroke: C_EXPENSE }} strokeWidth="2.6" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i} className={onItemClick ? 'chart-click' : ''} onClick={onItemClick ? () => onItemClick(data[i]) : undefined}>
          {p.map((pt, j) => <circle key={j} cx={pt[0]} cy={pt[1]} r="3.4" fill="var(--card, #fff)"
            style={{ stroke: seriesColors[j] }} strokeWidth="2">
            <title>{`${data[i].series?.[j] || ''}: ${fmtMoney(data[i].values[j], unit)}`}</title>
          </circle>)}
          <text x={p[0][0]} y={H - 12} textAnchor="middle" className="chart-tip"
            style={{ fill: C_TEXT }}>{data[i].label}</text>
        </g>
      ))}
    </svg>
  )
}

/* ================= نمودار میله‌ای افقی (رتبه‌بندی — با دریل‌داون) ================= */
export function HBar ({ items, unit = 'toman', onItemClick, maxHeight = 360, compact = false, emptyText }) {
  const usable = (items || []).filter(i => i.value > 0 || i.showZero)
  if (!usable.length) return <Empty text={emptyText || 'داده‌ای برای نمایش نیست'} />
  const total = usable.reduce((s, i) => s + i.value, 0) || 1
  const max = Math.max(...usable.map(i => i.value)) || 1
  return (
    <div className="hbar" style={{ maxHeight, overflowY: 'auto' }}>
      {usable.map((it, i) => {
        const pct = Math.round(it.value * 100 / total)
        const w = Math.max(3, Math.round(it.value * 100 / max))
        return (
          <div key={i}
            className={`hbar-row ${onItemClick ? 'clickable' : ''} ${it.dim ? 'dim' : ''}`}
            onClick={onItemClick ? () => onItemClick(it) : undefined}
            title={onItemClick ? 'برای مشاهده سطح بعدی کلیک کنید' : undefined}>
            <span className="hbar-rank num">{faNum(i + 1)}</span>
            <div className="hbar-mid">
              <div className="hbar-topline">
                <span className="hbar-label">{it.label}{it.extra && <em className="small muted"> {it.extra}</em>}</span>
                <span className="hbar-value num">
                  {it.plain ? faNum(it.value) : fmtMoney(it.value, unit)}
                  <i className="hbar-pct">{faNum(pct)}٪</i>
                </span>
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${w}%`, background: it.color || undefined }} />
              </div>
            </div>
            {onItemClick && <span className="hbar-go"><Icon name="chevronL" size={13} /></span>}
          </div>
        )
      })}
    </div>
  )
}

export function Progress ({ pct, green }) {
  return <div className={`progress ${green ? 'g' : ''}`}><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
}

export function Empty ({ icon = '📁', text = 'موردی یافت نشد' }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><div>{text}</div></div>
}

export function JDateText ({ iso, withMonth }) {
  return <span className="num">{formatJalali(iso, withMonth)}</span>
}

export { useApp, useToast }
