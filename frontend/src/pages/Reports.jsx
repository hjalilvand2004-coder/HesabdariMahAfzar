import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { JDate, JDateText, Money, Empty, Icon } from '../ui/components.jsx'
import { csvDownload, fmtMoney } from '../lib/format.js'
import { fiscalYearRange, currentJYear } from '../lib/jalali.js'

export default function Reports () {
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [tab, setTab] = useState('journal')
  const [range, setRange] = useState(() => {
    const [s] = fiscalYearRange(currentJYear())
    return { date_from: s, date_to: '' }
  })
  const [accounts, setAccounts] = useState([])
  const [tafsils, setTafsils] = useState([])
  const [moinCode, setMoinCode] = useState('')
  const [tafId, setTafId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    call('GET', '/api/accounts').then(setAccounts)
    call('GET', '/api/banks/tafsils').then(setTafsils)
  }, [])

  const load = async () => {
    setLoading(true)
    const qs = { date_from: range.date_from, date_to: range.date_to }
    try {
      if (tab === 'journal') setData(await call('GET', '/api/reports/journal', null, qs))
      else if (tab === 'general') setData(await call('GET', '/api/reports/general', null, qs))
      else if (tab === 'moin') setData(moinCode ? await call('GET', `/api/reports/moin/${moinCode}`, null, qs) : null)
      else if (tab === 'tafsil') setData(tafId ? await call('GET', `/api/reports/tafsil/${tafId}`, null, qs) : null)
      else if (tab === 'trial') setData(await call('GET', '/api/reports/trial-balance', null, qs))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [tab, range, moinCode, tafId])

  const exportCsv = () => {
    if (!data?.length) return
    if (tab === 'journal') csvDownload('دفتر-روزنامه.csv', data.map(r => [r.date, r.voucher_no, r.account_code, r.account_name, r.tafsil, r.line_desc || r.voucher_desc, r.debit, r.credit]), ['تاریخ', 'شماره سند', 'کد', 'حساب', 'تفصیلی', 'شرح', 'بدهکار', 'بستانکار'])
    else if (tab === 'general') csvDownload('دفتر-کل.csv', data.map(r => [r.code, r.name, r.debit, r.credit, r.balance_debit, r.balance_credit]), ['کد کل', 'نام', 'گردش بدهکار', 'گردش بستانکار', 'مانده بدهکار', 'مانده بستانکار'])
    else if (tab === 'moin') csvDownload('دفتر-معین.csv', data.map(r => [r.date, r.voucher_no, r.account_code, r.account_name, r.tafsil, r.line_desc || r.voucher_desc, r.debit, r.credit, r.balance]), ['تاریخ', 'سند', 'کد', 'حساب', 'تفصیلی', 'شرح', 'بدهکار', 'بستانکار', 'مانده'])
    else if (tab === 'tafsil') csvDownload('گردش-تفصیلی.csv', data.map(r => [r.date, r.voucher_no, r.account_code, r.account_name, r.line_desc || r.voucher_desc, r.debit, r.credit, r.balance]), ['تاریخ', 'سند', 'کد', 'حساب', 'شرح', 'بدهکار', 'بستانکار', 'مانده'])
    else csvDownload('تراز-آزمایشی.csv', data.map(r => [r.code, r.name, r.open_debit, r.open_credit, r.move_debit, r.move_credit, r.close_debit, r.close_credit]), ['کد', 'نام', 'مانده اول بدهکار', 'مانده اول بستانکار', 'گردش بدهکار', 'گردش بستانکار', 'مانده پایان بدهکار', 'مانده پایان بستانکار'])
  }

  const moins = accounts.filter(a => a.level === 'moin' || a.level === 'col')
  const memberTafsils = tafsils.filter(t => ['member', 'bank', 'party'].includes(t.ttype))

  const totals = useMemo(() => {
    if (!data?.length) return null
    if (tab === 'journal') return { d: data.reduce((s, r) => s + r.debit, 0), c: data.reduce((s, r) => s + r.credit, 0) }
    if (tab === 'moin' || tab === 'tafsil') return { d: data.reduce((s, r) => s + r.debit, 0), c: data.reduce((s, r) => s + r.credit, 0), bal: data[data.length - 1]?.balance }
    if (tab === 'general') return { d: data.reduce((s, r) => s + r.debit, 0), c: data.reduce((s, r) => s + r.credit, 0) }
    if (tab === 'trial') return {
      od: data.reduce((s, r) => s + r.open_debit, 0), oc: data.reduce((s, r) => s + r.open_credit, 0),
      md: data.reduce((s, r) => s + r.move_debit, 0), mc: data.reduce((s, r) => s + r.move_credit, 0),
      cd: data.reduce((s, r) => s + r.close_debit, 0), cc: data.reduce((s, r) => s + r.close_credit, 0),
    }
    return null
  }, [data, tab])

  return (
    <div className="page">
      <div className="card mb no-print">
        <div className="pad">
          <div className="filters">
            <div className="field"><label>از تاریخ</label><JDate value={range.date_from} onChange={(v) => setRange(r => ({ ...r, date_from: v || '' }))} /></div>
            <div className="field"><label>تا تاریخ</label><JDate value={range.date_to} onChange={(v) => setRange(r => ({ ...r, date_to: v || '' }))} /></div>
            {tab === 'moin' && (
              <div className="field"><label>حساب معین/کل</label>
                <select className="input" value={moinCode} onChange={(e) => setMoinCode(e.target.value)}>
                  <option value="">انتخاب…</option>
                  {moins.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select></div>
            )}
            {tab === 'tafsil' && (
              <div className="field"><label>تفصیلی (عضو/بانک/شخص)</label>
                <select className="input" value={tafId} onChange={(e) => setTafId(e.target.value)}>
                  <option value="">انتخاب…</option>
                  {memberTafsils.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
            )}
            <div className="field" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={exportCsv} disabled={!data?.length}><Icon name="download" size={16} /> Excel (CSV)</button>
              <button className="btn btn-ghost" onClick={() => window.print()} disabled={!data?.length}><Icon name="print" size={16} /> چاپ</button>
            </div>
          </div>
        </div>
      </div>

      <div className="tabs no-print">
        {[['journal', 'دفتر روزنامه'], ['general', 'دفتر کل'], ['moin', 'دفتر معین'], ['tafsil', 'گردش تفصیلی'], ['trial', 'تراز آزمایشی']].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => { setTab(k); setData(null) }}>{label}</button>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>
            {({ journal: 'دفتر روزنامه — ثبت زمانی عملیات با ردیف‌های بدهکار و بستانکار',
              general: 'دفتر کل — گردش و مانده حساب‌های کل (۴ رقم)',
              moin: `دفتر معین — ${moinCode ? accounts.find(a => a.code === moinCode)?.name || '' : 'یک حساب را انتخاب کنید'}`,
              tafsil: `گردش تفصیلی — ${tafId ? tafsils.find(t => t.id === Number(tafId))?.name || '' : 'یک تفصیلی را انتخاب کنید'}`,
              trial: 'تراز آزمایشی — مانده اول، گردش دوره و مانده پایان' })[tab]}
          </h3>
        </div>
        {loading && <div className="pad center muted">در حال محاسبه…</div>}
        {!loading && (!data || !data.length) && <Empty icon="📊" text={tab === 'moin' && !moinCode ? 'حساب موردنظر را انتخاب کنید' : tab === 'tafsil' && !tafId ? 'تفصیلی موردنظر را انتخاب کنید' : 'داده‌ای برای این بازه یافت نشد'} />}

        {!loading && data?.length > 0 && tab === 'journal' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>تاریخ</th><th>سند</th><th>کد</th><th>حساب</th><th>تفصیلی</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th></tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i}>
                    <td><JDateText iso={r.date} /></td>
                    <td className="num">{r.voucher_no}</td>
                    <td className="num">{r.account_code}</td>
                    <td>{r.account_name}</td>
                    <td>{r.tafsil || '—'}</td>
                    <td className="small">{r.line_desc || r.voucher_desc}</td>
                    <td>{r.debit ? <Money rial={r.debit} unit={unit} /> : '—'}</td>
                    <td>{r.credit ? <Money rial={r.credit} unit={unit} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={6}>جمع کل</td><td><Money rial={totals.d} unit={unit} /></td><td><Money rial={totals.c} unit={unit} /></td></tr></tfoot>
            </table>
          </div>
        )}

        {!loading && data?.length > 0 && tab === 'general' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>کد کل</th><th>نام حساب</th><th>گردش بدهکار</th><th>گردش بستانکار</th><th>مانده بدهکار</th><th>مانده بستانکار</th></tr></thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.code}>
                    <td className="num">{r.code}</td>
                    <td><b>{r.name}</b></td>
                    <td><Money rial={r.debit} unit={unit} /></td>
                    <td><Money rial={r.credit} unit={unit} /></td>
                    <td>{r.balance_debit ? <Money rial={r.balance_debit} unit={unit} /> : '—'}</td>
                    <td>{r.balance_credit ? <Money rial={r.balance_credit} unit={unit} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>جمع</td><td><Money rial={totals.d} unit={unit} /></td><td><Money rial={totals.c} unit={unit} /></td><td colSpan={2}></td></tr></tfoot>
            </table>
          </div>
        )}

        {!loading && data?.length > 0 && (tab === 'moin' || tab === 'tafsil') && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>تاریخ</th><th>سند</th><th>حساب</th><th>تفصیلی</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i}>
                    <td><JDateText iso={r.date} /></td>
                    <td className="num">{r.voucher_no}</td>
                    <td className="num">{r.account_code} {r.account_name}</td>
                    <td>{r.tafsil || '—'}</td>
                    <td className="small">{r.line_desc || r.voucher_desc}</td>
                    <td>{r.debit ? <Money rial={r.debit} unit={unit} /> : '—'}</td>
                    <td>{r.credit ? <Money rial={r.credit} unit={unit} /> : '—'}</td>
                    <td><Money rial={r.balance} unit={unit} bold /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>جمع</td><td><Money rial={totals.d} unit={unit} /></td><td><Money rial={totals.c} unit={unit} /></td><td><Money rial={totals.bal} unit={unit} /></td></tr></tfoot>
            </table>
          </div>
        )}

        {!loading && data?.length > 0 && tab === 'trial' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th rowSpan={2} style={{ verticalAlign: 'middle' }}>کد / حساب</th>
                <th colSpan={2}>مانده اول دوره</th><th colSpan={2}>گردش دوره</th><th colSpan={2}>مانده پایان</th></tr>
                <tr><th>بدهکار</th><th>بستانکار</th><th>بدهکار</th><th>بستانکار</th><th>بدهکار</th><th>بستانکار</th></tr></thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.code}>
                    <td><b className="num">{r.code}</b> {r.name}</td>
                    <td>{r.open_debit ? <Money rial={r.open_debit} unit={unit} /> : '—'}</td>
                    <td>{r.open_credit ? <Money rial={r.open_credit} unit={unit} /> : '—'}</td>
                    <td><Money rial={r.move_debit} unit={unit} /></td>
                    <td><Money rial={r.move_credit} unit={unit} /></td>
                    <td>{r.close_debit ? <Money rial={r.close_debit} unit={unit} /> : '—'}</td>
                    <td>{r.close_credit ? <Money rial={r.close_credit} unit={unit} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>جمع کل (کنترل توازن)</td>
                  <td><Money rial={totals.od} unit={unit} /></td><td><Money rial={totals.oc} unit={unit} /></td>
                  <td><Money rial={totals.md} unit={unit} /></td><td><Money rial={totals.mc} unit={unit} /></td>
                  <td><Money rial={totals.cd} unit={unit} /></td><td><Money rial={totals.cc} unit={unit} /></td></tr>
                <tr><td colSpan={7}>
                  {totals.md === totals.mc
                    ? '✅ تراز آزمایشی متوازن است (جمع گردش بدهکار = بستانکار)'
                    : '⛔ عدم توازن — با پشتیبانی تماس بگیرید'}
                </td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
