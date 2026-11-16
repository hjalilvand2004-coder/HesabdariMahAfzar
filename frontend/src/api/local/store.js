// فروشگاه داده درون‌مرورگری — نقش پایگاه‌داده SQLite در نسخه پرتیبل
// همه مبالغ به ریال و عدد صحیح (همان قاعده بک‌اند)
import { todayIso, isoToJalali } from '../../lib/jalali.js'

const KEY = 'maliyar_db_v1'
const SESSION_KEY = 'maliyar_session'

export function loadDB () {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* خرابی داده → از نو */ }
  return null
}

export function saveDB (db) {
  localStorage.setItem(KEY, JSON.stringify(db))
}

export function emptyDB () {
  return {
    meta: { version: 1, createdAt: todayIso() },
    seq: {},
    counters: {},
    settings: null,
    users: [],
    members: [],
    shares: [],
    projects: [],
    banks: [],
    tafsils: [],
    accounts: [],
    expenses: [],
    attachments: [],
    funding: [],
    commitments: [],
    payments: [],
    allocations: [],
    credits: [],
    vouchers: [],
    audit: [],
  }
}

export function nextId (db, table) {
  db.seq[table] = (db.seq[table] || 0) + 1
  return db.seq[table]
}

export function nextNumber (db, entity, dateIso, prefixes) {
  const jy = isoToJalali(dateIso)[0]
  const key = `${entity}:${jy}`
  db.counters[key] = (db.counters[key] || 0) + 1
  return `${prefixes[entity] || entity.toUpperCase()}-${jy}-${String(db.counters[key]).padStart(4, '0')}`
}

export function log (db, user, action, entity, entityId, details) {
  db.audit.unshift({
    id: nextId(db, 'audit'),
    ts: new Date().toISOString(),
    username: typeof user === 'string' ? user : (user?.username || 'system'),
    action, entity, entity_id: entityId,
    details: JSON.stringify(details || {}),
  })
  if (db.audit.length > 1000) db.audit.length = 1000
}

export class HttpError extends Error {
  constructor (status, message) { super(message); this.status = status }
}

export function getSession () {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}
export function setSession (s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}
