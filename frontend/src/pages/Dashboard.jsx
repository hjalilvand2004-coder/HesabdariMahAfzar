import React, { useEffect, useMemo, useState } from 'react'
import { useApp, navigate } from '../App.jsx'
import { call } from '../api/index.js'
import { Icon, BarChart, LineChart, HBar, Progress, Badge, JDateText, Empty } from '../ui/components.jsx'
import { DrillBox } from '../ui/Drill.jsx'
import { fmtMoneyShort, fmtMoney, actionLabels, faNum, faDigit } from '../lib/format.js'
import { monthName, formatJalali } from '../lib/jalali.js'

export default function Dashboard () {
  const { user, settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [d, setD] = useState(null)
  const [drillMonth, setDrillMonth] = useState(null)
  const [guideOpen, setGuideOpen] = useState(() => !localStorage.getItem('maliyar_guide_seen'))
  const { refreshSettings } = useApp()

  const load = () => call('GET', '/api/dashboard').then(setD).catch(() => {})
  useEffect(() => { load() }, [])

  const dismissGuide = () => { localStorage.setItem('maliyar_guide_seen', '1'); setGuideOpen(false) }

  // ————— دریل‌داون هزینه‌ها (سه سطح: دسته ← پروژه ← اسناد) —————
  // useMemo تا identity پایدار بماند و DrillBox بی‌دلیل reload نکند
  const expenseDrill = useMemo(() => [
    {
      kind: 'bars', label: 'دسته هزینه',
      load: async () => (await call('GET', '/api/reports/expense-drill', null, drillMonth ? { level: 1, month: drillMonth } : { level: 1 })),
    },
    {
      kind: 'bars', label: 'پروژه',
      load: async (c) => (await call('GET', '/api/reports/expense-drill', null, { level: 2, cat: c.key, ...(drillMonth ? { month: drillMonth } : {}) })),
    },
    {
      kind: 'table', label: 'اسناد',
      load: async (c, p) => {
        const r = await call('GET', '/api/reports/expense-drill', null, { level: 3, cat: c.key, project: p.key, ...(drillMonth ? { month: drillMonth } : {}) })
        return {
          total: r.total,
          cols: [{ label: 'شماره سند' }, { label: 'تاریخ' }, { label: 'شرح' }, { label: 'حساب' }, { label: 'مبلغ', num: true }],
          rows: r.rows.map(x => [x.voucher_no, formatJalali(x.date), x.desc, x.account, fmtMoney(x.amount, unit)]),
        }
      },
    },
  ], [drillMonth, unit])

  // ————— دریل‌داون تأمین مالی (سه سطح: مصوبه ← عضو ← جزئیات تعهد) —————
  const fundingDrill = useMemo(() => [
    {
      kind: 'bars', label: 'مصوبه',
      load: async () => (d?.fundings || []).map(f => ({
        key: f.id, label: `${f.no} — ${f.title}`, labelShort: f.no, value: f.amount,
        extra: `وصول ${faNum(f.progress)}٪`, showZero: true,
      })),
    },
    {
      kind: 'bars', label: 'سهم اعضا',
      load: async (f) => {
        const r = await call('GET', `/api/funding/${f.key}`)
        return {
          rows: r.commitments.map(c => ({
            key: c.member_id, label: c.member_name, labelShort: c.member_name,
            value: c.amount, extra: `پرداخت/تهاتر ${fmtMoneyShort(c.paid, unit)} — مانده ${fmtMoneyShort(c.remaining, unit)}`,
          })),
          total: r.commitments.reduce((s, c) => s + c.amount, 0),
        }
      },
    },
    {
      kind: 'table', label: 'جزئیات تعهد',
      load: async (f, m) => {
        const st = await call('GET', `/api/members/${m.key}/statement`)
        const c = st.commitments.find(x => x.funding_id === f.key)
        if (!c) return { rows: [], cols: [{ label: 'بخش' }, { label: 'مقدار', num: true }] }
        return {
          rows: [
            ['عنوان مصوبه', `${st.commitments.find(x => x.funding_id === f.key)?.funding_title || ''}`],
            ['سهم مصوب این عضو', fmtMoney(c.amount, unit)],
            ['پرداخت و تهاتر انجام‌شده', fmtMoney(c.paid, unit)],
            ['مانده تعهد', fmtMoney(c.remaining, unit)],
            ['سررسید', c.due_date ? formatJalali(c.due_date) : '—'],
            ['وضعیت', c.settled ? 'تسویه کامل' : c.paid > 0 ? 'بخشی پرداخت‌شده' : 'پرداخت‌نشده'],
          ],
          cols: [{ label: 'بخش' }, { label: 'مقدار', num: true }],
        }
      },
    },
  ], [d?.fundings, unit])

  // early return فقط پس از همه هوک‌ها
  if (!d) return <div className="page"><div className="card pad center muted">در حال دریافت اطلاعات…</div></div>

  const profit = d.pnl_year.profit
  const collectedPct = d.funding.approved_amount ? Math.round(d.funding.collected * 100 / d.funding.approved_amount) : 0
  const monthly = d.monthly.map(m => {
    const [y, mm] = m.month.split('-')
    return { label: monthName(Number(mm)), values: [m.income, m.expense], series: ['درآمد', 'هزینه'], mk: m.month }
  })

  return (
    <div className="page">
      {/* بنر راهنمای جامع — تا اولین بستن نمایش داده می‌شود */}
      {guideOpen && (
        <div className="guide-banner mb">
          <div className="guide-banner-icon"><Icon name="book" size={22} /></div>
          <div className="guide-banner-text">
            <b>برای اولین بار اینجا هستید؟</b>
            راهنمای جامع سامانه در ۹ بخش، منطق کامل مالی شرکت را توضیح می‌دهد:
            چگونه سهامداران بابت هزینه‌های شرکت مشارکت می‌کنند، سهم هر نفر چطور از درصد سهام محاسبه می‌شود،
            تهاتر و جبران خدمات چگونه اعمال می‌شود و تراز نهایی تسویه چگونه به‌دست می‌آید.
            کنار عنوان هر صفحه هم دکمه «؟» راهنمای همان بخش را باز می‌کند.
          </div>
          <div className="guide-banner-actions">
            <a href="#" className="btn btn-primary btn-sm" onClick={(e) => { e.preventDefault(); window.location.hash = '#maliyar-guide'; window.dispatchEvent(new Event('open-maliyar-guide')) }}>
              <Icon name="book" size={15} /> باز کردن راهنمای جامع
            </a>
            <button className="btn btn-ghost btn-sm" onClick={dismissGuide}>نمایش دوباره نده</button>
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat s1">
          <span className="stat-icon"><Icon name="wallet" size={34} /></span>
          <div className="stat-label">موجودی نقد و بانک</div>
          <div className="stat-value num">{fmtMoneyShort(d.cash_total, unit)}</div>
          <div className="stat-foot">در سال مالی {d.fiscal.label?.toLocaleString('fa-IR')}</div>
        </div>
        <div className="stat s2">
          <span className="stat-icon"><Icon name="reports" size={34} /></span>
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
          <div className="stat-foot">خدمات در انتظار جبران: {fmtMoneyShort(d.services.pending_amount, unit)} — بدهی به فروشندگان: {fmtMoneyShort(d.unpaid_expenses, unit)}</div>
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
              <span className="legend-item"><i style={{ background: 'var(--chart-income)' }} />درآمد</span>
              <span className="legend-item"><i style={{ background: 'var(--chart-expense)' }} />هزینه</span>
            </div>
          </div>
          <div className="pad">
            {drillMonth && (
              <div className="month-chip">
                فیلتر تحلیل هزینه: <b>{monthName(Number(drillMonth.split('-')[1]))} {faDigit(drillMonth.split('-')[0])}</b>
                <button onClick={() => setDrillMonth(null)} title="حذف فیلتر ماه"><Icon name="x" size={12} /></button>
              </div>
            )}
            {monthly.length
              ? <LineChart data={monthly} unit={unit} onItemClick={(it) => { if (it.mk) setDrillMonth(it.mk) }} />
              : <Empty text="هنوز تراکنشی ثبت نشده است" />}
            <div className="small muted" style={{ marginTop: 6 }}>
              💡 روی هر ماه کلیک کنید تا تحلیل هزینه‌های همان ماه در سطح‌های بعدی باز شود.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>وضعیت تعهد اعضا</h3>
            <div className="spacer" />
            {user.role !== 'member' && <a href="#/profiles" className="btn btn-ghost btn-sm">پروفایل اشخاص</a>}
          </div>
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {d.members.filter(m => m.commitment > 0).map((m, i) => {
              const pct = m.commitment ? Math.round(m.paid * 100 / m.commitment) : 0
              return (
                <div key={m.id} className="member-progress" onClick={() => { navigate(`/profile/${m.id}`) }}
                  title="مشاهده پروفایل کامل مالی">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <b style={{ fontSize: 13.5 }}>
                      <span style={{ color: ['var(--primary)', '#d97706', '#059669', '#e11d48', '#7c3aed', '#0891b2'][i % 6], marginRight: 6 }}>●</span>
                      {m.name}
                      <span className="muted small" style={{ marginRight: 8 }}>({(m.share_bp / 100).toLocaleString('fa-IR')}٪ سهم)</span>
                    </b>
                    <span className="small num">{fmtMoney(m.paid, unit)} / {fmtMoney(m.commitment, unit)}</span>
                  </div>
                  <Progress pct={pct} green={pct >= 100} />
                  <div className="small muted num" style={{ marginTop: 3 }}>
                    مانده تعهد: {fmtMoney(m.remaining, unit)} — برای پروفایل کامل کلیک کنید
                  </div>
                </div>
              )
            })}
            {!d.members.some(m => m.commitment > 0) && <Empty text="مصوبه تأمین مالی فعالی وجود ندارد" />}
          </div>
        </div>
      </div>

      {/* دریل‌داون هزینه‌ها */}
      <div className="card mb">
        <div className="card-head">
          <h3>تحلیل هزینه‌ها — با دریل‌داون تا سه سطح</h3>
          <div className="spacer" />
          <span className="badge b-info">دسته ← پروژه ← اسناد</span>
        </div>
        <div className="pad">
          <DrillBox unit={unit} levels={expenseDrill} rootLabel="همه دسته‌های هزینه"
            hint="روی هر میله کلیک کنید تا وارد سطح بعدی شوید؛ در سطح سوم فهرست اسناد قطعی همان بخش نمایش داده می‌شود." />
        </div>
      </div>

      <div className="grid-3r mb">
        <div className="card">
          <div className="card-head">
            <h3>تأمین مالی اعضا — دریل‌داون</h3>
            <div className="spacer" />
            <span className="badge b-info">مصوبه ← عضو ← جزئیات</span>
          </div>
          <div className="pad">
            <DrillBox unit={unit} levels={fundingDrill} rootLabel="همه مصوبه‌ها"
              hint="روی هر مصوبه کلیک کنید تا سهم اعضا و سپس جزئیات تعهد هر عضو باز شود." />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>هزینه به تفکیک پروژه</h3></div>
          <div className="pad">
            {d.projects.length
              ? <BarChart data={d.projects.slice(0, 5).map(p => ({ label: p.name, values: [p.amount], series: [p.name] }))} unit={unit} height={190}
                  onItemClick={(it) => { navigate('/expenses') }} />
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
