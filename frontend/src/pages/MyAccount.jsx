import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, JDateText, Money, Empty, Progress, Icon } from '../ui/components.jsx'
import { HelpButton } from '../ui/Help.jsx'
import { fmtMoney, fmtBp, stypeLabels, serviceStatusLabels } from '../lib/format.js'
import { GuideButton } from '../ui/Guide.jsx'

export default function MyAccount ({ user, settings }) {
  const unit = settings?.currency_display || 'toman'
  const [st, setSt] = useState(null)
  useEffect(() => {
    if (user.member_id) call('GET', `/api/members/${user.member_id}/statement`).then(setSt)
  }, [user.member_id])

  if (!user.member_id) {
    return <div className="page"><div className="card pad center muted">حساب کاربری شما به عضوی متصل نیست؛ با مدیر سامانه تماس بگیرید.</div></div>
  }
  if (!st) return <div className="page"><div className="card pad center muted">در حال دریافت وضعیت حساب…</div></div>

  const t = st.totals
  const pct = t.commitments ? Math.round(t.total_settled * 100 / t.commitments) : 0
  const net = t.net_balance

  return (
    <div className="page">
      <div className="page-head mb">
        <div className="page-head-main">
          <span className="page-head-icon"><Icon name="wallet" size={21} /></span>
          <div>
            <h2>وضعیت حساب من</h2>
            <div className="small muted" style={{ marginTop: 3 }}>
              خلاصه مالی شما: تعهدات، پرداخت‌ها، اعتبارها و خدمات — ریز کامل در «پروفایل اشخاص»
            </div>
          </div>
        </div>
        <div className="page-head-actions">
          <GuideButton />
          <HelpButton topic="my-account" label="" />
        </div>
      </div>

      <div className="stat-grid stat-grid-5 mb">
        <div className="stat s1"><div className="stat-label">سهم من از شرکت</div><div className="stat-value num">{fmtBp(st.share_now)}</div><div className="stat-foot">{st.member.code}</div></div>
        <div className="stat s4"><div className="stat-label">مانده تعهد من</div><div className="stat-value num">{fmtMoney(t.commitments_remaining, unit)}</div><div className="stat-foot">از {fmtMoney(t.commitments, unit)}</div></div>
        <div className="stat s6"><div className="stat-label">پرداخت و تهاتر انجام‌شده</div><div className="stat-value num">{fmtMoney(t.total_settled, unit)}</div></div>
        <div className="stat s2"><div className="stat-label">خدمات من و جبران</div><div className="stat-value num">{fmtMoney(t.services_total, unit)}</div><div className="stat-foot">جبران‌شده: {fmtMoney(t.services_cash + t.services_credit, unit)}</div></div>
        <div className={`stat ${net > 0 ? 's2' : net < 0 ? 's5' : 's4'}`}>
          <div className="stat-label">تراز نهایی حساب من</div>
          <div className="stat-value num">{fmtMoney(net, unit)}</div>
          <div className="stat-foot">{net > 0 ? 'طلب من از شرکت (اعتبار)' : net < 0 ? 'مانده بدهی من به شرکت' : 'تسویه کامل'}</div>
        </div>
      </div>

      <div className="card mb">
        <div className="card-head"><h3>پیشرفت تسویه تعهدات من</h3></div>
        <div className="pad"><Progress pct={pct} green={pct >= 100} />
          <div className="small muted" style={{ marginTop: 6 }}>
            {pct.toLocaleString('fa-IR')}٪ — «وصول» فقط پرداخت‌های تأییدشده و تهاترهای اعمال‌شده (اعتبار هزینه شخصی و خدمات) را می‌شمارد؛ پرداخت اعلام‌شده در انتظار بررسی محسوب نمی‌شود.
          </div>
        </div>
      </div>

      <div className="card mb">
        <div className="card-head"><h3>تعهدات مصوب من</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>مصوبه</th><th>عنوان</th><th>نوع</th><th>سهم من</th><th>تعهد</th><th>پرداخت/تهاتر</th><th>مانده</th><th>سررسید</th><th></th></tr></thead>
            <tbody>
              {st.commitments.map(c => (
                <tr key={c.id}>
                  <td className="num">{c.funding_no}</td>
                  <td>{c.funding_title}</td>
                  <td><Badge k={c.funding_type} /></td>
                  <td className="num">{fmtBp(c.share_bp)}</td>
                  <td><Money rial={c.amount} unit={unit} /></td>
                  <td><Money rial={c.paid} unit={unit} /></td>
                  <td><Money rial={c.remaining} unit={unit} bold /></td>
                  <td>{c.due_date ? <JDateText iso={c.due_date} /> : '—'}</td>
                  <td><Badge k={c.settled ? 'paid' : c.paid > 0 ? 'partial' : 'unpaid'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!st.commitments.length && <Empty icon="🎯" text="در مصوبه‌های فعلی تعهدی برای شما ثبت نشده است" />}
        </div>
      </div>

      <div className="card mb">
        <div className="card-head"><h3>خدمات ارائه‌شده من و جبران آن‌ها</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>نوع</th><th>عنوان</th><th>مبلغ</th><th>جبران</th><th>وضعیت</th></tr></thead>
            <tbody>
              {st.services.map(s => (
                <tr key={s.id}>
                  <td className="num">{s.no}</td>
                  <td><JDateText iso={s.sdate} /></td>
                  <td className="small">{stypeLabels[s.stype]}</td>
                  <td>{s.title}</td>
                  <td><Money rial={s.amount} unit={unit} /></td>
                  <td className="small">{s.status === 'compensated' ? (s.comp_method === 'credit' ? 'اعتباری (تهاتر با تعهد)' : 'نقدی از شرکت') : '—'}</td>
                  <td><Badge k={s.status === 'compensated' ? 'paid' : s.status === 'pending' ? 'pending' : s.status === 'draft' ? 'draft' : 'rejected'} text={serviceStatusLabels[s.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!st.services.length && <Empty icon="🛠️" text="خدمتی برای شرکت ثبت نشده است — از بخش «خدمات اعضا» ثبت می‌شود" />}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>پرداخت‌های من</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>شماره</th><th>تاریخ</th><th>مبلغ</th><th>وضعیت</th></tr></thead>
              <tbody>
                {st.payments.map(p => (
                  <tr key={p.id}>
                    <td className="num">{p.no}</td>
                    <td><JDateText iso={p.pay_date} /></td>
                    <td><Money rial={p.amount} unit={unit} /></td>
                    <td><Badge k={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!st.payments.length && <Empty icon="🧾" text="پرداختی اعلام نشده است" />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>اعتبار من بابت پرداخت هزینه شرکت</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>هزینه</th><th>تاریخ</th><th>مبلغ</th><th>مانده اعتبار</th></tr></thead>
              <tbody>
                {st.credits.map(c => (
                  <tr key={c.id}>
                    <td className="small">{c.expense_id ? `${c.expense_no} — ${c.expense_title}` : c.note}</td>
                    <td><JDateText iso={c.date} /></td>
                    <td><Money rial={c.amount} unit={unit} /></td>
                    <td><Money rial={c.remaining} unit={unit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!st.credits.length && <Empty icon="🤝" text="هزینه‌ای از حساب شخصی شما پرداخت نشده است" />}
          </div>
        </div>
      </div>
    </div>
  )
}
