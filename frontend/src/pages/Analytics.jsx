import React, { useEffect, useState } from 'react'
import { call } from '../api/index.js'
import { Empty, Icon } from '../ui/components.jsx'

export default function Analytics () {
  const [items, setItems] = useState(null)
  useEffect(() => { call('GET', '/api/analytics').then(setItems) }, [])

  if (!items) return <div className="page"><div className="card pad center muted">در حال تحلیل داده‌ها…</div></div>

  const icons = { growth: '📈', duplicate: '🔍', cash_forecast: '💧', due: '⏰' }
  const sevBadge = { danger: 'b-danger', warning: 'b-pending', info: 'b-info' }

  return (
    <div className="page">
      <div className="alert info">
        <Icon name="analytics" size={17} />
        <div><b>چگونه کار می‌کند؟</b>
          همه تحلیل‌ها با «قواعد قطعی» روی داده واقعی محاسبه می‌شوند (نه مدل زبانی)، فرض‌های هر قاعده صریح اعلام می‌شود و به اسناد مرتبط ارجاع دارد. هیچ تحلیلی به‌تنهایی سند مالی ایجاد یا اصلاح نمی‌کند.
        </div>
      </div>

      {items.length === 0 && (
        <div className="card pad center">
          <div className="empty-icon">✨</div>
          <b>در داده‌های فعلی هیچ مورد غیرعادی‌ای شناسایی نشد</b>
          <div className="small muted">قواعد: رشد هزینه، تکراری‌ها، نقدینگی، سررسیدها — همه در وضعیت مطلوب‌اند</div>
        </div>
      )}

      {items.map((it, i) => (
        <div className="card mb" key={i}>
          <div className="card-head">
            <span style={{ fontSize: 22 }}>{icons[it.type]}</span>
            <h3>{it.title}</h3>
            <span className={`badge ${sevBadge[it.severity]}`} style={{ marginRight: 'auto' }}>
              {({ danger: 'اولویت بالا', warning: 'بررسی شود', info: 'اطلاع‌رسانی' })[it.severity]}
            </span>
          </div>
          <div className="pad">
            <div style={{ fontSize: 14, lineHeight: 2 }}>{it.text}</div>
            <div className="small muted" style={{ marginTop: 8 }}>
              ارجاع داده: {it.refs.join(' • ')}
              {it.assumptions && <> — فرض‌ها: {it.assumptions}</>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
