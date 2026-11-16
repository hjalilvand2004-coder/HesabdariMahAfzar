import React, { useEffect, useState } from 'react'
import { call } from '../api/index.js'
import { JDateText, Empty, Icon } from '../ui/components.jsx'
import { actionLabels } from '../lib/format.js'

const ENTITY_LABELS = {
  expense: 'هزینه', funding: 'تأمین مالی', payment: 'پرداخت', voucher: 'سند',
  member: 'عضو', account: 'حساب', user: 'کاربر', settings: 'تنظیمات',
  commitment: 'تعهد', share: 'سهم', attachment: 'پیوست', project: 'پروژه',
  bank: 'بانک', system: 'سامانه',
}

export default function Audit ({ user }) {
  const [rows, setRows] = useState(null)
  const [filters, setFilters] = useState({ entity: '', username: '' })

  useEffect(() => { call('GET', '/api/audit', null, filters).then(setRows) }, [filters])

  return (
    <div className="page">
      <div className="alert info"><Icon name="audit" size={17} />
        <div><b>ردپای حسابرسی</b> — هر ایجاد، ویرایش، تأیید، ثبت سند و تخصیص با کاربر، زمان و جزئیات قبل/بعد ثبت می‌شود؛ اعضا و حسابرس‌های عادی به این صفحه دسترسی ندارند.</div>
      </div>

      <div className="card mb">
        <div className="pad">
          <div className="filters">
            <div className="field"><label>موجودیت</label>
              <select className="input" value={filters.entity} onChange={(e) => setFilters(f => ({ ...f, entity: e.target.value }))}>
                <option value="">همه</option>
                {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="field"><label>کاربر</label>
              <input className="input" value={filters.username} onChange={(e) => setFilters(f => ({ ...f, username: e.target.value }))} placeholder="نام کاربری…" /></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>زمان</th><th>کاربر</th><th>اقدام</th><th>موجودیت</th><th>جزئیات</th></tr></thead>
            <tbody>
              {rows?.map(a => (
                <tr key={a.id}>
                  <td className="num">{a.id.toLocaleString('fa-IR')}</td>
                  <td><JDateText iso={a.ts.slice(0, 10)} /> <span className="small muted num">{a.ts.slice(11, 16)}</span></td>
                  <td><b>{a.username}</b></td>
                  <td><span className="badge b-muted">{actionLabels[a.action] || a.action}</span></td>
                  <td>{ENTITY_LABELS[a.entity] || a.entity} {a.entity_id ? <span className="num small">#{a.entity_id}</span> : ''}</td>
                  <td className="small" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.details}>{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <Empty icon="🕵️" text="رکوردی یافت نشد" />}
        </div>
      </div>
    </div>
  )
}
