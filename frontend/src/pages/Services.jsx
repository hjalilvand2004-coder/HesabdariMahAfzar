import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Modal, Icon, Badge, JDate, JDateText, Empty, MoneyInput, Money, useToast } from '../ui/components.jsx'
import { PageHeader } from '../ui/Help.jsx'
import { fmtMoney, stypeLabels, serviceStatusLabels, compMethodLabels } from '../lib/format.js'

const SERVICE_STATUSES = { draft: 'draft', pending: 'pending', compensated: 'paid', rejected: 'rejected' }

export default function Services ({ user, settings }) {
  const toast = useToast()
  const { settings: st } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [banks, setBanks] = useState([])
  const [form, setForm] = useState(null)
  const [approve, setApprove] = useState(null)
  const [filter, setFilter] = useState('')
  const isMember = user.role === 'member'
  const canManage = ['admin', 'finance', 'accountant'].includes(user.role)
  const canDecide = user.role === 'ceo'

  const load = () => call('GET', '/api/services', null, filter ? { status: filter } : null).then(setRows)
  useEffect(() => {
    load()
    call('GET', '/api/members').then(setMembers)
    call('GET', '/api/banks').then(setBanks)
  }, [])
  useEffect(() => { load() }, [filter])

  const totalPending = rows.filter(r => ['draft', 'pending'].includes(r.status)).reduce((s, r) => s + r.amount, 0)
  const totalDone = rows.filter(r => r.status === 'compensated').reduce((s, r) => s + r.amount, 0)

  const save = async () => {
    if (!form.member_id) return toast.error('عضو ارائه‌دهنده خدمت را انتخاب کنید')
    if (!form.title?.trim()) return toast.error('عنوان خدمت الزامی است')
    if (!form.sdate) return toast.error('تاریخ ارائه خدمت را انتخاب کنید')
    if (!(Number(form.qty) > 0) || !(Number(form.unit_price) > 0)) return toast.error('تعداد و نرخ باید بزرگ‌تر از صفر باشد')
    try {
      if (form.id) {
        await call('PATCH', `/api/services/${form.id}`, form)
        toast('خدمت ویرایش شد')
      } else {
        await call('POST', '/api/services', form)
        toast('خدمت ثبت شد (پیش‌نویس)')
      }
      setForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const submit = async (s) => {
    try {
      await call('POST', `/api/services/${s.id}/submit`)
      toast('خدمت برای تأیید و تعیین روش جبران ارسال شد')
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  const decide = async (yes) => {
    try {
      await call('POST', `/api/services/${approve.id}/approve`, yes ? {
        comp_method: approve.comp_method, bank_id: approve.comp_method === 'cash' ? approve.bank_id : null,
        comp_date: approve.comp_date, note: approve.note,
      } : { decision: 'reject', note: approve.note })
      toast(yes ? 'خدمت تأیید و جبران شد؛ سند حسابداری صادر گردید' : 'خدمت رد شد')
      setApprove(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const remove = async (s) => {
    try {
      await call('DELETE', `/api/services/${s.id}`)
      toast('پیش‌نویس خدمت حذف شد')
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  const liveAmount = form ? (Number(form.qty || 0) * Number(form.unit_price || 0)) : 0

  return (
    <div className="page">
      <PageHeader icon="services" topic="services" title="خدمات اعضا و جبران خدمات"
        subtitle="ثبت خدماتی که اعضای شرکت ارائه می‌کنند و نحوه محاسبه و جبران آن‌ها — مبلغ = تعداد × نرخ"
        actions={!isMember && (
          <button className="btn btn-primary" onClick={() => setForm({ member_id: '', sdate: '', stype: 'tech', title: '', description: '', qty: '', unit: 'ساعت', unit_price: '', calc_note: '' })}>
            <Icon name="plus" size={16} /> خدمت جدید
          </button>
        )} />

      <div className="stat-grid stat-grid-3 mb">
        <div className="stat s1">
          <span className="stat-icon"><Icon name="services" size={30} /></span>
          <div className="stat-label">خدمات ثبت‌شده</div>
          <div className="stat-value num">{rows.length.toLocaleString('fa-IR')}</div>
          <div className="stat-foot">{isMember ? 'خدمات شما برای شرکت' : 'همه اعضا'}</div>
        </div>
        <div className="stat s3">
          <span className="stat-icon"><Icon name="clock" size={30} /></span>
          <div className="stat-label">در انتظار جبران</div>
          <div className="stat-value num">{fmtMoney(totalPending, unit)}</div>
          <div className="stat-foot">پیش‌نویس و در انتظار تأیید</div>
        </div>
        <div className="stat s2">
          <span className="stat-icon"><Icon name="check" size={30} /></span>
          <div className="stat-label">جبران‌شده</div>
          <div className="stat-value num">{fmtMoney(totalDone, unit)}</div>
          <div className="stat-foot">سند قطعی دارد</div>
        </div>
      </div>

      {!isMember && (
        <div className="filters mb">
          <div className="field">
            <label>فیلتر وضعیت</label>
            <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">همه</option>
              <option value="draft">پیش‌نویس</option>
              <option value="pending">در انتظار تأیید</option>
              <option value="compensated">جبران‌شده</option>
              <option value="rejected">ردشده</option>
            </select>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>شماره</th><th>عضو</th><th>تاریخ</th><th>نوع خدمت</th><th>عنوان</th>
                <th>محاسبه</th><th>مبلغ</th><th>وضعیت</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td className="num">{s.no}</td>
                  <td><b>{s.member_name}</b></td>
                  <td><JDateText iso={s.sdate} /></td>
                  <td className="small">{stypeLabels[s.stype] || s.stype}</td>
                  <td>
                    {s.title}
                    {s.calc_note && <div className="small muted" style={{ marginTop: 3 }}>نحوه محاسبه: {s.calc_note}</div>}
                    {s.status === 'compensated' && (
                      <div className="small" style={{ marginTop: 3 }}>
                        <Badge k="b-info" text={compMethodLabels[s.comp_method] || ''} />
                        {s.comp_date && <> <span className="muted num small"> — <JDateText iso={s.comp_date} /></span></>}
                      </div>
                    )}
                  </td>
                  <td className="small num">{s.qty.toLocaleString('fa-IR')} {s.unit} × {fmtMoney(s.unit_price, unit)}</td>
                  <td><Money rial={s.amount} unit={unit} bold /></td>
                  <td><Badge k={SERVICE_STATUSES[s.status]} text={serviceStatusLabels[s.status]} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap' }}>
                      {canManage && s.status === 'draft' && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...s })}><Icon name="edit" size={13} /></button>
                          <button className="btn btn-soft btn-sm" onClick={() => submit(s)}><Icon name="send" size={13} /> ارسال</button>
                          <button className="btn btn-danger btn-sm" onClick={() => remove(s)} title="حذف پیش‌نویس"><Icon name="trash" size={13} /></button>
                        </>
                      )}
                      {canManage && s.status === 'rejected' && s.status !== 'draft' && (
                        <button className="btn btn-soft btn-sm" onClick={() => submit(s)}>ارسال مجدد</button>
                      )}
                      {canDecide && s.status === 'pending' && (
                        <button className="btn btn-primary btn-sm" onClick={() => setApprove({ ...s, comp_method: 'credit', bank_id: banks[0]?.id || '', comp_date: s.sdate, note: '' })}>
                          <Icon name="check" size={13} /> تأیید و جبران
                        </button>
                      )}
                      {isMember && ['draft', 'pending', 'rejected'].includes(s.status) && <span className="small muted">در جریان بررسی</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9}><Empty icon="🛠️" text="هیچ خدمتی ثبت نشده است" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* فرم ثبت/ویرایش خدمت */}
      {form && (
        <Modal wide title={form.id ? `ویرایش خدمت ${form.no}` : 'ثبت خدمت جدید'} onClose={() => setForm(null)}
          foot={<>
            <button className="btn btn-primary" onClick={save}>ذخیره پیش‌نویس</button>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button>
          </>}>
          <div className="form-row">
            <div className="field"><label>عضو ارائه‌دهنده *</label>
              <select className="input" value={form.member_id || ''} onChange={(e) => setForm(f => ({ ...f, member_id: Number(e.target.value) || '' }))}>
                <option value="">انتخاب عضو…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.code} — {m.full_name}</option>)}
              </select></div>
            <div className="field"><label>تاریخ ارائه خدمت *</label>
              <JDate value={form.sdate} onChange={(v) => setForm(f => ({ ...f, sdate: v || '' }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>نوع خدمت *</label>
              <select className="input" value={form.stype} onChange={(e) => setForm(f => ({ ...f, stype: e.target.value }))}>
                {Object.entries(stypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label>عنوان خدمت *</label>
              <input className="input" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="مثلاً: مشاوره حقوقی تنظیم قراردادها" /></div>
          </div>
          <div className="form-row-3">
            <div className="field"><label>تعداد *</label>
              <input className="input num" type="number" min="0" value={form.qty ?? ''} onChange={(e) => setForm(f => ({ ...f, qty: e.target.value }))} /></div>
            <div className="field"><label>واحد</label>
              <select className="input" value={form.unit} onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}>
                <option>ساعت</option><option>مورد</option><option>روز</option><option>ماه</option>
              </select></div>
            <div className="field"><label>نرخ هر {form.unit} *</label>
              <MoneyInput value={form.unit_price || null} onChange={(v) => setForm(f => ({ ...f, unit_price: v || 0 }))} unit={unit} /></div>
          </div>
          <div className="field"><label>توضیح خدمت</label>
            <textarea className="input" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="field"><label>نحوه محاسبه و ملاک توافق (مستند نرخ)</label>
            <input className="input" value={form.calc_note} onChange={(e) => setForm(f => ({ ...f, calc_note: e.target.value }))} placeholder="مثلاً: ۱۲ ساعت × نرخ مصوب هیئت‌مدیره مورخ …" /></div>
          <div className="alert info" style={{ marginBottom: 0 }}>
            <Icon name="sparkle" size={16} />
            <div>مبلغ قابل جبران: <b className="num">{fmtMoney(liveAmount, unit)}</b> — پس از تأیید مدیرعامل، جبران «از محل اعتبار حساب» (تهاتر با تعهد عضو) یا «پرداخت نقدی» انجام می‌شود.</div>
          </div>
        </Modal>
      )}

      {/* تأیید و جبران */}
      {approve && (
        <Modal title={`تأیید و جبران خدمت ${approve.no}`} onClose={() => setApprove(null)}
          foot={<>
            <button className="btn btn-primary" onClick={() => decide(true)}><Icon name="check" size={15} /> تأیید و جبران</button>
            <button className="btn btn-danger" onClick={() => decide(false)}>رد</button>
            <button className="btn btn-ghost" onClick={() => setApprove(null)}>انصراف</button>
          </>}>
          <div className="alert info">
            <Icon name="idcard" size={16} />
            <div><b>{approve.member_name}</b> — {approve.title} — مبلغ <b className="num">{fmtMoney(approve.amount, unit)}</b></div>
          </div>
          <div className="field"><label>روش جبران *</label>
            <select className="input" value={approve.comp_method} onChange={(e) => setApprove(a => ({ ...a, comp_method: e.target.value }))}>
              <option value="credit">{compMethodLabels.credit} — از تعهد عضو کسر می‌شود</option>
              <option value="cash">{compMethodLabels.cash} — واریز از حساب شرکت</option>
            </select></div>
          {approve.comp_method === 'cash' && (
            <div className="field"><label>پرداخت از حساب *</label>
              <select className="input" value={approve.bank_id || ''} onChange={(e) => setApprove(a => ({ ...a, bank_id: Number(e.target.value) }))}>
                {banks.filter(b => b.is_active !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
          )}
          <div className="form-row">
            <div className="field"><label>تاریخ جبران</label>
              <JDate value={approve.comp_date} onChange={(v) => setApprove(a => ({ ...a, comp_date: v || '' }))} /></div>
            <div className="field"><label>یادداشت</label>
              <input className="input" value={approve.note} onChange={(e) => setApprove(a => ({ ...a, note: e.target.value }))} /></div>
          </div>
          <div className="alert warn" style={{ marginBottom: 0 }}>
            <Icon name="alert" size={16} />
            <div>با تأیید، سند حسابداری قطعی صادر می‌شود؛ در روش اعتباری، مبلغ بلافاصله با تعهدات عضو تهاتر می‌گردد.</div>
          </div>
        </Modal>
      )}
    </div>
  )
}
