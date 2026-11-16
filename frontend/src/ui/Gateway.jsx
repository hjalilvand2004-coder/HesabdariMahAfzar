import React, { useEffect, useState } from 'react'
import { useApp, navigate } from '../App.jsx'
import { call } from '../api/index.js'
import { Icon } from './components.jsx'
import { fmtMoney } from '../lib/format.js'

/*
  صفحه درگاه پرداخت اینترنتی بانک ملی.
  در نسخه پرتیبل (آفلاین) جریان واقعی بانک شبیه‌سازی می‌شود: آغاز پرداخت ← صفحه بانک
  ← بازگشت با شماره مرجع ← Verify در سامانه (نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس).
  در استقرار واقعی سرور، gateway_url دریافتی از API همان آدرس درگاه بانک ملی (صداد/شاپرک)
  است و کاربر به آن هدایت می‌شود؛ بازگشت به همان مسیر verify انجام می‌شود.
*/

export default function Gateway ({ settings }) {
  const unit = settings?.currency_display || 'toman'
  const [tx, setTx] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [otp, setOtp] = useState('')
  const [card, setCard] = useState('6037-9912-3456-7890')
  const [cvv2, setCvv2] = useState('123')

  useEffect(() => {
    const m = window.location.hash.match(/tx=(\d+)/)
    if (!m) { setErr('تراکنش پرداختی یافت نشد'); return }
    call('GET', `/api/wallet/tx/${m[1]}`).then(setTx).catch(ex => setErr(ex.message))
  }, [])

  const otpGet = () => {
    setOtp(String(Math.floor(100000 + Math.random() * 900000)))
    setTimeout(() => setOtp(''), 120000)
  }

  const pay = async () => {
    setBusy(true)
    // شبیه‌سازی فراخوانی وب‌سرویس بانک ملی (سامانه پرداخت) — ۱.۲ ثانیه
    setTimeout(async () => {
      const ref = `SADAD-${Math.floor(1000000 + Math.random() * 9000000)}`
      try {
        const res = await call('POST', '/api/wallet/gateway/verify', { tx_id: tx.id, result: 'ok', ref })
        window.location.hash = `/wallet?gw=ok&ref=${ref}&amt=${tx.amount}&alloc=${res.allocated || 0}`
      } catch (ex) {
        window.location.hash = `/wallet?gw=fail&msg=${encodeURIComponent(ex.message)}`
      }
    }, 1200)
  }

  const cancel = () => {
    if (tx) call('POST', '/api/wallet/gateway/verify', { tx_id: tx.id, result: 'cancel' }).catch(() => {})
    window.location.hash = '/wallet?gw=cancel'
  }

  const fail = () => {
    if (tx) call('POST', '/api/wallet/gateway/verify', { tx_id: tx.id, result: 'fail' }).catch(() => {})
    window.location.hash = '/wallet?gw=fail'
  }

  if (err) {
    return (
      <div className="page"><div className="card pad center muted">
        {err}
        <div style={{ marginTop: 12 }}><button className="btn btn-ghost btn-sm" onClick={() => navigate('/wallet')}>بازگشت به کیف پول</button></div>
      </div></div>
    )
  }
  if (!tx) return <div className="page"><div className="card pad center muted">در حال اتصال به درگاه بانک ملی…</div></div>

  return (
    <div className="page">
      <div className="gw-wrap">
        <div className="gw-head">
          <div className="gw-logo"><b>ملی</b></div>
          <div className="gw-head-text">
            <b>بانک ملی ایران</b>
            <span>درگاه پرداخت اینترنتی (سامانه پرداخت اینترنتی شاپرک)</span>
          </div>
          <span className="gw-secure"><Icon name="lock" size={13} /> اتصال امن SSL</span>
        </div>
        <div className="gw-body">
          <table className="gw-info">
            <tbody>
              <tr><td>پذیرنده</td><td><b>{tx.merchant}</b></td></tr>
              <tr><td>شماره سفارش</td><td className="num">{tx.order_no}</td></tr>
              <tr><td>مبلغ قابل پرداخت</td><td className="num gw-amount"><b>{fmtMoney(tx.amount, unit)}</b></td></tr>
              <tr><td>توضیح</td><td className="small">{tx.note}</td></tr>
            </tbody>
          </table>
          <div className="gw-note">
            ⚠️ این صفحه در نسخه پرتیبل، جریان واقعی درگاه بانک ملی را شبیه‌سازی می‌کند تا سامانه بدون اینترنت هم قابل استفاده باشد.
            پس از پرداخت، با شماره مرجع بانکی به سامانه بازمی‌گردید و «نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس» ثبت می‌شود.
          </div>
          <div className="gw-form">
            <div className="field"><label>شماره کارت (بانک ملی)</label>
              <input className="input num" value={card} onChange={(e) => setCard(e.target.value)} dir="ltr" /></div>
            <div className="form-row-3">
              <div className="field"><label>CVV2</label>
                <input className="input num" value={cvv2} onChange={(e) => setCvv2(e.target.value)} dir="ltr" /></div>
              <div className="field"><label>تاریخ انقضا</label>
                <input className="input num" defaultValue="08/07" dir="ltr" /></div>
              <div className="field"><label>رمز پویا (OTP)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input num" value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ''))} placeholder="------" dir="ltr" />
                  <button type="button" className="btn btn-soft btn-sm" style={{ flexShrink: 0 }} onClick={otpGet}>دریافت رمز</button>
                </div></div>
            </div>
            <div className="gw-actions">
              <button className="btn btn-primary" disabled={busy || !otp} onClick={pay}>
                {busy ? 'در حال پردازش در بانک…' : `پرداخت ${fmtMoney(tx.amount, unit)}`}
              </button>
              <button className="btn btn-ghost" onClick={cancel}>انصراف و بازگشت</button>
              <button className="btn btn-ghost gw-fail-link" onClick={fail} title="برای تست مسیر پرداخت ناموفق">(تست: پرداخت ناموفق)</button>
            </div>
          </div>
        </div>
        <div className="gw-foot small muted">
          شماره مرجع پرداخت پس از اتمام تراکنش در کیف پول شما ثبت و قابل استناد است — پشتیبانی سامانه پذیرنده از طریق بخش تنظیمات.
        </div>
      </div>
    </div>
  )
}
