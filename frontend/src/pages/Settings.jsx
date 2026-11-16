import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call, IS_PORTABLE, exportDB, importDB } from '../api/index.js'
import { Icon, JDate, useToast, Confirm } from '../ui/components.jsx'

export default function Settings ({ user, refreshSettings }) {
  const toast = useToast()
  const { settings } = useApp()
  const [form, setForm] = useState(null)
  const [pin, setPin] = useState('')
  const [hasPin, setHasPin] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const canEdit = ['admin', 'finance'].includes(user.role)

  useEffect(() => { setForm({ ...settings }) }, [settings])
  useEffect(() => { call('GET', '/api/auth/me').then(me => setHasPin(me.has_pin)) }, [])

  const save = async () => {
    try {
      await call('PATCH', '/api/settings', form)
      toast('تنظیمات ذخیره شد')
      refreshSettings()
    } catch (ex) { toast.error(ex.message) }
  }

  const togglePeriod = async () => {
    try {
      const res = await call('POST', '/api/settings/period', {
        closed: !settings.period_closed, reason: 'عملیات دستی از تنظیمات',
      })
      toast(res.period_closed ? 'دوره مالی بسته شد؛ ثبت با مجوز ویژه ممکن است' : 'دوره مالی بازگشایی شد')
      refreshSettings()
    } catch (ex) { toast.error(ex.message) }
  }

  const setPinCode = async () => {
    try {
      const res = await call('POST', '/api/auth/pin', { pin: pin || null })
      setHasPin(res.has_pin); setPin('')
      toast(res.has_pin ? 'رمز دومرحله‌ای فعال شد' : 'رمز دومرحله‌ای غیرفعال شد')
    } catch (ex) { toast.error(ex.message) }
  }

  const downloadBackup = () => {
    const data = exportDB()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `maliyar-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    toast('فایل پشتیبان دانلود شد')
  }

  const restore = async (file) => {
    setConfirm(null)
    try {
      const text = await file.text()
      importDB(text)
      toast('داده‌ها از نسخه پشتیبان بازیابی شد — صفحه بارگذاری مجدد می‌شود')
      setTimeout(() => window.location.reload(), 800)
    } catch (ex) { toast.error('فایل معتبر نیست: ' + ex.message) }
  }

  if (!form) return <div className="page"><div className="card pad center muted">…</div></div>

  return (
    <div className="page">
      <div className="grid-2">
        <div className="card mb">
          <div className="card-head"><h3>مشخصات شرکت و سال مالی</h3></div>
          <div className="pad">
            <div className="field"><label>نام شرکت</label>
              <input className="input" value={form.company_name} disabled={!canEdit}
                onChange={(e) => setForm(f => ({ ...f, company_name: e.target.value }))} /></div>
            <div className="form-row">
              <div className="field"><label>شناسه ملی</label>
                <input className="input num" value={form.company_national_id} disabled={!canEdit}
                  onChange={(e) => setForm(f => ({ ...f, company_national_id: e.target.value }))} /></div>
              <div className="field"><label>برچسب سال مالی</label>
                <input className="input num" value={form.fiscal_label} disabled
                  onChange={(e) => setForm(f => ({ ...f, fiscal_label: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>آغاز سال مالی</label><JDate value={form.fiscal_start} onChange={(v) => setForm(f => ({ ...f, fiscal_start: v || '' }))} /></div>
              <div className="field"><label>پایان سال مالی</label><JDate value={form.fiscal_end} onChange={(v) => setForm(f => ({ ...f, fiscal_end: v || '' }))} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>واحد نمایش پول</label>
                <select className="input" value={form.currency_display} disabled={!canEdit}
                  onChange={(e) => setForm(f => ({ ...f, currency_display: e.target.value }))}>
                  <option value="toman">تومان (ذخیره‌سازی پایه: ریال)</option>
                  <option value="rial">ریال</option>
                </select>
                <div className="small muted" style={{ marginTop: 4 }}>مبالغ همیشه به ریال و عدد صحیح ذخیره می‌شوند تا خطای گرد کردن رخ ندهد.</div>
              </div>
              <div className="field"><label>تاریخ مبنای پیش‌فرض سهم</label>
                <JDate value={form.base_share_date} onChange={(v) => setForm(f => ({ ...f, base_share_date: v || '' }))} /></div>
            </div>
            {canEdit && <button className="btn btn-primary" onClick={save}><Icon name="check" size={16} /> ذخیره تنظیمات</button>}
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="card-head"><h3>سیاست‌ها</h3></div>
            <div className="pad">
              <label className="check-line mb" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={!!form.auto_offset} disabled={!canEdit}
                  onChange={(e) => setForm(f => ({ ...f, auto_offset: e.target.checked }))} />
                تهاتر خودکار: پرداخت عضو و هزینه پرداخت‌شده توسط عضو، با تعهد مصوب او تهاتر شود (FIFO)
              </label>
              <label className="check-line" style={{ marginBottom: 16 }}>
                <input type="checkbox" checked={!!form.member_sees_all_expenses} disabled={!canEdit}
                  onChange={(e) => setForm(f => ({ ...f, member_sees_all_expenses: e.target.checked }))} />
                اعضا بتوانند هزینه‌های کل شرکت را ببینند (پیش‌فرض: فقط هزینه‌های خودشان)
              </label>
              {canEdit && <button className="btn btn-primary" onClick={save}><Icon name="check" size={16} /> ذخیره سیاست‌ها</button>}
            </div>
          </div>

          <div className="card mb">
            <div className="card-head"><h3>دوره مالی</h3></div>
            <div className="pad">
              <div className={`alert ${settings.period_closed ? 'danger' : 'info'}`}>
                {settings.period_closed ? 'دوره مالی بسته است؛ فقط مدیر سامانه مجاز به ثبت است.' : 'دوره مالی باز است و ثبت عادی انجام می‌شود.'}
              </div>
              {['admin', 'finance'].includes(user.role) && (
                <button className={`btn ${settings.period_closed ? 'btn-success' : 'btn-danger'}`} onClick={() => setConfirm('period')}>
                  <Icon name="lock" size={16} /> {settings.period_closed ? 'بازگشایی دوره' : 'بستن دوره مالی'}
                </button>
              )}
            </div>
          </div>

          <div className="card mb">
            <div className="card-head"><h3>امنیت حساب من</h3></div>
            <div className="pad">
              <div className="small muted" style={{ marginBottom: 10 }}>
                رمز دومرحله‌ای: {hasPin ? '✅ فعال — برای ورود به PIN نیاز است' : 'غیرفعال'}
              </div>
              <div className="form-row">
                <div className="field">
                  <input className="input num" inputMode="numeric" placeholder={hasPin ? 'PIN فعلی را وارد کنید تا غیرفعال شود' : 'PIN جدید (۴ رقم یا بیشتر)'}
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ''))} />
                </div>
                <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button className="btn btn-soft" onClick={setPinCode}>{hasPin ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card mb">
            <div className="card-head"><h3>پشتیبان‌گیری و بازیابی</h3></div>
            <div className="pad">
              <div className="small muted" style={{ marginBottom: 10 }}>
                {IS_PORTABLE
                  ? 'در نسخه پرتیبل داده‌ها در حافظه مرورگر (localStorage) همین مرورگر نگهداری می‌شود؛ هر چند هفته یک‌بار فایل پشتیبان بگیرید و در جای امن نگه دارید.'
                  : 'پایگاه‌داده SQLite در پوشه backend نگهداری می‌شود (فایل samane.db)؛ از آن کپی امنیتی تهیه کنید. خروجی JSON هم در ادامه موجود است.'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['admin', 'finance'].includes(user.role) && (
                  <button className="btn btn-primary" onClick={downloadBackup}><Icon name="download" size={16} /> دریافت نسخه پشتیبان (JSON)</button>
                )}
                {IS_PORTABLE && (
                  <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                    <Icon name="upload" size={16} /> بازیابی از فایل
                    <input type="file" accept=".json" style={{ display: 'none' }}
                      onChange={(e) => e.target.files[0] && setConfirm({ type: 'restore', file: e.target.files[0] })} />
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirm === 'period' && (
        <Confirm title={settings.period_closed ? 'بازگشایی دوره' : 'بستن دوره مالی'}
          message={settings.period_closed
            ? 'دوره باز شود و ثبت عادی برای همه نقش‌های مجاز از سر گرفته شود؟'
            : 'پس از بستن دوره، هیچ ثبت یا تغییری (به‌جز توسط مدیر سامانه) امکان‌پذیر نخواهد بود. ادامه؟'}
          danger={!settings.period_closed}
          onYes={() => { setConfirm(null); togglePeriod() }} onNo={() => setConfirm(null)} />
      )}
      {confirm?.type === 'restore' && (
        <Confirm title='بازیابی نسخه پشتیبان' danger
          message="همه داده‌های فعلی با محتوای فایل پشتیبان جایگزین می‌شود. مطمئنید؟"
          onYes={() => restore(confirm.file)} onNo={() => setConfirm(null)} />
      )}
    </div>
  )
}
