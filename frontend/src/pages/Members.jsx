import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, Modal, Icon, JDate, JDateText, Empty, Money, useToast } from '../ui/components.jsx'
import { fmtMoney, fmtBp } from '../lib/format.js'
import { formatJalali } from '../lib/jalali.js'

export default function Members ({ user }) {
  const toast = useToast()
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState(null)       // عضو انتخابی برای جزئیات
  const [statement, setStatement] = useState(null)
  const [shares, setShares] = useState([])
  const [addForm, setAddForm] = useState(null)
  const canManage = ['admin', 'finance'].includes(user.role)

  const load = () => call('GET', '/api/members').then(setRows)
  useEffect(() => { load() }, [])
  const open = async (m) => {
    setSel(m)
    setStatement(await call('GET', `/api/members/${m.id}/statement`))
    setShares(await call('GET', `/api/members/${m.id}/shares`))
  }

  const saveMember = async () => {
    if (!addForm.full_name?.trim() || !addForm.code?.trim()) return toast.error('کد و نام عضو الزامی است')
    try {
      if (addForm.id) {
        await call('PATCH', `/api/members/${addForm.id}`, addForm)
        toast('عضو ویرایش شد')
      } else {
        await call('POST', '/api/members', addForm)
        toast('عضو جدید ثبت شد')
      }
      setAddForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const addShare = async () => {
    try {
      await call('POST', `/api/members/${addForm.member_id}/shares`, addForm.share)
      toast('رکورد سهام ثبت شد (تاریخچه حفظ می‌شود)')
      setAddForm(null)
      open(rows.find(m => m.id === addForm.member_id))
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="card mb">
        <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <b>اعضا، سهامداران و طرف‌های حساب</b>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setAddForm({ code: '', full_name: '', kind: 'person', national_id: '', phone: '', email: '', bank_account: '', note: '' })}>
              <Icon name="plus" size={17} /> عضو جدید
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>کد</th><th>نام</th><th>نوع</th><th>تماس</th><th>سهم فعلی</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id}>
                  <td className="num">{m.code}</td>
                  <td><b>{m.full_name}</b>{m.bank_account && <div className="small muted">{m.bank_account}</div>}</td>
                  <td><Badge k={m.kind} /></td>
                  <td className="num">{m.phone || '—'}</td>
                  <td className="num">{m.share_now_bp ? fmtBp(m.share_now_bp) : '—'}</td>
                  <td><Badge k={m.is_active ? 'approved' : 'rejected'} text={m.is_active ? 'فعال' : 'غیرفعال'} /></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => open(m)}><Icon name="eye" size={14} /> پرونده</button>
                    {canManage && <button className="btn btn-ghost btn-sm" onClick={() => setAddForm({ ...m, id: m.id })}><Icon name="edit" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty text="عضوی ثبت نشده است" />}
        </div>
      </div>

      {/* پرونده عضو */}
      {sel && statement && (
        <Modal wide title={`پرونده ${sel.full_name}`} onClose={() => setSel(null)}>
          <div className="tabs">
            <button className="tab active">وضعیت حساب</button>
            <button className="tab" onClick={() => setAddForm({ member_id: sel.id, share: { percent_bp: 0, from_date: '', to_date: null, doc_ref: '', note: '' } })}>
              + افزودن تغییر سهام
            </button>
          </div>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            <div className="stat s1"><div className="stat-label">مجموع تعهد مصوب</div><div className="stat-value num">{fmtMoney(statement.totals.commitments, unit)}</div></div>
            <div className="stat s2"><div className="stat-label">وصول/تهاتر</div><div className="stat-value num">{fmtMoney(statement.totals.total_settled, unit)}</div></div>
            <div className="stat s3"><div className="stat-label">مانده تعهد</div><div className="stat-value num">{fmtMoney(statement.totals.commitments_remaining, unit)}</div></div>
            <div className="stat s4"><div className="stat-label">اعتبار تخصیص‌نیافته (طلب عضو)</div><div className="stat-value num">{fmtMoney(Math.max(statement.totals.unallocated_credit, 0), unit)}</div></div>
          </div>

          <div className="grid-2 mb" style={{ gap: 12 }}>
            <div className="card pad small">
              <b>مانده دفتری هر نوع حساب (تفصیلی عضو)</b>
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>جاری شرکا (۲۱۰۲)</span><Money rial={statement.balances.current} unit={unit} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>وام دریافتی از عضو (۲۱۰۳)</span><Money rial={statement.balances.loan} unit={unit} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>سرمایه (۳۱۰۱)</span><Money rial={statement.balances.capital} unit={unit} /></div>
              </div>
            </div>
            <div className="card pad small">
              <b>تاریخچه سهام</b>
              {shares.length === 0 && <div className="muted" style={{ marginTop: 8 }}>بدون سهم ثبت‌شده (عضو غیرسهامدار)</div>}
              {shares.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span className="num">{fmtBp(s.percent_bp)}</span>
                  <span className="muted num"><JDateText iso={s.from_date} /> {s.to_date ? `تا ${formatJalali(s.to_date)}` : 'تاکنون'}</span>
                </div>
              ))}
            </div>
          </div>

          <h4 style={{ margin: '10px 0 8px', fontSize: 14 }}>تعهدات مصوب</h4>
          <table className="tbl">
            <thead><tr><th>مصوبه</th><th>نوع</th><th>تعهد</th><th>پرداخت/تهاتر</th><th>مانده</th><th>سررسید</th><th></th></tr></thead>
            <tbody>
              {statement.commitments.map(c => (
                <tr key={c.id}>
                  <td className="num">{c.funding_no}</td>
                  <td><Badge k={c.funding_type} /></td>
                  <td><Money rial={c.amount} unit={unit} /></td>
                  <td><Money rial={c.paid} unit={unit} /></td>
                  <td><Money rial={c.remaining} unit={unit} /></td>
                  <td>{c.due_date ? <JDateText iso={c.due_date} /> : '—'}</td>
                  <td><Badge k={c.settled ? 'paid' : c.paid > 0 ? 'partial' : 'unpaid'} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ margin: '18px 0 8px', fontSize: 14 }}>گردش پرداخت‌های عضو</h4>
          <table className="tbl">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>مبلغ</th><th>پیگیری</th><th>تخصیص</th><th>وضعیت</th></tr></thead>
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
            </tbody>
          </table>

          {statement.credits.length > 0 && (
            <>
              <h4 style={{ margin: '18px 0 8px', fontSize: 14 }}>اعتبار بابت هزینه‌های پرداخت‌شده توسط عضو</h4>
              <table className="tbl">
                <thead><tr><th>هزینه</th><th>مبلغ</th><th>مانده اعتبار</th></tr></thead>
                <tbody>
                  {statement.credits.map(c => (
                    <tr key={c.id}>
                      <td className="num">{c.expense_no} — {c.expense_title}</td>
                      <td><Money rial={c.amount} unit={unit} /></td>
                      <td><Money rial={c.remaining} unit={unit} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {/* فرم عضو / سهام */}
      {addForm && addForm.share ? (
        <Modal title={`تغییر سهم — ${sel?.full_name || ''}`} onClose={() => setAddForm(null)}
          foot={<><button className="btn btn-primary" onClick={addShare}>ذخیره</button>
            <button className="btn btn-ghost" onClick={() => setAddForm(null)}>انصراف</button></>}>
          <div className="alert info">سهم جدید پس از دوره قبلی شروع می‌شود؛ محاسبات تعهدهای تأییدشده گذشته تغییر نمی‌کند.</div>
          <div className="field"><label>درصد سهم جدید (٪) *</label>
            <input className="input num" type="number" step="0.01" min="0" max="100"
              value={addForm.share.percent_bp ? addForm.share.percent_bp / 100 : ''}
              onChange={(e) => setAddForm(f => ({ ...f, share: { ...f.share, percent_bp: Math.round(Number(e.target.value || 0) * 100) } }))} /></div>
          <div className="form-row">
            <div className="field"><label>از تاریخ *</label>
              <JDate value={addForm.share.from_date} onChange={(v) => setAddForm(f => ({ ...f, share: { ...f.share, from_date: v || '' } }))} /></div>
            <div className="field"><label>تا تاریخ (خالی = تاکنون)</label>
              <JDate value={addForm.share.to_date} onChange={(v) => setAddForm(f => ({ ...f, share: { ...f.share, to_date: v } }))} /></div>
          </div>
          <div className="field"><label>مستند (صورتجلسه)</label>
            <input className="input" value={addForm.share.doc_ref} onChange={(e) => setAddForm(f => ({ ...f, share: { ...f.share, doc_ref: e.target.value } }))} /></div>
        </Modal>
      ) : addForm ? (
        <Modal title={addForm.id ? 'ویرایش عضو' : 'عضو جدید'} onClose={() => setAddForm(null)}
          foot={<><button className="btn btn-primary" onClick={saveMember}>ذخیره</button>
            <button className="btn btn-ghost" onClick={() => setAddForm(null)}>انصراف</button></>}>
          <div className="form-row">
            <div className="field"><label>کد *</label><input className="input num" value={addForm.code} onChange={(e) => setAddForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div className="field"><label>نام *</label><input className="input" value={addForm.full_name} onChange={(e) => setAddForm(f => ({ ...f, full_name: e.target.value }))} /></div>
          </div>
          <div className="form-row-3">
            <div className="field"><label>نوع</label>
              <select className="input" value={addForm.kind} onChange={(e) => setAddForm(f => ({ ...f, kind: e.target.value }))}>
                <option value="person">شخص حقیقی</option><option value="legal">شخص حقوقی</option>
              </select></div>
            <div className="field"><label>شناسه ملی/کد ملی</label><input className="input num" value={addForm.national_id} onChange={(e) => setAddForm(f => ({ ...f, national_id: e.target.value }))} /></div>
            <div className="field"><label>تلفن</label><input className="input num" value={addForm.phone} onChange={(e) => setAddForm(f => ({ ...f, phone: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>ایمیل</label><input className="input" value={addForm.email} onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label>حساب بانکی</label><input className="input num" value={addForm.bank_account} onChange={(e) => setAddForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
