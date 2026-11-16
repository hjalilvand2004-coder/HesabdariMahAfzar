import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { call, IS_PORTABLE, clearToken, getToken } from './api/index.js'
import Login from './pages/Login.jsx'
import Layout from './ui/Layout.jsx'
import ToastHost from './ui/Toast.jsx'

import Dashboard from './pages/Dashboard.jsx'
import Expenses from './pages/Expenses.jsx'
import Funding from './pages/Funding.jsx'
import Payments from './pages/Payments.jsx'
import Members from './pages/Members.jsx'
import Accounts from './pages/Accounts.jsx'
import Vouchers from './pages/Vouchers.jsx'
import Reports from './pages/Reports.jsx'
import Statements from './pages/Statements.jsx'
import Analytics from './pages/Analytics.jsx'
import Audit from './pages/Audit.jsx'
import Users from './pages/Users.jsx'
import Settings from './pages/Settings.jsx'
import MyAccount from './pages/MyAccount.jsx'

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// مسیریابی هش-محور سبک بدون وابستگی
function useHashRoute () {
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/dashboard')
  useEffect(() => {
    const fn = () => setHash(window.location.hash.slice(1) || '/dashboard')
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  return hash
}

export const navigate = (path) => { window.location.hash = path }

const STAFF = ['admin', 'finance', 'accountant', 'ceo', 'auditor']
const ROUTES = {
  '/dashboard': { comp: Dashboard, roles: STAFF, title: 'داشبورد مدیریتی' },
  '/expenses': { comp: Expenses, roles: null, title: 'هزینه‌ها و خریدها' },
  '/funding': { comp: Funding, roles: null, title: 'تأمین مالی اعضا' },
  '/payments': { comp: Payments, roles: null, title: 'پرداخت‌ها و وصول' },
  '/members': { comp: Members, roles: STAFF, title: 'اعضا و سهامداران' },
  '/accounts': { comp: Accounts, roles: STAFF, title: 'کدینگ حساب‌ها' },
  '/vouchers': { comp: Vouchers, roles: STAFF, title: 'اسناد حسابداری' },
  '/reports': { comp: Reports, roles: STAFF, title: 'دفاتر و گزارش‌ها' },
  '/statements': { comp: Statements, roles: STAFF, title: 'صورت‌های مالی' },
  '/analytics': { comp: Analytics, roles: STAFF, title: 'تحلیل‌های هوشمند' },
  '/audit': { comp: Audit, roles: ['admin', 'finance', 'auditor'], title: 'ردپای حسابرسی' },
  '/users': { comp: Users, roles: ['admin'], title: 'کاربران و نقش‌ها' },
  '/settings': { comp: Settings, roles: null, title: 'تنظیمات' },
  '/my-account': { comp: MyAccount, roles: ['member'], title: 'وضعیت حساب من' },
}

export default function App () {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)
  const [settings, setSettings] = useState(null)
  const route = useHashRoute()

  // عضو همیشه به پرتال اختصاصی خودش هدایت می‌شود، نه داشبورد مدیریتی
  useEffect(() => {
    if (user?.role === 'member' && (!route || route === '/dashboard')) {
      navigate('/my-account')
    }
  }, [user, route])

  useEffect(() => {
    (async () => {
      try {
        if (getToken()) {
          const me = await call('GET', '/api/auth/me')
          setUser(me)
          setSettings(await call('GET', '/api/settings'))
        }
      } catch { clearToken() }
      setBooting(false)
    })()
  }, [])

  const login = useCallback(async (username, password, pin) => {
    const res = await call('POST', '/api/auth/login', { username, password, pin })
    if (!IS_PORTABLE) {
      const { saveToken } = await import('./api/index.js')
      saveToken(res.token)
    }
    setUser(res.user)
    setSettings(await call('GET', '/api/settings'))
    return res
  }, [])

  const logout = useCallback(async () => {
    if (IS_PORTABLE) { try { await call('POST', '/api/auth/logout') } catch { /* noop */ } }
    clearToken()
    setUser(null)
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettings(await call('GET', '/api/settings'))
  }, [])

  if (booting) {
    return <div className="boot-screen"><div className="boot-logo">◈</div><div>در حال بارگذاری…</div></div>
  }

  if (!user) {
    return (
      <ToastHost>
        <Login onLogin={login} />
      </ToastHost>
    )
  }

  const current = ROUTES[route] || ROUTES['/dashboard']
  const canAccess = !current.roles || current.roles.includes(user.role)
  const activeRoute = canAccess ? route : '/dashboard'

  return (
    <AppCtx.Provider value={{ user, logout, settings, refreshSettings, call, navigate }}>
      <ToastHost>
        <Layout route={activeRoute} title={ROUTES[activeRoute].title} routes={ROUTES}>
          {canAccess
            ? <current.comp key={route} user={user} settings={settings} refreshSettings={refreshSettings} />
            : <div className="page"><div className="card pad center muted">به این بخش دسترسی ندارید.</div></div>}
        </Layout>
      </ToastHost>
    </AppCtx.Provider>
  )
}
