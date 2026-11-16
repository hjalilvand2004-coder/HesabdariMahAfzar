import React, { useState } from 'react'
import { useApp } from '../App.jsx'
import { Icon } from './components.jsx'
import { HelpButton } from './Help.jsx'
import { GuideButton } from './Guide.jsx'
import { formatJalali, todayIso } from '../lib/jalali.js'
import { roleLabels, permOf } from '../lib/format.js'

// قید نقش سخت (فراتر از ماتریس قابل ویرایش) — تفکیک وظایف حفظ می‌شود
const NAV = [
  { group: 'میزکار', items: [
    { path: '/dashboard', icon: 'dashboard', label: 'داشبورد مدیریتی', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/analytics', icon: 'analytics', label: 'تحلیل‌های هوشمند', roles: ['admin', 'finance', 'accountant', 'ceo', 'auditor'] },
    { path: '/my-account', icon: 'wallet', label: 'وضعیت حساب من', roles: ['member'] },
  ] },
  { group: 'عملیات مالی', items: [
    { path: '/expenses', icon: 'expenses', label: 'هزینه‌ها و خریدها' },
    { path: '/funding', icon: 'funding', label: 'تأمین مالی اعضا' },
    { path: '/payments', icon: 'payments', label: 'پرداخت‌ها و وصول' },
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

export default function Layout ({ route, title, children }) {
  const { user, logout, settings, navigate } = useApp()
  const [open, setOpen] = useState(false)
  const go = (path) => { navigate(path); setOpen(false) }
  const unitLabel = settings?.currency_display === 'rial' ? 'ریال' : 'تومان'
  const helpTopic = route.replace(/^\//, '')

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">◈</div>
          <div>
            <b>مالیار</b>
            <span>مدیریت مالی و حسابداری</span>
          </div>
        </div>
        {NAV.map(g => {
          const items = g.items.filter(i =>
            (!i.roles || i.roles.includes(user.role)) && permOf(settings, user.role, i.path.slice(1)))
          if (!items.length) return null
          return (
            <div key={g.group}>
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
          {settings?.company_name || ''} — نسخه ۱.۱<br />
          واحد نمایش: {unitLabel}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen(o => !o)}>☰</button>
          <h1>{title}</h1>
          <HelpButton topic={helpTopic} label="" />
          <div className="spacer" />
          <GuideButton />
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
      </div>
    </div>
  )
}
