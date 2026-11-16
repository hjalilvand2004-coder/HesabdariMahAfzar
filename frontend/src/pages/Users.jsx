import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Modal, Icon, Badge, Empty, useToast } from '../ui/components.jsx'
import { PageHeader } from '../ui/Help.jsx'
import { roleLabels, MODULES, DEFAULT_ROLE_PERMS, permOf } from '../lib/format.js'

const ROLES = Object.entries(roleLabels)
const ROLE_HINTS = {
  admin: 'پیکربندی کامل سامانه و مدیریت کاربران؛ تأیید مالی ندارد (تفکیک وظایف).',
  finance: 'ثبت هزینه و مصوبه، تأیید وصول پرداخت‌ها، اسناد و تسویه.',
  accountant: 'ثبت‌ها، اسناد و دفاتر؛ بدون قدرت تأیید نهایی.',
  ceo: 'تصویب هزینه‌ها، مصوبه‌های تأمین مالی و جبران خدمات.',
  member: 'پرتال شخصی عضو: وضعیت حساب، کیف پول و پرداخت آنلاین از درگاه بانک ملی.',
  auditor: 'مشاهده‌محض دفاتر، گزارش‌ها و ردپای حسابرسی.',
}

const GROUPS = [...new Set(MODULES.map(m => m.group))]

export default function Users () {
  const toast = useToast()
  const { user, settings, refreshSettings } = useApp()
  const [rows, setRows] = useState([])
  const [members, setMembers] = useState([])
  const [audit, setAudit] = useState([])
  const [form, setForm] = useState(null)
  const [matrix, setMatrix] = useState(null)   // {role: Set(moduleKey)} — با Set برای راحتی
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = () => call('GET', '/api/users').then(setRows)
  useEffect(() => {
    load()
    call('GET', '/api/members').then(setMembers)
    call('GET', '/api/audit').then(setAudit).catch(() => {})
  }, [])

  // مقدار اولیه ماتریس از تنظیمات (یا پیش‌فرض)
  useEffect(() => {
    if (!matrix && settings) {
      const m = {}
      for (const [role] of ROLES) {
        m[role] = new Set(settings.role_perms?.[role] || DEFAULT_ROLE_PERMS[role] || [])
      }
      setMatrix(m)
    }
  }, [settings])

  const lastLogins = useMemo(() => {
    const map = {}
    for (const a of audit) {
      if (a.action !== 'login') continue
      if (!map[a.username]) map[a.username] = a.ts
    }
    return map
  }, [audit])

  const toggle = (role, modKey) => {
    setMatrix(m => {
      const nm = { ...m, [role]: new Set(m[role]) }
      nm[role].has(modKey) ? nm[role].delete(modKey) : nm[role].add(modKey)
      return nm
    })
    setDirty(true)
  }

  const saveMatrix = async () => {
    setSaving(true)
    try {
      const role_perms = Object.fromEntries(ROLES.map(([role]) => [role, [...matrix[role]]]))
      await call('PATCH', '/api/settings', { role_perms })
      await refreshSettings()
      toast('ماتریس سطح دسترسی ذخیره شد؛ منوی کاربران آن نقش بلافاصله به‌روز می‌شود')
      setDirty(false)
    } catch (ex) { toast.error(ex.message) }
    setSaving(false)
  }

  const resetMatrix = async () => {
    const role_perms = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMS))
    try {
      await call('PATCH', '/api/settings', { role_perms })
      await refreshSettings()
      const m = {}
      for (const [role] of ROLES) m[role] = new Set(role_perms[role] || [])
      setMatrix(m)
      setDirty(false)
      toast('به پیش‌فرض استاندارد بازگشت')
    } catch (ex) { toast.error(ex.message) }
  }

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

  const activeCount = rows.filter(r => r.is_active).length

  return (
    <div className="page">
      <PageHeader icon="users" topic="users" title="مدیریت کاربران و سطح دسترسی"
        subtitle="درگاه استفاده از سامانه: ساخت کاربر، تعیین نقش و کنترل دقیق دسترسی هر نقش به هر بخش" />

      <div className="stat-grid stat-grid-3 mb">
        <div className="stat s1">
          <span className="stat-icon"><Icon name="users" size={30} /></span>
          <div className="stat-label">کاربران فعال</div>
          <div className="stat-value num">{activeCount.toLocaleString('fa-IR')}</div>
          <div className="stat-foot">از {rows.length.toLocaleString('fa-IR')} کاربر ثبت‌شده</div>
        </div>
        <div className="stat s2">
          <span className="stat-icon"><Icon name="lock" size={30} /></span>
          <div className="stat-label">نقش‌های تعریف‌شده</div>
          <div className="stat-value num">۶</div>
          <div className="stat-foot">تفکیک وظایف: تأیید مالی ≠ پیکربندی</div>
        </div>
        <div className="stat s6">
          <span className="stat-icon"><Icon name="members" size={30} /></span>
          <div className="stat-label">کاربران اتصال‌نیافته به عضو</div>
          <div className="stat-value num">{rows.filter(r => r.role === 'member' && !r.member_id).length.toLocaleString('fa-IR')}</div>
          <div className="stat-foot">کاربر «عضو» باید به پرونده عضو متصل شود</div>
        </div>
      </div>

      {/* کاربران */}
      <div className="card mb">
        <div className="card-head">
          <h3>کاربران سامانه</h3>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => setForm({ username: '', password: '', full_name: '', role: 'accountant', member_id: null, is_active: true })}>
            <Icon name="plus" size={16} /> کاربر جدید
          </button>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>نام کاربری</th><th>نام</th><th>نقش</th><th>عضو مرتبط</th><th>PIN دومرحله‌ای</th><th>آخرین ورود</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td className="num"><b>{u.username}</b></td>
                  <td>{u.full_name}</td>
                  <td><Badge k="b-info" text={u.role_label} /></td>
                  <td>{u.member_id ? members.find(m => m.id === u.member_id)?.full_name || u.member_id : '—'}</td>
                  <td>{u.has_pin ? '✅ فعال' : '—'}</td>
                  <td className="num small muted">{lastLogins[u.username]?.slice(0, 10) || '—'}</td>
                  <td><Badge k={u.is_active ? 'approved' : 'rejected'} text={u.is_active ? 'فعال' : 'غیرفعال'} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...u, password: '', id: u.id })}><Icon name="edit" size={14} /> ویرایش</button>
                      {u.is_active && u.id !== user.id && <button className="btn btn-danger btn-sm" onClick={() => deactivate(u)}>غیرفعال</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><Empty text="کاربری ثبت نشده است" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ماتریس سطح دسترسی */}
      <div className="card">
        <div className="card-head">
          <h3>ماتریس سطح دسترسی — کدام نقش به کدام بخش دسترسی دارد؟</h3>
          <div className="spacer" />
          {dirty && <span className="badge b-pending">تغییرات ذخیره‌نشده</span>}
          <button className="btn btn-ghost btn-sm" onClick={resetMatrix}><Icon name="refresh" size={14} /> بازگشت به پیش‌فرض</button>
          <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={saveMatrix}>
            <Icon name="check" size={14} /> ذخیره دسترسی‌ها
          </button>
        </div>
        {matrix && (
          <div className="table-wrap">
            <table className="tbl matrix">
              <thead>
                <tr>
                  <th style={{ minWidth: 210 }}>بخش سامانه</th>
                  {ROLES.map(([role]) => <th key={role} className="matrix-col">{roleLabels[role]}</th>)}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(g => (
                  <React.Fragment key={g}>
                    <tr className="matrix-group-row"><td colSpan={1 + ROLES.length}>{g}</td></tr>
                    {MODULES.filter(m => m.group === g).map(mod => (
                      <tr key={mod.key}>
                        <td>{mod.label}</td>
                        {ROLES.map(([role]) => {
                          const checked = matrix[role]?.has(mod.key)
                          const isDefault = DEFAULT_ROLE_PERMS[role]?.includes(mod.key)
                          return (
                            <td key={role} className="matrix-cell">
                              <input type="checkbox" checked={!!checked}
                                onChange={() => toggle(role, mod.key)}
                                title={`${roleLabels[role]} — ${mod.label}`} />
                              {checked !== isDefault && <span className="matrix-dot" />}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pad small muted" style={{ borderTop: '1px solid var(--line)' }}>
          نقطه بنفش کنار هر تیک یعنی وضعیت فعلی با پیش‌فرض استاندارد تفاوت دارد. این ماتریس «دیده‌شدن بخش‌ها» را کنترل می‌کند؛
          عملیات حساس (تأیید هزینه، تأیید وصول، تصویب مصوبه) همچنان با نقش کاربر کنترل می‌شود تا تفکیک وظایف حفظ بماند.
        </div>
      </div>

      {form && (
        <Modal title={form.id ? `ویرایش کاربر ${form.username}` : 'کاربر جدید'} onClose={() => setForm(null)}
          foot={<><button className="btn btn-primary" onClick={save}>ذخیره</button><button className="btn btn-ghost" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-row">
            <div className="field"><label>نام کاربری *</label>
              <input className="input num" disabled={!!form.id} value={form.username} onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} /></div>
            <div className="field"><label>{form.id ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور * (حداقل ۶ نویسه)'}</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>نام و نام خانوادگی *</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div className="field"><label>نقش *</label>
              <select className="input" value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div className="small muted" style={{ marginTop: 6, lineHeight: 1.8 }}>{ROLE_HINTS[form.role]}</div>
            </div>
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
