import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, JDateText, Money, Empty, Progress } from '../ui/components.jsx'
import { fmtMoney, fmtBp } from '../lib/format.js'

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

  const pct = st.totals.commitments ? Math.round(st.totals.total_settled * 100 / st.totals.commitments) : 0

  return (
    <div className="page">
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat s1"><div className="stat-label">سهم من از شرکت</div><div className="stat-value num">{fmtBp(st.share_now)}</div><div className="stat-foot">{st.member.code}</div></div>
        <div className="stat s2"><div className="stat-label">مانده تعهد من</div><div className="stat-value num">{fmtMoney(st.totals.commitments_remaining, unit)}</div><div className="stat-foot">از {fmtMoney(st.totals.commitments, unit)}</div></div>
        <div className="stat s6"><div className="stat-label">پرداخت و تهاتر انجام‌شده</div><div className="stat-value num">{fmtMoney(st.totals.total_settled, unit)}</div></div>
        <div className="stat s4"><div className="stat-label">اعتبار تخصیص‌نیافته</div><div className="stat-value num">{fmtMoney(Math.max(st.totals.unallocated_credit, 0), unit)}</div><div className="stat-foot">طلب من از شرکت</div></div>
      </div>

      <div className="card mb">
        <div className="card-head"><h3>پیشرفت تسویه تعهدات من</h3></div>
        <div className="pad"><Progress pct={pct} green={pct >= 100} />
          <div className="small muted" style={{ marginTop: 6 }}>
            {pct.toLocaleString('fa-IR')}٪ — «وصول» فقط پرداخت‌های تأییدشده و تهاترهای اعمال‌شده را می‌شمارد؛ اعلام پرداختِ در انتظار بررسی در این عدد محسوب نمی‌شود.
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
                    <td className="num">{c.expense_no} — {c.expense_title}</td>
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
