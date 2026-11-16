// لایه یکپارچه API — در حالت سرور با FastAPI و در حالت پرتیبل با موتور درون‌مرورگری
import { localCall, exportDB, importDB, resetDB } from './local/index.js'
import { getSession, setSession } from './local/store.js'

export const IS_PORTABLE = typeof __PORTABLE__ !== 'undefined' && __PORTABLE__
export { exportDB, importDB, resetDB }

export async function call (method, path, body = null, query = null) {
  if (IS_PORTABLE) {
    return localCall(method, path, body, query)
  }
  const token = localStorage.getItem('maliyar_token') || ''
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString() : ''
  const res = await fetch(path + qs, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = 'خطا در ارتباط با سرور'
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { /* بدون بدنه */ }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function uploadAttachment (expenseId, file) {
  if (IS_PORTABLE) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
    return call('POST', `/api/expenses/${expenseId}/attachments`, {
      name: file.name, size: file.size, mime: file.type, dataUrl,
    })
  }
  const token = localStorage.getItem('maliyar_token') || ''
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/expenses/${expenseId}/attachments`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  if (!res.ok) throw new Error('بارگذاری ناموفق بود')
  return res.json()
}

export async function downloadAttachment (att) {
  if (IS_PORTABLE) {
    const a = document.createElement('a')
    a.href = att.path
    a.download = att.name
    a.click()
    return
  }
  const token = localStorage.getItem('maliyar_token') || ''
  const res = await fetch(`/api/attachments/${att.id}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = att.name
  a.click()
  URL.revokeObjectURL(url)
}

export function saveToken (token) {
  localStorage.setItem('maliyar_token', token)
}
export function getToken () {
  return IS_PORTABLE ? (getSession() ? 'local-session' : '') : (localStorage.getItem('maliyar_token') || '')
}
export function clearToken () {
  localStorage.removeItem('maliyar_token')
  if (IS_PORTABLE) setSession(null)
}
