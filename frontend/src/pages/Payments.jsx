import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, Modal, Icon, MoneyInput, JDate, JDateText, Empty, Money, useToast, Confirm } from '../ui/components.jsx'
import { fmtMoney } from '../lib/format.js'
import { todayIso } from '../lib/jalali.js'

export default function Payments ({ user }) {
  const toast = useToast()
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [banks, setBanks] = useState([])
  const [funding, setFunding] = useState([])
  const [form, setForm] = useState(null)
  const [confirmAct, setConfirmAct] = useState(null)
  const canApprove = ['finance', 'admin'].includes(user.role)
  const canRecord = ['admin', 'finance', 'accountant'].includes(user.role)

  const load = () => call('GET', '/api/payments').then(setRows)
  useEffect(() => {
    load()
    call('GET', '/api/members').then(setMembers)
    call('GET', '/api/banks').then(setBanks)
    call('GET', '/api/funding?status=approved').then(setFunding)
  }, [])

  const openDeclare = () => setForm({
    pay_date: todayIso(), member_id: user.role === 'member' ? user.member_id : null,
    amount: null, method: 'transfer', bank_id: banks[0]?.id ?? null,
    tracking_no: '', receipt_ref: '', funding_id: null, note: '',
  })

  const save = async () => {
    if (!form.amount) return toast.error('مبلغ الزامی است')
    if (form.member_id == null) return toast.error('پرداخت‌کننده مشخص نیست')
    try {
      await call('POST', '/api/payments', form)
      toast(form.status_msg || 'اعلام پرداخت ثبت شد؛ پس از تأیید وصول، سند صادر می‌شود')
      setForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const decide = async (p, decision) => {
    try {
      await call('POST', `/api/payments/${p.id}/approve`, { decision, note: '' })
      toast(decision === 'approve' ? `وصول ${p.no} تأیید، سند صادر و به تعهدات تخصیص یافت` : 'پرداخت رد شد')
      setConfirmAct(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="alert info"><Icon name="payments" size={17} />
        <div><b>اعلام پرداخت ≠ تأیید وصول</b>
          پرداخت اعلام‌شده تا پیش از تأیید مدیر مالی، مانده وصول‌شده را افزایش نمی‌دهد و سند ندارد. پس از تأیید، سند حسابداری صادر و مبلغ به‌صورت خودکار (FIFO) به تعهدهای بازِ عضو تخصیص می‌یابد؛ مازاد به‌عنوان اعتبار تخصیص‌نیافته (طلب عضو) جداگانه نمایش داده می‌شود.
        </div>
      </div>

      <div className="card mb">
        <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <b>پرداخت‌های اعضا</b>
          {(canRecord || user.role === 'member') && (
            <button className="btn btn-primary" onClick={openDeclare}>
              <Icon name="plus" size={17} /> {user.role === 'member' ? 'اعلام پرداخت من' : 'ثبت/اعلام پرداخت'}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>شماره</th><th>تاریخ</th><th>عضو</th><th>مبلغ</th><th>روش</th><th>پیگیری</th>
                <th>مصوبه</th><th>تخصیص</th><th>وضعیت</th>{canApprove && <th></th>}</tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="num">{p.no}</td>
                  <td><JDateText iso={p.pay_date} /></td>
                  <td><b>{p.member_name}</b></td>
                  <td><Money rial={p.amount} unit={unit} bold /></td>
                  <td>{({ cash: 'نقدی', transfer: 'انتقال', cheque: 'چک' })[p.method]}</td>
                  <td className="num small">{p.tracking_no || '—'}</td>
                  <td className="num small">{p.funding_no || '—'}</td>
                  <td className="small num">
                    {p.status === 'approved' ? `${fmtMoney(p.allocated, unit)}${p.unallocated > 0 ? ` | مازاد: ${fmtMoney(p.unallocated, unit)}` : ''}` : '—'}
                  </td>
                  <td><Badge k={p.status} /></td>
                  {canApprove && (
                    <td>
                      {p.status === 'declared' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => setConfirmAct({ p, d: 'approve' })}>تأیید وصول</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmAct({ p, d: 'reject' })}>رد</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty icon="🧾" text="پرداختی ثبت نشده است" />}
        </div>
      </div>

      {form && (
        <Modal title={user.role === 'member' ? 'اعلام پرداخت من' : 'ثبت پرداخت عضو'} onClose={() => setForm(null)}
          foot={<>
            <button className="btn btn-primary" onClick={save}><Icon name="send" size={16} /> ثبت اعلام</button>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button>
          </>}>
          <div className="form-row">
            {user.role !== 'member' && (
              <div className="field"><label>عضو پرداخت‌کننده *</label>
                <select className="input" value={form.member_id || ''} onChange={(e) => setForm(f => ({ ...f, member_id: Number(e.target.value) }))}>
                  <option value="">انتخاب…</option>
                  {members.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select></div>
            )}
            <div className="field"><label>تاریخ پرداخت *</label>
              <JDate value={form.pay_date} onChange={(v) => setForm(f => ({ ...f, pay_date: v || todayIso() }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>مبلغ ({unit === 'toman' ? 'تومان' : 'ریال'}) *</label>
              <MoneyInput unit={unit} value={form.amount} onChange={(v) => setForm(f => ({ ...f, amount: v }))} /></div>
            <div className="field"><label>روش</label>
              <select className="input" value={form.method} onChange={(e) => setForm(f => ({ ...f, method: e.target.value }))}>
                <option value="transfer">انتقال بانکی</option>
                <option value="cash">نقدی</option>
                <option value="cheque">چک</option>
              </select></div>
          </div>
          <div className="form-row">
            <div className="field"><label>حساب مقصد</label>
              <select className="input" value={form.bank_id || ''} onChange={(e) => setForm(f => ({ ...f, bank_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">—</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div className="field"><label>درخواست تأمین مالی مرتبط</label>
              <select className="input" value={form.funding_id || ''} onChange={(e) => setForm(f => ({ ...f, funding_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— تخصیص خودکار به تعهدها —</option>
                {funding.map(f => <option key={f.id} value={f.id}>{f.no} — {f.title}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="field"><label>شماره پیگیری</label>
              <input className="input num" value={form.tracking_no} onChange={(e) => setForm(f => ({ ...f, tracking_no: e.target.value }))} /></div>
            <div className="field"><label>مرجع رسید</label>
              <input className="input" value={form.receipt_ref} onChange={(e) => setForm(f => ({ ...f, receipt_ref: e.target.value }))} /></div>
          </div>
          <div className="field"><label>توضیحات</label>
            <textarea className="input" rows={2} value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} /></div>
        </Modal>
      )}

      {confirmAct && (
        <Confirm title="تأیید وصول پرداخت"
          message={confirmAct.d === 'approve'
            ? `پرداخت ${confirmAct.p.no} به مبلغ ${fmtMoney(confirmAct.p.amount, unit)} از ${confirmAct.p.member_name} تأیید شود؟ سند حسابداری صادر و مبلغ به تعهدهای عضو تخصیص می‌یابد.`
            : 'این پرداخت رد شود؟'}
          danger={confirmAct.d === 'reject'}
          onYes={() => decide(confirmAct.p, confirmAct.d)} onNo={() => setConfirmAct(null)} />
      )}
    </div>
  )
}
