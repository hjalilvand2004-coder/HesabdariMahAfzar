import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, Modal, Icon, MoneyInput, JDate, JDateText, Empty, Money, useToast, Confirm } from '../ui/components.jsx'
import { fmtMoney, csvDownload } from '../lib/format.js'
import { todayIso } from '../lib/jalali.js'

const SOURCE_LABELS = {
  manual: 'دستی', expense: 'هزینه', expense_settle: 'تسویه فروشنده', payment: 'وصول پرداخت',
  reversal: 'ابطال', seed: 'داده اولیه', closing: 'بستن حساب‌ها',
}

export default function Vouchers ({ user }) {
  const toast = useToast()
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [filters, setFilters] = useState({ no: '', status: '', source_type: '', date_from: '', date_to: '' })
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [confirmAct, setConfirmAct] = useState(null)
  const canCreate = ['admin', 'finance', 'accountant'].includes(user.role)
  const canConfirm = ['admin', 'finance'].includes(user.role)

  const load = () => call('GET', '/api/vouchers', null, filters).then(setRows)
  useEffect(() => { load() }, [filters])
  useEffect(() => { call('GET', '/api/accounts').then(setAccounts) }, [])

  const openNew = () => setForm({
    date: todayIso(), description: '', status: 'draft',
    lines: [
      { account_code: '', tafsil_name: '', debit: null, credit: null, description: '', project_id: null },
      { account_code: '', tafsil_name: '', debit: null, credit: null, description: '', project_id: null },
    ],
  })

  const td = (form?.lines || []).reduce((s, l) => s + (l.debit || 0), 0)
  const tc = (form?.lines || []).reduce((s, l) => s + (l.credit || 0), 0)
  const balanced = td > 0 && td === tc

  const postable = accounts.filter(a => a.is_active)

  const save = async () => {
    const lines = form.lines
      .filter(l => l.account_code && (l.debit || l.credit))
      .map(l => ({ ...l, debit: l.debit || 0, credit: l.credit || 0 }))
    if (!lines.length) return toast.error('حداقل یک ردیف کامل شود')
    try {
      await call('POST', '/api/vouchers', { date: form.date, description: form.description, status: form.status, lines })
      toast('سند ثبت شد')
      setForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const act = async (v, action) => {
    try {
      if (action === 'confirm') {
        await call('POST', `/api/vouchers/${v.id}/confirm`)
        toast(`سند ${v.no} قطعی شد`)
      } else {
        await call('POST', `/api/vouchers/${v.id}/reverse`, { reason: '' })
        toast(`سند ابطال معکوس صادر شد`)
      }
      setConfirmAct(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="alert info"><Icon name="vouchers" size={17} />
        <div><b>اسناد قطعی تغییر نمی‌کنند</b> — اصلاح فقط با «سند ابطال معکوس» انجام می‌شود و ردپای کامل در حسابرسی می‌ماند. اسناد هزینه/وصول به‌صورت خودکار از عملیات مبدأ تولید می‌شوند (بدون ثبت دوباره).</div>
      </div>

      <div className="card mb">
        <div className="pad">
          <div className="filters">
            <div className="field"><label>شماره سند</label>
              <input className="input num" placeholder="V-1405-…" value={filters.no} onChange={(e) => setFilters(f => ({ ...f, no: e.target.value }))} /></div>
            <div className="field"><label>وضعیت</label>
              <select className="input" value={filters.status} onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">همه</option><option value="draft">پیش‌نویس</option><option value="confirmed">قطعی</option>
              </select></div>
            <div className="field"><label>مبدأ</label>
              <select className="input" value={filters.source_type} onChange={(e) => setFilters(f => ({ ...f, source_type: e.target.value }))}>
                <option value="">همه</option>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label>از تاریخ</label>
              <JDate value={filters.date_from} onChange={(v) => setFilters(f => ({ ...f, date_from: v || '' }))} /></div>
            <div className="field"><label>تا تاریخ</label>
              <JDate value={filters.date_to} onChange={(v) => setFilters(f => ({ ...f, date_to: v || '' }))} /></div>
            {canCreate && <button className="btn btn-primary" onClick={openNew}><Icon name="plus" size={17} /> سند دستی</button>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>شرح</th><th>مبدأ</th><th>بدهکار</th><th>بستانکار</th><th>وضعیت</th><th style={{ width: 180 }}></th></tr></thead>
            <tbody>
              {rows.map(v => (
                <tr key={v.id}>
                  <td className="num">{v.no}</td>
                  <td><JDateText iso={v.date} /></td>
                  <td style={{ maxWidth: 260 }}>{v.description}</td>
                  <td><Badge k="b-info" text={SOURCE_LABELS[v.source_type] || v.source_type} /></td>
                  <td><Money rial={v.total_debit} unit={unit} /></td>
                  <td><Money rial={v.total_credit} unit={unit} /></td>
                  <td><Badge k={v.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={async () => setDetail(await call('GET', `/api/vouchers/${v.id}`))}>
                        <Icon name="eye" size={14} /> ردیف‌ها
                      </button>
                      {canConfirm && v.status === 'draft' && (
                        <button className="btn btn-success btn-sm" onClick={() => setConfirmAct({ v, a: 'confirm' })}>قطعی</button>
                      )}
                      {canConfirm && v.status === 'confirmed' && !v.reversal_of && v.source_type !== 'reversal' && (
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmAct({ v, a: 'reverse' })}>ابطال</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty icon="📒" text="سندی یافت نشد" />}
        </div>
      </div>

      {/* فرم سند دستی */}
      {form && (
        <Modal wide title="ثبت سند دستی" onClose={() => setForm(null)}
          foot={<>
            <button className="btn btn-primary" disabled={!balanced} onClick={save}>
              <Icon name="check" size={16} /> {form.status === 'confirmed' ? 'ثبت قطعی' : 'ذخیره پیش‌نویس'}
            </button>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button>
          </>}>
          <div className="form-row">
            <div className="field"><label>تاریخ سند *</label><JDate value={form.date} onChange={(v) => setForm(f => ({ ...f, date: v || todayIso() }))} /></div>
            <div className="field"><label>ثبت به‌صورت</label>
              <select className="input" value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="draft">پیش‌نویس</option><option value="confirmed">قطعی</option>
              </select></div>
          </div>
          <div className="field"><label>شرح سند *</label>
            <input className="input" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>

          <table className="tbl">
            <thead><tr><th>حساب (کل/معین)</th><th>تفصیلی</th><th>بدهکار</th><th>بستانکار</th><th></th></tr></thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={l.account_code} onChange={(e) => {
                      const lines = [...form.lines]
                      lines[i] = { ...l, account_code: e.target.value }
                      setForm(f => ({ ...f, lines }))
                    }}>
                      <option value="">انتخاب حساب…</option>
                      {postable.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                  </td>
                  <td><input className="input" style={{ minWidth: 120 }} value={l.tafsil_name} placeholder="شخص/بانک…"
                    onChange={(e) => { const lines = [...form.lines]; lines[i] = { ...l, tafsil_name: e.target.value }; setForm(f => ({ ...f, lines })) }} /></td>
                  <td><MoneyInput unit={unit} value={l.debit} onChange={(v) => { const lines = [...form.lines]; lines[i] = { ...l, debit: v, credit: v ? null : l.credit }; setForm(f => ({ ...f, lines })) }} /></td>
                  <td><MoneyInput unit={unit} value={l.credit} onChange={(v) => { const lines = [...form.lines]; lines[i] = { ...l, credit: v, debit: v ? null : l.debit }; setForm(f => ({ ...f, lines })) }} /></td>
                  <td>{form.lines.length > 2 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>
                      <Icon name="trash" size={14} /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>جمع</td>
                <td><span className="num">{fmtMoney(td, unit)}</span></td>
                <td><span className="num">{fmtMoney(tc, unit)}</span></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={`badge ${balanced ? 'b-approved' : 'b-danger'}`}>
              {balanced ? '✓ سند متوازن است' : 'سند نامتوازن — ثبت قطعی ممنوع'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { account_code: '', tafsil_name: '', debit: null, credit: null, description: '', project_id: null }] }))}>
              <Icon name="plus" size={14} /> افزودن ردیف
            </button>
          </div>
        </Modal>
      )}

      {/* جزئیات سند */}
      {detail && (
        <Modal wide title={`سند ${detail.no}`} onClose={() => setDetail(null)}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            <b>تاریخ: <JDateText iso={detail.date} /></b>
            <b>وضعیت: <Badge k={detail.status} /></b>
            <b>مبدأ: {SOURCE_LABELS[detail.source_type] || detail.source_type}</b>
            <b>ثبت‌کننده: {detail.created_by}</b>
          </div>
          <div className="alert info">{detail.description}</div>
          <table className="tbl">
            <thead><tr><th>#</th><th>کد</th><th>حساب</th><th>تفصیلی</th><th>بدهکار</th><th>بستانکار</th></tr></thead>
            <tbody>
              {detail.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="num">{(i + 1).toLocaleString('fa-IR')}</td>
                  <td className="num">{l.account_code}</td>
                  <td>{l.account_name}</td>
                  <td>{l.tafsil_name || '—'}</td>
                  <td>{l.debit ? <Money rial={l.debit} unit={unit} /> : '—'}</td>
                  <td>{l.credit ? <Money rial={l.credit} unit={unit} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>جمع</td><td><Money rial={detail.total_debit} unit={unit} /></td><td><Money rial={detail.total_credit} unit={unit} /></td></tr></tfoot>
          </table>
        </Modal>
      )}

      {confirmAct && (
        <Confirm title={confirmAct.a === 'confirm' ? 'قطعی‌سازی سند' : 'ابطال سند'}
          message={confirmAct.a === 'confirm'
            ? `سند ${confirmAct.v.no} قطعی شود؟ پس از قطعی‌شدن، تغییر مستقیم ممنوع است.`
            : `سند ابطال معکوس برای ${confirmAct.v.no} صادر شود؟ سند اصلی حفظ و اثر آن خنثی می‌شود.`}
          danger={confirmAct.a === 'reverse'}
          onYes={() => act(confirmAct.v, confirmAct.a)} onNo={() => setConfirmAct(null)} />
      )}
    </div>
  )
}
