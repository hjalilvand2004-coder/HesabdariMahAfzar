import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Badge, Modal, Icon, MoneyInput, JDate, JDateText, Empty, Money, Progress, useToast, Confirm } from '../ui/components.jsx'
import { fmtMoney } from '../lib/format.js'
import { todayIso } from '../lib/jalali.js'

export default function Funding ({ user }) {
  const toast = useToast()
  const { settings } = useApp()
  const unit = settings?.currency_display || 'toman'
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [projects, setProjects] = useState([])
  const [edit, setEdit] = useState(null)
  const [preview, setPreview] = useState(null)
  const [detail, setDetail] = useState(null)
  const [confirmAct, setConfirmAct] = useState(null)
  const canManage = ['admin', 'finance', 'accountant'].includes(user.role)

  const load = () => call('GET', '/api/funding').then(setRows)
  useEffect(() => {
    load()
    call('GET', '/api/members').then(setMembers)
    call('GET', '/api/projects').then(setProjects)
  }, [])

  const openNew = () => setEdit({
    id: null, title: '', description: '', amount: null, method: 'share',
    member_ids: [], percents: {}, fixed_amounts: {}, base_date: settings?.base_share_date || todayIso(),
    due_date: '', ftype: 'current', doc_ref: '', project_id: null,
  })

  const runPreview = async (form) => {
    if (!form.amount || !form.member_ids.length) return setPreview(null)
    try {
      const res = await call('POST', '/api/funding/preview', {
        amount: form.amount, method: form.method, member_ids: form.member_ids,
        percents: form.percents, fixed_amounts: form.fixed_amounts, base_date: form.base_date,
      })
      setPreview(res)
    } catch (ex) { setPreview(null) }
  }
  useEffect(() => { if (edit) runPreview(edit) }, [edit?.amount, edit?.method, edit?.member_ids, edit?.base_date, edit?.percents, edit?.fixed_amounts])

  const save = async () => {
    if (!edit.title?.trim()) return toast.error('عنوان الزامی است')
    if (!edit.amount) return toast.error('مبلغ موردنیاز الزامی است')
    if (!edit.member_ids.length) return toast.error('اعضای مشمول را انتخاب کنید')
    try {
      if (edit.id) {
        await call('PATCH', `/api/funding/${edit.id}`, edit)
        toast('درخواست ویرایش شد')
      } else {
        await call('POST', '/api/funding', edit)
        toast('درخواست ثبت شد؛ برای تصویب به مدیرعامل ارسال کنید')
      }
      setEdit(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const decide = async (f, decision) => {
    try {
      await call('POST', `/api/funding/${f.id}/approve`, { decision, note: '' })
      toast(decision === 'approve' ? `مصوبه ${f.no} تصویب و تعهد اعضا دقیقاً محاسبه شد` : 'درخواست رد شد')
      setConfirmAct(null); load()
      if (detail) setDetail(await call('GET', `/api/funding/${detail.id}`))
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      {user.role !== 'member' && (
        <div className="alert info"><Icon name="funding" size={17} />
          <div><b>منطق تأمین مالی</b>
            هر درخواست مستقل است: مبنای تقسیم (سهم، مساوی، درصد توافقی یا مبلغ ثابت) در همان مصوبه تعیین می‌شود و مجموع تعهدات دقیقاً برابر مبلغ مصوب کنترل می‌گردد. پرداخت اعضا پس از تأیید وصول، خودکار با تعهد تهاتر می‌شود.
          </div>
        </div>
      )}
      <div className="card mb">
        <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <b>درخواست‌های تأمین مالی</b>
          {canManage && <button className="btn btn-primary" onClick={openNew}><Icon name="plus" size={17} /> درخواست جدید</button>}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>شماره</th><th>عنوان</th><th>مبلغ مصوب</th><th>روش تقسیم</th><th>نوع</th>
                <th>سررسید</th><th>پیشرفت وصول</th><th>وضعیت</th><th style={{ width: 150 }}></th></tr>
            </thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.id}>
                  <td className="num">{f.no}</td>
                  <td><b>{f.title}</b>{f.project_name && <div className="small muted">{f.project_name}</div>}</td>
                  <td><Money rial={f.amount} unit={unit} bold /></td>
                  <td><Badge k="b-info" text={({ share: 'متناسب با سهم', equal: 'مساوی', custom: 'توافقی', fixed: 'مبلغ ثابت' })[f.split_method]} /></td>
                  <td><Badge k={f.ftype} /></td>
                  <td>{f.due_date ? <JDateText iso={f.due_date} /> : '—'}</td>
                  <td style={{ minWidth: 150 }}>
                    <Progress pct={f.progress} green={f.progress >= 100} />
                    <span className="small num muted">{fmtMoney(f.collected, unit)} ({f.progress.toLocaleString('fa-IR')}٪)</span>
                  </td>
                  <td><Badge k={f.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={async () => setDetail(await call('GET', `/api/funding/${f.id}`))}>
                        <Icon name="eye" size={14} /> جزئیات
                      </button>
                      {canManage && f.status === 'draft' && (
                        <>
                          <button className="btn btn-soft btn-sm" onClick={async () => { await call('POST', `/api/funding/${f.id}/submit`); toast('برای تصویب ارسال شد'); load() }}>ارسال</button>
                          <button className="btn btn-ghost btn-sm" onClick={async () => {
                            const fd = await call('GET', `/api/funding/${f.id}`)
                            setEdit({ ...fd, method: fd.split_method, member_ids: fd.member_ids, base_date: fd.base_date, amount: fd.amount, id: fd.id })
                          }}><Icon name="edit" size={14} /></button>
                        </>
                      )}
                      {user.role === 'ceo' && f.status === 'pending' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => setConfirmAct({ f, d: 'approve' })}>تصویب</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmAct({ f, d: 'reject' })}>رد</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty icon="💳" text="درخواستی ثبت نشده است" />}
        </div>
      </div>

      {/* فرم */}
      {edit && (
        <Modal wide title={edit.id ? `ویرایش درخواست ${edit.no}` : 'درخواست تأمین مالی جدید'} onClose={() => { setEdit(null); setPreview(null) }}
          foot={<>
            <button className="btn btn-primary" onClick={save}><Icon name="check" size={16} /> ذخیره</button>
            <button className="btn btn-ghost" onClick={() => { setEdit(null); setPreview(null) }}>انصراف</button>
          </>}>
          <div className="form-row">
            <div className="field"><label>عنوان *</label>
              <input className="input" value={edit.title} onChange={(e) => setEdit(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="field"><label>مبلغ موردنیاز ({unit === 'toman' ? 'تومان' : 'ریال'}) *</label>
              <MoneyInput unit={unit} value={edit.amount} onChange={(v) => setEdit(f => ({ ...f, amount: v }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>روش تقسیم *</label>
              <select className="input" value={edit.method} onChange={(e) => setEdit(f => ({ ...f, method: e.target.value }))}>
                <option value="share">متناسب با درصد سهام (در تاریخ مبنای تأمین مالی)</option>
                <option value="equal">مساوی بین اعضای منتخب</option>
                <option value="custom">درصدهای توافقی</option>
                <option value="fixed">مبلغ ثابت برای هر عضو</option>
              </select></div>
            <div className="field"><label>ماهیت پرداخت اعضا</label>
              <select className="input" value={edit.ftype} onChange={(e) => setEdit(f => ({ ...f, ftype: e.target.value }))}>
                <option value="current">جاری شرکا</option>
                <option value="loan">وام اعضا به شرکت</option>
                <option value="capital">افزایش سرمایه</option>
              </select></div>
          </div>
          <div className="field"><label>اعضای مشمول *</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {members.filter(m => m.is_active).map(m => {
                const checked = edit.member_ids.includes(m.id)
                return (
                  <label key={m.id} className="check-line">
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      let ids = e.target.checked ? [...edit.member_ids, m.id] : edit.member_ids.filter(x => x !== m.id)
                      const percents = { ...edit.percents }
                      const fixed = { ...edit.fixed_amounts }
                      if (!e.target.checked) { delete percents[m.id]; delete fixed[m.id] }
                      else if (edit.method === 'custom') percents[m.id] = percents[m.id] ?? Math.round((m.share_now_bp || 0))
                      setEdit(f => ({ ...f, member_ids: ids, percents, fixed_amounts: fixed }))
                    }} />
                    <b>{m.full_name}</b>
                    <span className="small muted num">{(m.share_now_bp / 100).toLocaleString('fa-IR')}٪</span>
                  </label>
                )
              })}
            </div>
          </div>
          {edit.method === 'custom' && (
            <div className="form-row-3">
              {edit.member_ids.map(mid => (
                <div className="field" key={mid}>
                  <label>درصد {members.find(m => m.id === mid)?.full_name} (٪)</label>
                  <input className="input num" type="number" step="0.01" min="0" max="100"
                    value={edit.percents[mid] != null ? edit.percents[mid] / 100 : ''}
                    onChange={(e) => setEdit(f => ({ ...f, percents: { ...f.percents, [mid]: Math.round(Number(e.target.value || 0) * 100) } }))} />
                </div>
              ))}
            </div>
          )}
          {edit.method === 'fixed' && (
            <div className="form-row-3">
              {edit.member_ids.map(mid => (
                <div className="field" key={mid}>
                  <label>مبلغ ثابت {members.find(m => m.id === mid)?.full_name}</label>
                  <MoneyInput unit={unit} value={edit.fixed_amounts[mid]} onChange={(v) => setEdit(f => ({ ...f, fixed_amounts: { ...f.fixed_amounts, [mid]: v || 0 } }))} />
                </div>
              ))}
            </div>
          )}
          <div className="form-row-3">
            <div className="field"><label>تاریخ مبنای درصد سهام</label>
              <JDate value={edit.base_date} onChange={(v) => setEdit(f => ({ ...f, base_date: v || '' }))} /></div>
            <div className="field"><label>سررسید پرداخت</label>
              <JDate value={edit.due_date} onChange={(v) => setEdit(f => ({ ...f, due_date: v || '' }))} /></div>
            <div className="field"><label>پروژه / مبنای مصوبه</label>
              <select className="input" value={edit.project_id || ''} onChange={(e) => setEdit(f => ({ ...f, project_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          </div>
          <div className="field"><label>مستند مصوبه (صورتجلسه / قرارداد)</label>
            <input className="input" value={edit.doc_ref} onChange={(e) => setEdit(f => ({ ...f, doc_ref: e.target.value }))} /></div>
          <div className="field"><label>شرح</label>
            <textarea className="input" rows={2} value={edit.description} onChange={(e) => setEdit(f => ({ ...f, description: e.target.value }))} /></div>

          {preview && (
            <div className="card pad" style={{ background: 'var(--bg-soft)' }}>
              <b style={{ fontSize: 13.5 }}>پیش‌نمایش تقسیم (کنترل گرد کردن: مجموع دقیقاً برابر مبلغ مصوب)</b>
              <table className="tbl" style={{ marginTop: 8 }}>
                <thead><tr><th>عضو</th><th>درصد مبنا</th><th>تعهد پرداخت</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.member_id}>
                      <td><b>{r.member_name}</b></td>
                      <td className="num">{(r.share_bp / 100).toLocaleString('fa-IR')}٪</td>
                      <td><Money rial={r.amount} unit={unit} bold /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>جمع</td><td><Money rial={preview.total} unit={unit} /></td></tr></tfoot>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* جزئیات */}
      {detail && (
        <Modal wide title={`درخواست ${detail.no} — ${detail.title}`} onClose={() => setDetail(null)}>
          <div className="grid-2" style={{ gap: 12, marginBottom: 14 }}>
            <div><b>مبلغ مصوب: </b><Money rial={detail.amount} unit={unit} bold /></div>
            <div><b>وصول‌شده: </b><span className="num">{fmtMoney(detail.collected, unit)}</span> <Badge k={detail.status} /></div>
            {detail.doc_ref && <div className="small muted" style={{ gridColumn: 'span 2' }}>مستند: {detail.doc_ref}</div>}
            {detail.due_date && <div className="small muted">سررسید: <JDateText iso={detail.due_date} /></div>}
          </div>
          <Progress pct={detail.progress} green={detail.progress >= 100} />
          <table className="tbl" style={{ marginTop: 14 }}>
            <thead><tr><th>عضو</th><th>درصد مبنا</th><th>تعهد</th><th>وصول/تهاتر</th><th>مانده</th><th>وضعیت</th></tr></thead>
            <tbody>
              {detail.commitments.map(c => (
                <tr key={c.id}>
                  <td><b>{c.member_name}</b></td>
                  <td className="num">{(c.share_bp / 100).toLocaleString('fa-IR')}٪</td>
                  <td><Money rial={c.amount} unit={unit} /></td>
                  <td><Money rial={c.paid} unit={unit} /></td>
                  <td><Money rial={c.remaining} unit={unit} /></td>
                  <td><Badge k={c.settled ? 'paid' : (c.paid > 0 ? 'partial' : 'unpaid')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {confirmAct && (
        <Confirm title={confirmAct.d === 'approve' ? 'تصویب مصوبه' : 'رد درخواست'}
          message={confirmAct.d === 'approve'
            ? `مبلغ ${fmtMoney(confirmAct.f.amount, unit)} بین اعضای منتخب با روش «${({ share: 'متناسب با سهم', equal: 'مساوی', custom: 'توافقی', fixed: 'مبلغ ثابت' })[confirmAct.f.split_method]}» تقسیم و تعهد هر عضو ثبت می‌شود. ادامه؟`
            : 'این درخواست رد شود؟'}
          danger={confirmAct.d === 'reject'}
          onYes={() => decide(confirmAct.f, confirmAct.d)} onNo={() => setConfirmAct(null)} />
      )}
    </div>
  )
}
