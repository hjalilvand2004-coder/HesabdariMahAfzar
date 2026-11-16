import React, { useEffect, useState } from 'react'
import { call } from '../api/index.js'
import { Modal, Icon, Badge, Empty, useToast } from '../ui/components.jsx'
import { roleLabels } from '../lib/format.js'

const ROLES = Object.entries(roleLabels)

export default function Users () {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [form, setForm] = useState(null)

  const load = () => call('GET', '/api/users').then(setRows)
  useEffect(() => {
    load()
    call('GET', '/api/members').then(setMembers)
  }, [])

  const save = async () => {
    try {
      if (form.id) {
        await call('PATCH', `/api/users/${form.id}`, form)
        toast('کاربر ویرایش شد')
      } else {
        await call('POST', '/api/users', form)
        toast('کاربر ایجاد شد')
      }
      setForm(null); load()
    } catch (ex) { toast.error(ex.message) }
  }

  const deactivate = async (u) => {
    try {
      await call('DELETE', `/api/users/${u.id}`)
      toast('کاربر غیرفعال شد')
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  return (
    <div className="page">
      <div className="alert info"><Icon name="users" size={17} />
        <div><b>تفکیک وظایف</b> — دسترسی مدیر فنی سامانه به معنی اختیار تأیید اسناد مالی نیست؛ تأیید هزینه و مصوبه با «مدیرعامل»، تأیید وصول و اسناد با «مدیر مالی» انجام می‌شود.</div>
      </div>

      <div className="card mb">
        <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>کاربران سامانه</b>
          <button className="btn btn-primary" onClick={() => setForm({ username: '', password: '', full_name: '', role: 'accountant', member_id: null, is_active: true })}>
            <Icon name="plus" size={17} /> کاربر جدید
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>نام کاربری</th><th>نام</th><th>نقش</th><th>عضو مرتبط</th><th>PIN دومرحله‌ای</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td className="num"><b>{u.username}</b></td>
                  <td>{u.full_name}</td>
                  <td><Badge k="b-info" text={u.role_label} /></td>
                  <td>{u.member_id ? members.find(m => m.id === u.member_id)?.full_name || u.member_id : '—'}</td>
                  <td>{u.has_pin ? '✅ فعال' : '—'}</td>
                  <td><Badge k={u.is_active ? 'approved' : 'rejected'} text={u.is_active ? 'فعال' : 'غیرفعال'} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...u, password: '', id: u.id })}><Icon name="edit" size={14} /> ویرایش</button>
                      {u.is_active && <button className="btn btn-danger btn-sm" onClick={() => deactivate(u)}>غیرفعال</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal title={form.id ? `ویرایش کاربر ${form.username}` : 'کاربر جدید'} onClose={() => setForm(null)}
          foot={<><button className="btn btn-primary" onClick={save}>ذخیره</button><button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-row">
            <div className="field"><label>نام کاربری *</label>
              <input className="input num" disabled={!!form.id} value={form.username} onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} /></div>
            <div className="field"><label>{form.id ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور *'}</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>نام و نام خانوادگی *</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div className="field"><label>نقش *</label>
              <select className="input" value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          {form.role === 'member' && (
            <div className="field"><label>عضو مرتبط *</label>
              <select className="input" value={form.member_id || ''} onChange={(e) => setForm(f => ({ ...f, member_id: Number(e.target.value) }))}>
                <option value="">انتخاب…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.code} — {m.full_name}</option>)}
              </select></div>
          )}
          <label className="check-line"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))} /> کاربر فعال باشد</label>
        </Modal>
      )}
    </div>
  )
}
