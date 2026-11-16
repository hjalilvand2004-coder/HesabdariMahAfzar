import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Icon, BarChart, LineChart, Donut, Progress, Badge, JDateText, Empty } from '../ui/components.jsx'
import { fmtMoneyShort, fmtMoney, actionLabels } from '../lib/format.js'
import { monthName } from '../lib/jalali.js'

export default function Dashboard () {
  const { user, settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [d, setD] = useState(null)

  useEffect(() => { call('GET', '/api/dashboard').then(setD).catch(() => {}) }, [])

  if (!d) return <div className="page"><div className="card pad center muted">در حال دریافت اطلاعات…</div></div>

  const profit = d.pnl_year.profit
  const collectedPct = d.funding.approved_amount ? Math.round(d.funding.collected * 100 / d.funding.approved_amount) : 0
  const monthly = d.monthly.map(m => {
    const [y, mm] = m.month.split('-')
    return { label: monthName(Number(mm)), values: [m.income, m.expense], series: ['درآمد', 'هزینه'] }
  })
  const memberColors = ['#4f46e5', '#0ea5a4', '#f59e0b', '#ef4444', '#7c3aed', '#0284c7']

  return (
    <div className="page">
      <div className="stat-grid">
        <div className="stat s1">
          <span className="stat-icon"><Icon name="wallet" size={34} /></span>
          <div className="stat-label">موجودی نقد و بانک</div>
          <div className="stat-value num">{fmtMoneyShort(d.cash_total, unit)}</div>
          <div className="stat-foot">در سال مالی {d.fiscal.label?.toLocaleString('fa-IR')}</div>
        </div>
        <div className="stat s2">
          <span className="stat-icon"><Icon name="pie" size={34} /></span>
          <div className="stat-label">سود (زیان) دوره</div>
          <div className="stat-value num">{fmtMoneyShort(profit, unit)}</div>
          <div className="stat-foot">
            درآمد {fmtMoneyShort(d.pnl_year.total_revenue, unit)} | هزینه {fmtMoneyShort(d.pnl_year.total_expense, unit)}
          </div>
        </div>
        <div className="stat s6">
          <span className="stat-icon"><Icon name="funding" size={34} /></span>
          <div className="stat-label">تأمین مالی اعضا</div>
          <div className="stat-value num">{fmtMoneyShort(d.funding.collected, unit)}</div>
          <div className="stat-foot">از {fmtMoneyShort(d.funding.approved_amount, unit)} مصوب ({collectedPct.toLocaleString('fa-IR')}٪)</div>
        </div>
        <div className="stat s3">
          <span className="stat-icon"><Icon name="alert" size={34} /></span>
          <div className="stat-label">تعهد وصول‌نشده اعضا</div>
          <div className="stat-value num">{fmtMoneyShort(d.funding.remaining, unit)}</div>
          <div className="stat-foot">بدهی به فروشندگان: {fmtMoneyShort(d.unpaid_expenses, unit)}</div>
        </div>
      </div>

      {d.alerts.length > 0 && (
        <div className="mb">
          {d.alerts.map((a, i) => (
            <div key={i} className={`alert ${a.severity}`}>
              <Icon name="alert" size={17} />
              <div><b>{a.title}</b>{a.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-3 mb">
        <div className="card">
          <div className="card-head">
            <h3>روند درآمد و هزینه (ماه‌های اخیر)</h3>
            <div className="spacer" />
            <div className="legend-row" style={{ marginTop: 0 }}>
              <span className="legend-item"><i style={{ background: '#4f46e5' }} />درآمد</span>
              <span className="legend-item"><i style={{ background: '#10b981' }} />هزینه</span>
            </div>
          </div>
          <div className="pad">
            {monthly.length
              ? <LineChart data={monthly} unit={unit} />
              : <Empty text="هنوز تراکنشی ثبت نشده است" />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>ترکیب هزینه‌ها</h3></div>
          <div className="pad">
            {d.categories.length
              ? <Donut items={d.categories.map(c => ({ label: c.name, value: c.amount }))} unit={unit} />
              : <Empty text="هزینه‌ای در این دوره ثبت نشده است" />}
          </div>
        </div>
      </div>

      <div className="grid-2 mb">
        <div className="card">
          <div className="card-head">
            <h3>وضعیت تعهد اعضا</h3>
            <div className="spacer" />
            {user.role !== 'member' && <a href="#/members" className="btn btn-ghost btn-sm">جزئیات اعضا</a>}
          </div>
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {d.members.filter(m => m.commitment > 0).map((m, i) => {
              const pct = m.commitment ? Math.round(m.paid * 100 / m.commitment) : 0
              return (
                <div key={m.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <b style={{ fontSize: 13.5 }}>
                      <span style={{ color: memberColors[i % memberColors.length], marginRight: 6 }}>●</span>
                      {m.name}
                      <span className="muted small" style={{ marginRight: 8 }}>({(m.share_bp / 100).toLocaleString('fa-IR')}٪ سهم)</span>
                    </b>
                    <span className="small num">{fmtMoney(m.paid, unit)} / {fmtMoney(m.commitment, unit)}</span>
                  </div>
                  <Progress pct={pct} green={pct >= 100} />
                  <div className="small muted num" style={{ marginTop: 3 }}>
                    مانده تعهد: {fmtMoney(m.remaining, unit)}
                  </div>
                </div>
              )
            })}
            {!d.members.some(m => m.commitment > 0) && <Empty text="مصوبه تأمین مالی فعالی وجود ندارد" />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>هزینه به تفکیک پروژه</h3></div>
          <div className="pad">
            {d.projects.length
              ? <BarChart data={d.projects.slice(0, 5).map(p => ({ label: p.name, values: [p.amount], series: [p.name] }))} unit={unit} />
              : <Empty text="هزینه‌ای با پروژه ثبت نشده است" />}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>آخرین رویدادهای سامانه</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>زمان</th><th>کاربر</th><th>اقدام</th><th>موضوع</th></tr></thead>
            <tbody>
              {d.recent_activity.map(a => (
                <tr key={a.id}>
                  <td><JDateText iso={a.ts.slice(0, 10)} /></td>
                  <td>{a.username}</td>
                  <td><Badge k="b-info" text={actionLabels[a.action] || a.action} /></td>
                  <td>{a.entity} #{a.entity_id?.toLocaleString('fa-IR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
