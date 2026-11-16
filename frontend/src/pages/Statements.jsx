import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { JDate, Money, Empty, Icon } from '../ui/components.jsx'
import { csvDownload, fmtMoney } from '../lib/format.js'
import { fiscalYearRange, currentJYear } from '../lib/jalali.js'

export default function Statements () {
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [tab, setTab] = useState('pnl')
  const [range, setRange] = useState(() => { const [s] = fiscalYearRange(currentJYear()); return { from: s, to: '' } })
  const [pnl, setPnl] = useState(null)
  const [bs, setBs] = useState(null)

  useEffect(() => {
    if (tab === 'pnl') call('GET', '/api/reports/pnl', null, { date_from: range.from, date_to: range.to }).then(setPnl)
    else call('GET', '/api/reports/balance-sheet', null, { as_of: range.to || '' }).then(setBs)
  }, [tab, range])

  const Row = ({ r }) => (
    <tr><td className="num">{r.code}</td><td>{r.name}</td><td><Money rial={r.amount} unit={unit} /></td></tr>
  )

  return (
    <div className="page">
      <div className="card mb no-print">
        <div className="pad">
          <div className="filters">
            {tab === 'pnl' && (
              <>
                <div className="field"><label>از تاریخ</label><JDate value={range.from} onChange={(v) => setRange(r => ({ ...r, from: v || '' }))} /></div>
                <div className="field"><label>تا تاریخ</label><JDate value={range.to} onChange={(v) => setRange(r => ({ ...r, to: v || '' }))} /></div>
              </>
            )}
            {tab === 'bs' && (
              <div className="field"><label>تا تاریخ (وضعیت در)</label><JDate value={range.to} onChange={(v) => setRange(r => ({ ...r, to: v || '' }))} /></div>
            )}
            <div className="field" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => window.print()}><Icon name="print" size={16} /> چاپ</button>
            </div>
          </div>
        </div>
      </div>

      <div className="tabs no-print">
        <button className={`tab ${tab === 'pnl' ? 'active' : ''}`} onClick={() => setTab('pnl')}>صورت سود و زیان</button>
        <button className={`tab ${tab === 'bs' ? 'active' : ''}`} onClick={() => setTab('bs')}>صورت وضعیت مالی (ترازنامه)</button>
      </div>

      {tab === 'pnl' && pnl && (
        <div className="card">
          <div className="card-head"><h3>صورت سود و زیان</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>کد</th><th>شرح</th><th>مبلغ</th></tr></thead>
              <tbody>
                <tr className="tr-group"><td colSpan={3}><b>درآمدهای عملیاتی و غیرعملیاتی</b></td></tr>
                {pnl.revenues.map(r => <Row key={r.code} r={r} />)}
                {!pnl.revenues.length && <tr><td colSpan={3} className="muted small">درآمدی ثبت نشده است</td></tr>}
                <tr><td colSpan={2}><b>جمع درآمدها</b></td><td><Money rial={pnl.total_revenue} unit={unit} bold /></td></tr>
                <tr className="tr-group"><td colSpan={3}><b>هزینه‌های عملیاتی</b></td></tr>
                {pnl.expenses.map(r => <Row key={r.code} r={r} />)}
                {!pnl.expenses.length && <tr><td colSpan={3} className="muted small">هزینه‌ای ثبت نشده است</td></tr>}
                <tr><td colSpan={2}><b>جمع هزینه‌ها</b></td><td><Money rial={pnl.total_expense} unit={unit} bold /></td></tr>
              </tbody>
              <tfoot>
                <tr><td colSpan={2}>{pnl.profit >= 0 ? 'سود خالص دوره' : 'زیان خالص دوره'}</td>
                  <td><Money rial={pnl.profit} unit={unit} /></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'bs' && bs && (
        <div className="grid-2">
          <div className="card">
            <div className="card-head" style={{ borderRight: '4px solid #0284c7' }}><h3>دارایی‌ها</h3></div>
            <div className="table-wrap">
              <table className="tbl">
                <tbody>
                  {bs.assets.map(r => <Row key={r.code} r={r} />)}
                  {!bs.assets.length && <tr><td colSpan={3} className="muted small">موردی نیست</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={2}>جمع دارایی‌ها</td><td><Money rial={bs.total_assets} unit={unit} /></td></tr></tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-head" style={{ borderRight: '4px solid #ef4444' }}><h3>بدهی‌ها و حقوق مالکانه</h3></div>
            <div className="table-wrap">
              <table className="tbl">
                <tbody>
                  {bs.liabilities.map(r => <Row key={r.code} r={r} />)}
                  <tr><td colSpan={3}><b>حقوق مالکانه</b></td></tr>
                  {bs.equity.map(r => <Row key={r.code} r={r} />)}
                  <tr><td className="num">—</td><td>سود (زیان) انباشته دوره</td><td><Money rial={bs.profit} unit={unit} /></td></tr>
                </tbody>
                <tfoot><tr><td colSpan={2}>جمع بدهی‌ها و حقوق مالکانه</td><td><Money rial={bs.total_liabilities + bs.total_equity} unit={unit} /></td></tr></tfoot>
              </table>
            </div>
          </div>
          <div className="card pad" style={{ gridColumn: 'span 2' }}>
            {bs.check === 0
              ? <span className="badge b-approved">✓ تراز متوازن است: دارایی‌ها = بدهی‌ها + حقوق مالکانه</span>
              : <span className="badge b-danger">عدم توازن: {fmtMoney(bs.check, unit)}</span>}
            <div className="small muted" style={{ marginTop: 8 }}>
              یادداشت: در نسخه جاری ثبت اختتامیه سالانه به‌عنوان رویه فصلی در برنامه توسعه است؛ سود دوره به‌صورت ردیف تعدیل در سمت حقوق مالکانه نمایش داده می‌شود.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
