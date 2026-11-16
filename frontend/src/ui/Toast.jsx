import React, { createContext, useContext, useState, useCallback } from 'react'

const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider ({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, text, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }, [])
  const toast = useCallback((text) => push(text, 'ok'), [push])
  toast.error = useCallback((text) => push(text, 'err'), [push])
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-host">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.kind === 'err' ? '⛔' : '✅'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export default function ToastHost ({ children }) {
  return <ToastProvider>{children}</ToastProvider>
}
