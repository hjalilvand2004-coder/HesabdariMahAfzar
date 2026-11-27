import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { Icon } from './components.jsx'
import { HelpButton } from './Help.jsx'
import { GuideButton } from './Guide.jsx'
import AssistantPanel from './Assistant.jsx'
import { formatJalali, todayIso } from '../lib/jalali.js'
import { roleLabels, permOf } from '../lib/format.js'

// قید نقش سخت (فراتر از ماتریس قابل ویرایش) — تفکیک وظایف حفظ می‌شود
const NAV = [
  { group: 'میزکار', items: [
    { path: '/dashboard', icon: 'dashboard', label: 'داشبورد مدیریتی', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/analytics', icon: 'analytics', label: 'تحلیل‌های هوشمند', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/my-account', icon: 'wallet', label: 'وضعیت حساب من', roles: ['member'] },
    { path: '/wallet', icon: 'wallet', label: 'کیف پول من', roles: ['member'] },
  ] },
  { group: 'عملیات مالی', items: [
    { path: '/expenses', icon: 'expenses', label: 'هزینه‌ها و خریدها' },
    { path: '/funding', icon: 'funding', label: 'تأمین مالی اعضا' },
    { path: '/payments', icon: 'payments', label: 'پرداخت‌ها و وصول' },
    { path: '/wallet', icon: 'wallet', label: 'کیف پول اعضا', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/services', icon: 'services', label: 'خدمات اعضا و جبران خدمات' },
    { path: '/members', icon: 'members', label: 'اعضا و سهامداران', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/profiles', icon: 'idcard', label: 'پروفایل اشخاص', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
  ] },
  { group: 'حسابداری', items: [
    { path: '/accounts', icon: 'accounts', label: 'کدینگ حساب‌ها', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/vouchers', icon: 'vouchers', label: 'اسناد حسابداری', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/reports', icon: 'reports', label: 'دفاتر و گزارش‌ها', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/statements', icon: 'statements', label: 'صورت‌های مالی', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
  ] },
  { group: 'نظارت و پیکربندی', items: [
    { path: '/audit', icon: 'audit', label: 'ردپای حسابرسی', roles: ['admin', 'finance', 'auditor'] },
    { path: '/users', icon: 'users', label: 'مدیریت کاربران و سطح دسترسی', roles: ['admin'] },
    { path: '/settings', icon: 'settings', label: 'تنظیمات' },
  ] },
]

// تم روشن/شب — ذخیره در localStorage و اعمال روی data-theme
export function useTheme () {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('maliyar_theme') || 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('maliyar_theme', theme) } catch { /* noop */ }
  }, [theme])
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))]
}

export default function Layout ({ route, title, children }) {
  const { user, logout, settings, navigate } = useApp()
  const [open, setOpen] = useState(false)
  const [theme, toggleTheme] = useTheme()
  const go = (path) => { navigate(path); setOpen(false) }
  const unitLabel = settings?.currency_display === 'rial' ? 'ریال' : 'تومان'
  const helpTopic = route.replace(/^\//, '')

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            {settings?.company_logo
              ? <img src={settings.company_logo} alt="آرم شرکت" />
              : '◈'}
          </div>
          <div>
            <b>{settings?.company_name_en || 'مالیار'}</b>
            <span>{settings?.company_name || 'مدیریت مالی و حسابداری'}</span>
          </div>
        </div>
        {NAV.map(g => {
          const items = g.items.filter(i =>
            (!i.roles || i.roles.includes(user.role)) && permOf(settings, user.role, i.path.slice(1)))
          if (!items.length) return null
          return (
            <div key={g.group} style={{ position: 'relative' }}>
              <div className="nav-group-label">{g.group}</div>
              {items.map(i => (
                <div key={i.path} className={`nav-item ${route === i.path ? 'active' : ''}`} onClick={() => go(i.path)}>
                  <Icon name={i.icon} size={18} />
                  <span>{i.label}</span>
                </div>
              ))}
            </div>
          )
        })}
        <div className="sidebar-foot">
          {settings?.company_name || ''} — نسخه ۱.۷<br />
          واحد نمایش: {unitLabel}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen(o => !o)} aria-label="منو">☰</button>
          <h1>{title}</h1>
          <HelpButton topic={helpTopic} label="" />
          <div className="spacer" />
          <GuideButton />
          <button className="icon-btn" onClick={toggleTheme}
            title={theme === 'dark' ? 'حالت روشن' : 'حالت شب'} aria-label="تغییر تم">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <span className={`period-badge ${settings?.period_closed ? 'closed' : ''}`}>
            سال مالی {settings?.fiscal_label?.toLocaleString('fa-IR')}
            {settings?.period_closed ? ' (بسته)' : ''}
          </span>
          <span className="period-badge">{formatJalali(todayIso())}</span>
          <div className="user-chip">
            <div className="avatar">{(user.full_name || user.username).trim().charAt(0)}</div>
            <div className="who">
              <b>{user.full_name}</b>
              <span>{roleLabels[user.role] || user.role}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout} title="خروج">
              <Icon name="logout" size={16} /> خروج
            </button>
          </div>
        </header>
        {children}
        {/* دستیار هوشمند — شناور روی همه صفحه‌ها، راهنمای نقش‌محور */}
        <AssistantPanel />
      </div>
    </div>
  )
}
