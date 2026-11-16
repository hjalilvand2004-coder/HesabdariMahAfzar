import React, { useState } from 'react'
import { useToast } from '../ui/Toast.jsx'
import { useApp } from '../App.jsx'
import { Icon } from '../ui/components.jsx'
import { GuideButton } from '../ui/Guide.jsx'

const DEMO_USERS = [
  { u: 'admin', n: 'مدیر سامانه' }, { u: 'finance', n: 'مدیر مالی' },
  { u: 'acc', n: 'حسابداری' }, { u: 'ceo', n: 'مدیرعامل' },
  { u: 'ali', n: 'عضو (علی)' }, { u: 'audit', n: 'حسابرس' },
]

const FEATURES = [
  { icon: 'vouchers', t: 'حسابداری دوبل با اسناد خودکار', d: 'هر رویداد مالی بلافاصله سند متوازن می‌خورد؛ دفاتر همیشه با تعهدات سازگار است' },
  { icon: 'funding', t: 'تأمین مالی شفاف سهامداران', d: 'تقسیم دقیق بر پایه سهام با کنترل گرد کردن تا آخرین ریال' },
  { icon: 'wallet', t: 'کیف پول و پرداخت آنلاین', d: 'درگاه بانک ملی، تسویه یک‌جا تعهدات و ثبت فوری نتیجه پرداخت' },
  { icon: 'reports', t: 'گزارش و صورت‌های مالی لحظه‌ای', d: 'دفاتر، تراز آزمایشی، سود و زیان و ترازنامه در هر لحظه' },
]

export default function Login ({ onLogin }) {
  const toast = useToast()
  const { settings } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(0)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const res = await onLogin(username.trim(), password, pin || undefined)
      toast(`خوش آمدید ${res.user.full_name}!`)
    } catch (ex) {
      if (ex.message === 'PIN_REQUIRED' || ex.status === 401 && ex.message?.includes?.('PIN_REQUIRED')) {
        setNeedPin(true)
        setErr('برای این حساب، رمز دومرحله‌ای (PIN) لازم است')
      } else {
        setErr(ex.message || 'ورود ناموفق بود')
        setShake(s => s + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-blob b1" />
      <div className="login-blob b2" />
      <div className="login-blob b3" />

      {/* پنل معرفی سامانه */}
      <aside className="login-showcase">
        <div className="showcase-brand">
          <div className="showcase-logo">
            {settings?.company_logo
              ? <img src={settings.company_logo} alt="آرم شرکت" />
              : '◈'}
          </div>
          <div>
            <h1>سامانه مالیار</h1>
            <p>{settings?.company_name ? `حسابداری جامع ${settings.company_name}` : 'حسابداری جامع شرکت، به زبان آدمیزاد'}</p>
          </div>
        </div>
        <div className="showcase-title">
          هزینه‌ها، تعهدات و <em>تراز نهایی</em> همه اعضا — همیشه شفاف، همیشه متوازن
        </div>
        <p className="showcase-sub">
          مالیار چرخه کامل مالی شرکت سهامی کوچک را دیجیتال می‌کند: از مصوبه تأمین مالی و سهم هر سهامدار
          تا وصول پرداخت‌ها، تهاتر خودکار و دستور تسویه نهایی — با سند حسابداری خودکار برای هر رویداد.
        </p>
        <div className="showcase-feats">
          {FEATURES.map(f => (
            <div key={f.t} className="showcase-feat">
              <span className="showcase-feat-icon"><Icon name={f.icon} size={19} /></span>
              <div>
                <b>{f.t}</b>
                <span>{f.d}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="showcase-foot">
          <span className="v-chip">نسخه ۱.۴ — پروفایل شرکت، خدمات و کیف پول کامل</span>
          <span>حالت شب و روشن · ریسپانسیو · راست‌چین کامل</span>
        </div>
      </aside>

      {/* فرم ورود */}
      <div className="login-form-side">
        <form className="login-card" onSubmit={submit} key={shake}>
          <div className="login-brand">
            <div className="login-logo">
              {settings?.company_logo
                ? <img src={settings.company_logo} alt="آرم شرکت" />
                : '◈'}
            </div>
            <div>
              <div className="login-title">ورود به سامانه</div>
              <div className="login-sub">حساب خود را وارد کنید تا کار را شروع کنیم</div>
            </div>
          </div>

          <div className="field">
            <label>نام کاربری</label>
            <div className="input-icon-wrap">
              <span className="input-icon"><Icon name="members" size={17} /></span>
              <input className={`input ${err ? 'input-err' : ''}`} value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="مثلاً finance" autoFocus />
            </div>
          </div>
          <div className="field">
            <label>رمز عبور</label>
            <div className="input-icon-wrap">
              <span className="input-icon" style={{ cursor: 'pointer' }}
                onClick={() => setShowPw(s => !s)} title="نمایش/پنهان">
                <Icon name={showPw ? 'eye' : 'lock'} size={17} />
              </span>
              <input className={`input ${err ? 'input-err' : ''}`} type={showPw ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          {needPin && (
            <div className="field">
              <label>رمز دومرحله‌ای (PIN)</label>
              <input className="input num" inputMode="numeric" value={pin} maxLength={8}
                onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ''))} placeholder="● ● ● ●" />
            </div>
          )}

          <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
            {busy ? 'در حال بررسی…' : 'ورود به سامانه'}
          </button>
          <div className="form-err">{err}</div>

          <div className="login-guide-row">
            <Icon name="book" size={15} />
            <span>قبل از شروع، <b>راهنمای جامع</b> را ببینید: منطق تأمین مالی سهامداران، محاسبه سهم از هزینه‌ها، جبران خدمات و تسویه.</span>
            <GuideButton />
          </div>

          <div className="login-hint">
            <b>کاربران نمونه (رمز همه: <span className="num">123456</span>)</b><br />
            {DEMO_USERS.map(d => (
              <span key={d.u} className="chip" onClick={() => { setUsername(d.u); setPassword('123456'); setNeedPin(false); setErr('') }}>
                {d.n}
              </span>
            ))}
            <div style={{ marginTop: 8, fontSize: 12 }}>
              پس از ورود، می‌توانید از «تنظیمات ← پروفایل» رمز دومرحله‌ای فعال کنید.
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
