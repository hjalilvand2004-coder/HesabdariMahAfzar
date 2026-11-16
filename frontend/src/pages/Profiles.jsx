import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, Icon, JDateText, Money, BarChart, Empty, Progress, LoadError } from '../ui/components.jsx'
import { PageHeader } from '../ui/Help.jsx'
import { fmtMoney, fmtBp, roleLabels, stypeLabels, serviceStatusLabels, faDigit } from '../lib/format.js'
import { monthName, isoToJalali } from '../lib/jalali.js'

const idFromHash = () => {
  const m = window.location.hash.match(/^#\/profile\/(\d+)/)
  return m ? Number(m[1]) : null
}

export default function Profiles ({ settings }) {
  const unit = settings?.currency_display || 'toman'
  const { user } = useApp()
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [selId, setSelId] = useState(idFromHash())
  const [statement, setStatement] = useState(null)
  const [timeline, setTimeline] = useState(null)
  const [tab, setTab] = useState('summary')

  const loadList = () => {
    setErr('')
    call('GET', '/api/profiles').then(setList).catch(ex => setErr(ex.message || 'خطا در دریافت پروفایل‌ها'))
  }
  useEffect(() => { loadList() }, [])
  useEffect(() => {
    const onHash = () => setSelId(idFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    setStatement(null); setTimeline(null); setTab('summary')
    if (!selId) return
    call('GET', `/api/members/${selId}/statement`).then(setStatement).catch(() => {})
    call('GET', `/api/members/${selId}/timeline`).then(setTimeline).catch(() => {})
  }, [selId])

  const sel = list?.members?.find(m => m.id === selId)
  const openProfile = (id) => { window.location.hash = `/profile/${id}` }
  const backToList = () => { window.location.hash = '/profiles' }

  if (err) return <LoadError msg={err} onRetry={loadList} />
  if (!list) return <div className="page"><div className="card pad center muted">در حال دریافت پروفایل‌ها…</div></div>

  if (selId && !sel) {
    return (
      <div className="page">
        <div className="card pad center muted">
          این شخص یافت نشد یا پروفایل مالی ندارد.
          <div style={{ marginTop: 12 }}><button className="btn btn-ghost btn-sm" onClick={backToList}>بازگشت به فهرست</button></div>
        </div>
      </div>
    )
  }

  /* ---------- نمای پروفایل کامل ---------- */
  if (sel && statement) {
    const t = statement.totals
    const net = t.net_balance
    const payChart = (() => {
      const byM = {}
      for (const p of statement.payments.filter(p => p.status === 'approved')) {
        const [jy, jm] = isoToJalali(p.pay_date)
        const key = `${jy}-${String(jm).padStart(2, '0')}`
        byM[key] = (byM[key] || 0) + p.amount
      }
      return Object.keys(byM).sort().map(k => {
        const [y, m] = k.split('-')
        return { label: `${monthName(Number(m))} ${faDigit(y)}`, values: [byM[k]], series: ['پرداخت'] }
      })
    })()

    return (
      <div className="page">
        <div className="profile-back">
          <button className="btn btn-ghost btn-sm" onClick={backToList}><Icon name="chevronR" size={14} /> همه پروفایل‌ها</button>
        </div>

        {/* سرصفحه هویتی */}
        <div className="card profile-head mb">
          <div className="profile-avatar">{sel.full_name.trim().charAt(0)}</div>
          <div className="profile-id">
            <h2>{sel.full_name}</h2>
            <div className="profile-meta">
              <span className="badge b-info">{sel.code}</span>
              <Badge k={sel.kind} />
              {sel.share_now ? <span className="badge b-approved">{fmtBp(sel.share_now)} سهام</span> : <span className="badge b-muted">بدون سهم ثبت‌شده</span>}
              {sel.phone && <span className="num muted small">{sel.phone}</span>}
            </div>
          </div>
          <div className="profile-net">
            <div className="small muted">تراز نهایی حساب با شرکت</div>
            <div className={`num profile-net-val ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>
              {fmtMoney(net, unit)}
            </div>
            <div className="small muted">{net > 0 ? 'طلبِ عضو از شرکت (اعتبار تخصیص‌نیافته)' : net < 0 ? 'مانده تعهد عضو به شرکت' : 'تسویه کامل'}</div>
          </div>
        </div>

        {/* KPI */}
        <div className="stat-grid stat-grid-5 mb">
          <div className="stat s4"><div className="stat-label">تعهد مصوب (سهم از هزینه‌ها)</div><div className="stat-value num">{fmtMoney(t.commitments, unit)}</div></div>
          <div className="stat s2"><div className="stat-label">پرداخت و تهاتر انجام‌شده</div><div className="stat-value num">{fmtMoney(t.total_settled, unit)}</div></div>
          <div className="stat s3"><div className="stat-label">مانده تعهد</div><div className="stat-value num">{fmtMoney(t.commitments_remaining, unit)}</div></div>
          <div className="stat s1"><div className="stat-label">خدمات ثبت‌شده</div><div className="stat-value num">{fmtMoney(t.services_total, unit)}</div><div className="stat-foot">جبران‌شده: {fmtMoney(t.services_cash + t.services_credit, unit)}</div></div>
          <div className="stat s6"><div className="stat-label">پرداخت نقدی تأییدشده</div><div className="stat-value num">{fmtMoney(t.payments_cash, unit)}</div></div>
        </div>

        {/* تراز نهایی — دستور تسویه */}
        <div className="card mb">
          <div className="card-head"><h3>تراز نهایی و دستور تسویه (ریز محاسبه)</h3></div>
          <div className="pad">
            <table className="tbl settle-tbl">
              <tbody>
                <tr><td>پرداخت‌های نقدی تأییدشده</td><td className="num">+ <Money rial={t.payments_cash} unit={unit} /></td></tr>
                <tr><td>اعتبار بابت هزینه‌های پرداخت‌شده از حساب شخصی</td><td className="num">+ <Money rial={t.expense_credits} unit={unit} /></td></tr>
                <tr><td>اعتبار بابت جبران خدمات (تهاتری)</td><td className="num">+ <Money rial={t.services_credit} unit={unit} /></td></tr>
                <tr><td>جبران نقدی خدمات (پرداخت‌شده توسط شرکت)</td><td className="num muted small">— <Money rial={t.services_cash} unit={unit} /></td></tr>
                <tr className="settle-minus"><td>مانده تعهدات مصوب (سهم از هزینه‌های شرکت)</td><td className="num">− <Money rial={t.commitments_remaining} unit={unit} /></td></tr>
                <tr className="settle-total">
                  <td><b>تراز نهایی</b> {net > 0 ? '— شرکت بدهکار این عضو است' : net < 0 ? '— عضو بدهکار شرکت است' : '— تسویه شده'}</td>
                  <td className="num"><b>{fmtMoney(net, unit)}</b></td>
                </tr>
              </tbody>
            </table>
            <div className="small muted" style={{ marginTop: 10 }}>
              فرمول: پرداخت نقدی + اعتبار هزینه‌ای + اعتبار خدمات − مانده تعهدات. عدد مثبت یعنی اعتبار عضو (طلب)، عدد منفی یعنی بدهی عضو به شرکت.
            </div>
            {t.commitments > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="small" style={{ marginBottom: 5 }}>پیشرفت تسویه تعهدات: {Math.round(t.total_settled * 100 / t.commitments).toLocaleString('fa-IR')}٪</div>
                <Progress pct={t.total_settled * 100 / t.commitments} green={t.total_settled >= t.commitments} />
              </div>
            )}
          </div>
        </div>

        {/* نمودار پرداخت‌ها */}
        <div className="card mb">
          <div className="card-head"><h3>روند پرداخت‌های نقدی این شخص (به تفکیک ماه)</h3></div>
          <div className="pad">
            {payChart.length
              ? <BarChart data={payChart} unit={unit} height={200} colors={['var(--primary, #1d4ed8)']} />
              : <Empty text="پرداخت نقدی تأییدشده‌ای ثبت نشده است" />}
          </div>
        </div>

        {/* تب‌های ریز */}
        <div className="card">
          <div className="card-head" style={{ gap: 4, flexWrap: 'wrap' }}>
            {[['summary', 'خلاصه'], ['commitments', 'تعهدات'], ['payments', 'پرداخت‌ها'], ['services', 'خدمات'], ['credits', 'اعتبارها'], ['timeline', 'تایم‌لاین']].map(([k, l]) => (
              <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <div className="pad">
            {tab === 'summary' && (
              <div className="grid-2">
                <div className="card pad small">
                  <b>مانده دفتری حساب‌های این شخص</b>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>جاری شرکا (۲۱۰۲)</span><Money rial={statement.balances.current} unit={unit} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>وام دریافتی از عضو (۲۱۰۳)</span><Money rial={statement.balances.loan} unit={unit} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>سرمایه (۳۱۰۱)</span><Money rial={statement.balances.capital} unit={unit} /></div>
                  </div>
                </div>
                <div className="card pad small">
                  <b>خلاصه خدمات ارائه‌شده</b>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>جمع خدمات ثبت‌شده</span><Money rial={t.services_total} unit={unit} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>در انتظار جبران</span><Money rial={t.services_pending} unit={unit} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>جبران اعتباری (تهاترشده)</span><Money rial={t.services_credit} unit={unit} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>جبران نقدی</span><Money rial={t.services_cash} unit={unit} /></div>
                  </div>
                </div>
              </div>
            )}
            {tab === 'commitments' && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>مصوبه</th><th>عنوان</th><th>سهم</th><th>تعهد</th><th>پرداخت/تهاتر</th><th>مانده</th><th>سررسید</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {statement.commitments.map(c => (
                      <tr key={c.id}>
                        <td className="num">{c.funding_no}</td>
                        <td className="small">{c.funding_title}</td>
                        <td className="num">{fmtBp(c.share_bp)}</td>
                        <td><Money rial={c.amount} unit={unit} /></td>
                        <td><Money rial={c.paid} unit={unit} /></td>
                        <td><Money rial={c.remaining} unit={unit} bold /></td>
                        <td>{c.due_date ? <JDateText iso={c.due_date} /> : '—'}</td>
                        <td><Badge k={c.settled ? 'paid' : c.paid > 0 ? 'partial' : 'unpaid'} /></td>
                      </tr>
                    ))}
                    {!statement.commitments.length && <tr><td colSpan={8}><Empty text="تعهد مصوبی ثبت نشده است" /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'payments' && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>شماره</th><th>تاریخ</th><th>مبلغ</th><th>پیگیری</th><th>تخصیص‌شده</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {statement.payments.map(p => (
                      <tr key={p.id}>
                        <td className="num">{p.no}</td>
                        <td><JDateText iso={p.pay_date} /></td>
                        <td><Money rial={p.amount} unit={unit} /></td>
                        <td className="num small">{p.tracking_no || '—'}</td>
                        <td className="small num">{p.status === 'approved' ? fmtMoney(p.allocated, unit) : '—'}</td>
                        <td><Badge k={p.status} /></td>
                      </tr>
                    ))}
                    {!statement.payments.length && <tr><td colSpan={6}><Empty text="پرداختی ثبت نشده است" /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'services' && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>شماره</th><th>تاریخ</th><th>نوع</th><th>عنوان</th><th>مبلغ</th><th>جبران</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {statement.services.map(s => (
                      <tr key={s.id}>
                        <td className="num">{s.no}</td>
                        <td><JDateText iso={s.sdate} /></td>
                        <td className="small">{stypeLabels[s.stype]}</td>
                        <td>{s.title}</td>
                        <td><Money rial={s.amount} unit={unit} /></td>
                        <td className="small">{s.status === 'compensated' ? (s.comp_method === 'credit' ? 'اعتباری (تهاتر)' : 'نقدی') : '—'}</td>
                        <td><Badge k={s.status === 'compensated' ? 'paid' : s.status === 'pending' ? 'pending' : s.status === 'draft' ? 'draft' : 'rejected'} text={serviceStatusLabels[s.status]} /></td>
                      </tr>
                    ))}
                    {!statement.services.length && <tr><td colSpan={7}><Empty text="خدمتی ثبت نشده است" /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'credits' && (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>موضوع</th><th>تاریخ</th><th>مبلغ</th><th>مانده اعتبار</th></tr></thead>
                  <tbody>
                    {statement.credits.map(c => (
                      <tr key={c.id}>
                        <td className="small">{c.expense_id ? `${c.expense_no} — ${c.expense_title}` : c.note}</td>
                        <td>{c.date ? <JDateText iso={c.date} /> : '—'}</td>
                        <td><Money rial={c.amount} unit={unit} /></td>
                        <td><Money rial={c.remaining} unit={unit} /></td>
                      </tr>
                    ))}
                    {!statement.credits.length && <tr><td colSpan={4}><Empty text="اعتباری ثبت نشده است" /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'timeline' && (
              <div className="timeline">
                {(timeline || []).map((ev, i) => (
                  <div key={i} className={`tl-item tl-${ev.kind}`}>
                    <div className="tl-dot" />
                    <div className="tl-body">
                      <div className="tl-title">{ev.title}</div>
                      <div className="tl-meta small muted">
                        {ev.date ? <JDateText iso={ev.date} /> : ''} — {({ payment: 'پرداخت', credit: 'اعتبار', service: 'خدمات', commitment: 'تعهد مصوب', allocate: 'تهاتر' })[ev.kind] || ev.kind}
                        {ev.status && <> — <Badge k={ev.status === 'paid' || ev.status === 'approved' ? 'paid' : ev.status === 'partial' ? 'partial' : ev.status === 'compensated' ? 'paid' : ev.status === 'pending' ? 'pending' : ev.status === 'draft' ? 'draft' : 'rejected'} text={ev.status === 'compensated' ? 'جبران‌شده' : undefined} /></>}
                      </div>
                    </div>
                    <div className="tl-amount num">{fmtMoney(ev.amount, unit)}</div>
                  </div>
                ))}
                {!timeline?.length && <Empty text="رویدادی ثبت نشده است" />}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ---------- نمای فهرست ---------- */
  return (
    <div className="page">
      <PageHeader icon="idcard" topic="profiles" title="پروفایل اشخاص"
        subtitle="وضعیت مالی کامل هر سهامدار و هر شخص شرکت — یک نگاه به تعهد، پرداخت، خدمات و تراز نهایی" />

      <div className="mb">
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>سهامداران و اعضا</h3>
        <div className="profile-grid">
          {list.members.map(m => (
            <div key={m.id} className="card profile-card" onClick={() => openProfile(m.id)}>
              <div className="profile-avatar sm">{m.full_name.trim().charAt(0)}</div>
              <div className="profile-card-body">
                <b>{m.full_name}</b>
                <div className="small muted">{m.code} {m.share_now ? `— ${fmtBp(m.share_now)} سهام` : '— بدون سهم'}</div>
                <div className="profile-card-numbers num small">
                  <span>تعهد: {fmtMoney(m.totals.commitments, unit)}</span>
                  <span className={m.totals.net_balance > 0 ? 'pos' : m.totals.net_balance < 0 ? 'neg' : 'muted'}>
                    تراز: {fmtMoney(m.totals.net_balance, unit)}
                  </span>
                </div>
              </div>
              <Icon name="chevronL" size={16} />
            </div>
          ))}
          {!list.members.length && <Empty text="عضوی ثبت نشده است" />}
        </div>
      </div>

      {list.staff?.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>کارکنان و کاربران شرکت</h3>
          <div className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>نام</th><th>نقش</th><th>عضو مرتبط</th><th>آخرین ورود</th><th>تعداد اقدامات</th></tr></thead>
                <tbody>
                  {list.staff.map(s => (
                    <tr key={s.id}>
                      <td><b>{s.full_name}</b><div className="small muted num">@{s.username}</div></td>
                      <td><Badge k="b-info" text={roleLabels[s.role] || s.role} /></td>
                      <td>{s.member_id ? list.members.find(m => m.id === s.member_id)?.full_name || '—' : '—'}</td>
                      <td>{s.last_login ? <JDateText iso={s.last_login} /> : '—'}</td>
                      <td className="num">{s.action_count.toLocaleString('fa-IR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
