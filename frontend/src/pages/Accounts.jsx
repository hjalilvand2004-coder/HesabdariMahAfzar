import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Modal, Icon, Badge, Empty, useToast } from '../ui/components.jsx'

const TYPE_LABELS = { asset: 'دارایی', liability: 'بدهی', equity: 'حقوق مالکانه', income: 'درآمد', expense: 'هزینه' }
const TYPE_COLORS = { asset: '#0891b2', liability: '#ef4444', equity: '#7c3aed', income: '#10b981', expense: '#f59e0b' }

export default function Accounts ({ user }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const canManage = ['admin', 'finance'].includes(user.role)

  const load = () => call('GET', '/api/accounts').then(setRows)
  useEffect(() => { load() }, [])

  const groups = rows.filter(a => a.level === 'group')
  const cols = (g) => rows.filter(a => a.level === 'col' && a.parent_code === g.code)
  const moins = (c) => rows.filter(a => a.level === 'moin' && a.parent_code === c.code)
  const postable = (a) => rows.filter(x => x.parent_code === a.code).length === 0

  const save = async () => {
    try {
      if (form.id) {
        await call('PATCH', `/api/accounts/${form.id}`, form)
        toast('حساب ویرایش شد')
      } else {
        await call('POST', '/api/accounts', form)
        toast('حساب جدید ایجاد شد')
      }
      setForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const del = async (a) => {
    try {
      await call('DELETE', `/api/accounts/${a.id}`)
      toast('حساب حذف شد')
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="card mb">
        <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <b>کدینگ حساب‌ها — گروه ← کل ← معین</b>
            <div className="small muted">حساب دارای گردش قابل حذف یا تغییر کد نیست؛ ساختار مطابق الگوی رایج حسابداری ایران</div>
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setForm({ code: '', name: '', level: 'col', parent_code: groups[0]?.code, acc_type: 'expense', nature: 'debit', is_active: true })}>
                <Icon name="plus" size={15} /> حساب کل
              </button>
              <button className="btn btn-soft btn-sm" onClick={() => setForm({ code: '', name: '', level: 'moin', parent_code: rows.find(a => a.level === 'col' && postable === undefined)?.code || '5101', acc_type: 'expense', nature: 'debit', is_active: true })}>
                <Icon name="plus" size={15} /> حساب معین
              </button>
            </div>
          )}
        </div>
      </div>

      {groups.map(g => (
        <div className="card mb" key={g.code}>
          <div className="card-head" style={{ borderRight: `4px solid ${TYPE_COLORS[g.acc_type]}` }}>
            <b className="num">{g.code}</b>
            <h3>{g.name}</h3>
            <Badge k="b-info" text={TYPE_LABELS[g.acc_type]} />
          </div>
          <div className="pad" style={{ paddingTop: 8 }}>
            {cols(g).map(c => (
              <div key={c.code} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px dashed var(--line)' }}>
                  <b className="num" style={{ minWidth: 52 }}>{c.code}</b>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {!postable(c) && <Badge k="b-muted" text="سرفصل" />}
                  {canManage && postable(c) && (
                    <span style={{ marginRight: 'auto', display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...c, id: c.id })}><Icon name="edit" size={13} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => del(c)}><Icon name="trash" size={13} /></button>
                    </span>
                  )}
                </div>
                {moins(c).map(m => (
                  <div key={m.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 26px' }}>
                    <b className="num" style={{ minWidth: 52, color: 'var(--ink-2)' }}>{m.code}</b>
                    <span className="muted">{m.name}</span>
                    {!m.is_active && <Badge k="b-danger" text="غیرفعال" />}
                    {canManage && (
                      <span style={{ marginRight: 'auto', display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...m, id: m.id })}><Icon name="edit" size={13} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => del(m)}><Icon name="trash" size={13} /></button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {form && (
        <Modal title={form.id ? 'ویرایش حساب' : (form.level === 'moin' ? 'حساب معین جدید' : 'حساب کل جدید')} onClose={() => setForm(null)}
          foot={<><button className="btn btn-primary" onClick={save}>ذخیره</button><button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-row">
            <div className="field"><label>کد حساب {form.level === 'moin' ? '(۵ رقم، زیر کد کل)' : '(۴ رقم)'} *</label>
              <input className="input num" value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder={form.level === 'moin' ? '51013' : '5110'} /></div>
            <div className="field"><label>نام حساب *</label>
              <input className="input" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            {form.level === 'moin' && (
              <div className="field"><label>زیر حساب کل</label>
                <select className="input" value={form.parent_code || ''} onChange={(e) => {
                  const p = rows.find(a => a.code === e.target.value)
                  setForm(f => ({ ...f, parent_code: e.target.value, acc_type: p?.acc_type || f.acc_type, nature: p?.nature || f.nature }))
                }}>
                  {rows.filter(a => a.level === 'col').map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select></div>
            )}
            {form.level === 'col' && (
              <div className="field"><label>گروه</label>
                <select className="input" value={form.parent_code || ''} onChange={(e) => {
                  const g = groups.find(x => x.code === e.target.value)
                  setForm(f => ({ ...f, parent_code: e.target.value, acc_type: g?.acc_type || f.acc_type, nature: g?.acc_type === 'asset' || g?.acc_type === 'expense' ? 'debit' : 'credit' }))
                }}>
                  {groups.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select></div>
            )}
            <div className="field"><label>ماهیت</label>
              <select className="input" value={form.nature} onChange={(e) => setForm(f => ({ ...f, nature: e.target.value }))}>
                <option value="debit">بدهکار</option><option value="credit">بستانکار</option>
              </select></div>
            <div className="field"><label>فعال</label>
              <select className="input" value={form.is_active ? '1' : '0'} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.value === '1' }))}>
                <option value="1">فعال</option><option value="0">غیرفعال</option>
              </select></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
