import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call, uploadAttachment, downloadAttachment } from '../api/index.js'
import { Badge, Modal, Icon, MoneyInput, JDate, JDateText, Empty, Money, useToast, Confirm } from '../ui/components.jsx'
import { fmtMoney } from '../lib/format.js'
import { todayIso } from '../lib/jalali.js'

const EXPENSE_CATS = [
  ['51011', 'حقوق و دستمزد'], ['51021', 'اجاره دفتر مرکزی'], ['51031', 'تجهیزات اداری'],
  ['51032', 'ملزومات مصرفی'], ['51041', 'خدمات فنی و نرم‌افزاری'], ['5105', 'حمل‌ونقل'],
  ['5106', 'تبلیغات و بازاریابی'], ['51071', 'اینترنت و ارتباطات'], ['51072', 'آب، برق و گاز'],
  ['5108', 'بیمه و مالیات و عوارض'], ['5109', 'سایر هزینه‌های عملیاتی'],
  ['1301', 'خرید دارایی ثابت'], ['1201', 'پیش‌پرداخت / ودیعه'],
]

const EMPTY_FORM = {
  exp_date: todayIso(), title: '', description: '', base_amount: null, tax_amount: null,
  party_name: '', category_code: '51041', project_id: null, payer_type: 'company',
  payer_member_id: null, paid_via: 'bank', bank_id: null, pay_status: 'unpaid',
  invoice_no: '', asset_kind: 'expense', note: '',
}

export default function Expenses ({ user }) {
  const toast = useToast()
  const { settings, navigate } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [projects, setProjects] = useState([])
  const [banks, setBanks] = useState([])
  const [filters, setFilters] = useState({ q: '', status: '', pay_status: '', project_id: '' })
  const [edit, setEdit] = useState(null)        // فرم ایجاد/ویرایش
  const [detail, setDetail] = useState(null)    // جزئیات + تسویه
  const [dupWarn, setDupWarn] = useState([])
  const [confirmAct, setConfirmAct] = useState(null)
  const canEdit = ['admin', 'finance', 'accountant'].includes(user.role)
  const isMember = user.role === 'member'

  const load = () => {
    call('GET', '/api/expenses', null, filters).then(setRows)
  }
  useEffect(() => { load() }, [filters])
  useEffect(() => {
    call('GET', '/api/members').then(setMembers)
    call('GET', '/api/projects').then(setProjects)
    call('GET', '/api/banks').then(setBanks)
  }, [])

  const openNew = () => setEdit({ ...EMPTY_FORM, id: null })
  const openEdit = (e) => setEdit({ ...e, base_amount: e.base_amount, tax_amount: e.tax_amount })

  const checkDup = async (form) => {
    try {
      const res = await call('GET', '/api/expenses/dupcheck', null, {
        invoice_no: form.invoice_no, party_name: form.party_name, total_amount: (form.base_amount || 0) + (form.tax_amount || 0),
      })
      setDupWarn(res.duplicates || [])
    } catch { setDupWarn([]) }
  }

  const save = async () => {
    if (!edit.title?.trim()) return toast.error('عنوان هزینه الزامی است')
    if (!edit.base_amount) return toast.error('مبلغ پایه الزامی است')
    if (edit.payer_type === 'member' && !edit.payer_member_id) return toast.error('پرداخت‌کننده عضو را انتخاب کنید')
    try {
      if (edit.id) {
        await call('PATCH', `/api/expenses/${edit.id}`, edit)
        toast('هزینه ویرایش شد')
      } else {
        await call('POST', '/api/expenses', edit)
        toast('هزینه ثبت شد؛ پس از بررسی مدارک برای تأیید ارسال کنید')
      }
      setEdit(null); setDupWarn([]); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const doSubmit = async (e) => {
    try { await call('POST', `/api/expenses/${e.id}/submit`); toast('برای تأیید ارسال شد'); load() } catch (ex) { toast.error(ex.message) }
  }
  const decide = async (e, decision) => {
    try {
      await call('POST', `/api/expenses/${e.id}/approve`, { decision, note: '' })
      toast(decision === 'approve' ? `هزینه ${e.no} تأیید و سند حسابداری آن ثبت شد` : 'هزینه رد شد')
      load(); setConfirmAct(null)
    } catch (ex) { toast.error(ex.message) }
  }
  const doSettle = async (amount, date, via, bankId) => {
    try {
      await call('POST', `/api/expenses/${detail.id}/settle`, { amount, date, via, bank_id: bankId })
      toast('تسویه ثبت و سند آن صادر شد')
      const fresh = await call('GET', `/api/expenses/${detail.id}`)
      setDetail(fresh); load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="card mb">
        <div className="pad">
          <div className="filters">
            <div className="field grow">
              <label>جستجو</label>
              <input className="input" placeholder="عنوان، طرف حساب، شماره…" value={filters.q}
                onChange={(e) => setFilters(f => ({ ...f, q: e.target.value }))} />
            </div>
            <div className="field">
              <label>وضعیت تأیید</label>
              <select className="input" value={filters.status} onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">همه</option>
                {['draft', 'pending', 'approved', 'rejected'].map(s => <option key={s} value={s}>{({ draft: 'پیش‌نویس', pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده' })[s]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>وضعیت پرداخت</label>
              <select className="input" value={filters.pay_status} onChange={(e) => setFilters(f => ({ ...f, pay_status: e.target.value }))}>
                <option value="">همه</option>
                {['unpaid', 'partial', 'paid'].map(s => <option key={s} value={s}>{({ unpaid: 'پرداخت‌نشده', partial: 'بخشی', paid: 'تسویه‌شده' })[s]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>پروژه</label>
              <select className="input" value={filters.project_id} onChange={(e) => setFilters(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">همه</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {canEdit && <button className="btn btn-primary" onClick={openNew}><Icon name="plus" size={17} /> ثبت هزینه</button>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>شماره</th><th>تاریخ</th><th>عنوان</th><th>طرف حساب</th>
                <th>مبلغ نهایی</th><th>پرداخت‌کننده</th><th>تأیید</th><th>پرداخت</th>
                <th style={{ width: 170 }}>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id}>
                  <td className="num">{e.no}</td>
                  <td><JDateText iso={e.exp_date} /></td>
                  <td>
                    <b>{e.title}</b>
                    {e.asset_kind !== 'expense' && <> <Badge k={e.asset_kind} /></>}
                    {e.project_name && <div className="small muted">{e.project_name}</div>}
                  </td>
                  <td>{e.party_name}</td>
                  <td><Money rial={e.total_amount} unit={unit} bold /></td>
                  <td>{e.payer_type === 'member' ? <Badge k="b-info" text={e.payer_name} /> : 'شرکت'}</td>
                  <td><Badge k={e.appr_status} /></td>
                  <td><Badge k={e.pay_status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={async () => setDetail(await call('GET', `/api/expenses/${e.id}`))}>
                        <Icon name="eye" size={14} /> جزئیات
                      </button>
                      {canEdit && e.appr_status === 'draft' && (
                        <>
                          <button className="btn btn-soft btn-sm" onClick={() => doSubmit(e)}><Icon name="send" size={14} /> ارسال</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e)}><Icon name="edit" size={14} /></button>
                        </>
                      )}
                      {user.role === 'ceo' && e.appr_status === 'pending' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => setConfirmAct({ e, d: 'approve' })}>تأیید</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmAct({ e, d: 'reject' })}>رد</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty text="هزینه‌ای مطابق فیلترها یافت نشد" />}
        </div>
      </div>

      {/* ------- فرم ایجاد/ویرایش ------- */}
      {edit && (
        <Modal wide title={edit.id ? `ویرایش هزینه ${edit.no}` : 'ثبت هزینه جدید'} onClose={() => { setEdit(null); setDupWarn([]) }}
          foot={
            <>
              <button className="btn btn-primary" onClick={save}><Icon name="check" size={16} /> ذخیره</button>
              <button className="btn btn-ghost" onClick={() => { setEdit(null); setDupWarn([]) }}>انصراف</button>
            </>
          }>
          {dupWarn.length > 0 && (
            <div className="alert warn">
              <Icon name="alert" size={17} />
              <div><b>هشدار فاکتور تکراری</b>
                {dupWarn.map(d => <div key={d.id} className="num small">{d.no} — {d.title} — {fmtMoney(d.total_amount, unit)}</div>)}
              </div>
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <label>عنوان هزینه *</label>
              <input className="input" value={edit.title} onChange={(e) => setEdit(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="field">
              <label>تاریخ وقوع *</label>
              <JDate value={edit.exp_date} onChange={(v) => setEdit(f => ({ ...f, exp_date: v || todayIso() }))} />
            </div>
          </div>
          <div className="form-row-3">
            <div className="field">
              <label>مبلغ پایه ({unit === 'toman' ? 'تومان' : 'ریال'}) *</label>
              <MoneyInput unit={unit} value={edit.base_amount} onChange={(v) => { setEdit(f => ({ ...f, base_amount: v })); checkDup({ ...edit, base_amount: v }) }} />
            </div>
            <div className="field">
              <label>مالیات و عوارض</label>
              <MoneyInput unit={unit} value={edit.tax_amount} onChange={(v) => setEdit(f => ({ ...f, tax_amount: v }))} />
            </div>
            <div className="field">
              <label>مبلغ نهایی</label>
              <input className="input num" disabled value={fmtMoney((edit.base_amount || 0) + (edit.tax_amount || 0), unit)} />
            </div>
          </div>
          <div className="form-row-3">
            <div className="field">
              <label>نوع / حساب مرتبط</label>
              <select className="input" value={edit.category_code} onChange={(e) => setEdit(f => ({ ...f, category_code: e.target.value }))}>
                {EXPENSE_CATS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label>طرف حساب (فروشنده / پیمانکار)</label>
              <input className="input" value={edit.party_name} onChange={(e) => { setEdit(f => ({ ...f, party_name: e.target.value })); checkDup({ ...edit, party_name: e.target.value }) }} />
            </div>
            <div className="field">
              <label>پروژه / مرکز هزینه</label>
              <select className="input" value={edit.project_id || ''} onChange={(e) => setEdit(f => ({ ...f, project_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">بدون پروژه</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row-3">
            <div className="field">
              <label>پرداخت‌کننده</label>
              <select className="input" value={edit.payer_type} onChange={(e) => setEdit(f => ({ ...f, payer_type: e.target.value }))}>
                <option value="company">شرکت</option>
                <option value="member">عضو (از حساب شخصی)</option>
              </select>
            </div>
            {edit.payer_type === 'member' ? (
              <div className="field">
                <label>عضو پرداخت‌کننده</label>
                <select className="input" value={edit.payer_member_id || ''} onChange={(e) => setEdit(f => ({ ...f, payer_member_id: Number(e.target.value) }))}>
                  <option value="">انتخاب عضو…</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="field">
                  <label>نحوه پرداخت</label>
                  <select className="input" value={edit.paid_via} onChange={(e) => setEdit(f => ({ ...f, paid_via: e.target.value }))}>
                    <option value="bank">انتقال بانکی</option>
                    <option value="cash">نقدی (صندوق)</option>
                    <option value="none">پرداخت‌نشده (نسیه)</option>
                  </select>
                </div>
                {edit.paid_via === 'bank' && (
                  <div className="field">
                    <label>حساب بانکی</label>
                    <select className="input" value={edit.bank_id || ''} onChange={(e) => setEdit(f => ({ ...f, bank_id: e.target.value ? Number(e.target.value) : null }))}>
                      {banks.filter(b => b.kind === 'bank').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
            <div className="field">
              <label>طبقه‌بندی</label>
              <select className="input" value={edit.asset_kind} onChange={(e) => setEdit(f => ({ ...f, asset_kind: e.target.value }))}>
                <option value="expense">هزینه عملیاتی</option>
                <option value="asset">خرید دارایی</option>
                <option value="deposit">پیش‌پرداخت / ودیعه</option>
              </select>
            </div>
          </div>
          <div className="form-row-3">
            <div className="field">
              <label>شماره فاکتور / رسید</label>
              <input className="input" value={edit.invoice_no} onChange={(e) => setEdit(f => ({ ...f, invoice_no: e.target.value }))} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label>شرح</label>
              <textarea className="input" rows={2} value={edit.description} onChange={(e) => setEdit(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {/* ------- جزئیات و تسویه ------- */}
      {detail && <ExpenseDetail detail={detail} setDetail={setDetail} canEdit={canEdit} unit={unit}
        banks={banks} onSettle={doSettle} onUpload={async (file) => {
          try {
            await uploadAttachment(detail.id, file)
            toast('پیوست ذخیره شد')
            setDetail(await call('GET', `/api/expenses/${detail.id}`)); load()
          } catch (ex) { toast.error(ex.message) }
        }} onClose={() => setDetail(null)} />}
      {confirmAct && (
        <Confirm
          title={confirmAct.d === 'approve' ? 'تأیید هزینه' : 'رد هزینه'}
          message={confirmAct.d === 'approve'
            ? `هزینه «${confirmAct.e.title}» به مبلغ ${fmtMoney(confirmAct.e.total_amount, unit)} تأیید و سند حسابداری آن به‌صورت خودکار ثبت می‌شود. ادامه؟`
            : `هزینه «${confirmAct.e.title}» رد شود؟`}
          danger={confirmAct.d === 'reject'}
          onYes={() => decide(confirmAct.e, confirmAct.d)}
          onNo={() => setConfirmAct(null)} />
      )}
    </div>
  )
}

function ExpenseDetail ({ detail, setDetail, canEdit, unit, banks, onSettle, onUpload, onClose }) {
  const toast = useToast()
  const [settleOpen, setSettleOpen] = useState(false)
  const [sAmount, setSAmount] = useState(null)
  const [sDate, setSDate] = useState(todayIso())
  const [sVia, setSVia] = useState('bank')
  const [sBank, setSBank] = useState(null)
  const remaining = detail.total_amount - detail.paid_amount

  const del = async (att) => {
    try {
      await call('DELETE', `/api/expenses/${detail.id}/attachments/${att.id}`)
      setDetail(await call('GET', `/api/expenses/${detail.id}`))
      toast('پیوست حذف شد')
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <Modal wide title={`جزئیات هزینه ${detail.no}`} onClose={onClose}>
      <div className="grid-2" style={{ gap: 14 }}>
        <InfoRow label="عنوان" v={detail.title} />
        <InfoRow label="تاریخ وقوع" v={<JDateText iso={detail.exp_date} />} />
        <InfoRow label="طرف حساب" v={detail.party_name || '—'} />
        <InfoRow label="نوع / حساب" v={detail.category_name} />
        <InfoRow label="مبلغ نهایی" v={<Money rial={detail.total_amount} unit={unit} bold />} />
        <InfoRow label="پرداخت‌شده" v={<Money rial={detail.paid_amount} unit={unit} />} />
        <InfoRow label="پرداخت‌کننده" v={detail.payer_type === 'member' ? detail.payer_name : 'شرکت'} />
        <InfoRow label="پروژه" v={detail.project_name || '—'} />
        <InfoRow label="وضعیت تأیید" v={<Badge k={detail.appr_status} />} />
        <InfoRow label="وضعیت پرداخت" v={<Badge k={detail.pay_status} />} />
        <InfoRow label="شماره فاکتور" v={detail.invoice_no || '—'} />
        <InfoRow label="ثبت‌کننده" v={detail.created_by} />
      </div>
      {detail.description && <div className="alert info" style={{ marginTop: 14 }}><div><b>شرح</b>{detail.description}</div></div>}

      <h4 style={{ margin: '18px 0 10px', fontSize: 14 }}>پیوست‌ها</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {detail.attachments.map(a => (
          <span key={a.id} className="badge b-muted" style={{ padding: '6px 12px' }}>
            <Icon name="doc" size={13} /> {a.name}
            <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px' }}
              onClick={() => downloadAttachment(a)}><Icon name="download" size={13} /></button>
            {canEdit && <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px' }} onClick={() => del(a)}><Icon name="trash" size={13} /></button>}
          </span>
        ))}
        <label className="btn btn-soft btn-sm" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={14} /> افزودن پیوست
          <input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])} />
        </label>
      </div>

      {canEdit && detail.appr_status === 'approved' && detail.payer_type === 'company' && remaining > 0 && (
        <>
          <h4 style={{ margin: '18px 0 10px', fontSize: 14 }}>تسویه بدهی به فروشنده</h4>
          {!settleOpen && (
            <button className="btn btn-primary btn-sm" onClick={() => setSettleOpen(true)}>
              <Icon name="wallet" size={15} /> ثبت پرداخت به فروشنده — مانده {fmtMoney(remaining, unit)}
            </button>
          )}
          {settleOpen && (
            <div className="card pad" style={{ background: 'var(--bg-soft)' }}>
              <div className="form-row-3">
                <div className="field">
                  <label>مبلغ پرداخت</label>
                  <MoneyInput unit={unit} value={sAmount} onChange={setSAmount} placeholder={`حداکثر ${fmtMoney(remaining, unit)}`} />
                </div>
                <div className="field">
                  <label>تاریخ</label>
                  <JDate value={sDate} onChange={setSDate} />
                </div>
                <div className="field">
                  <label>از</label>
                  <select className="input" value={sVia} onChange={(e) => setSVia(e.target.value)}>
                    <option value="bank">بانک</option>
                    <option value="cash">صندوق</option>
                  </select>
                </div>
              </div>
              {sVia === 'bank' && (
                <div className="field">
                  <label>حساب بانکی</label>
                  <select className="input" value={sBank || ''} onChange={(e) => setSBank(e.target.value ? Number(e.target.value) : null)}>
                    {banks.filter(b => b.kind === 'bank').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!sAmount}
                  onClick={() => doSettleRemote(sAmount, sDate, sVia, sBank)}>ثبت تسویه</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSettleOpen(false)}>انصراف</button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )

  function doSettleRemote (a, d, v, b) {
    onSettle(a, d, v, b)
    setSettleOpen(false)
  }
}

function InfoRow ({ label, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f3f9', padding: '7px 0', gap: 10 }}>
      <span className="small muted">{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{v}</span>
    </div>
  )
}
