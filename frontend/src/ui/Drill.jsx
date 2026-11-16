import React, { useCallback, useEffect, useState } from 'react'
import { HBar, Icon, Empty } from './components.jsx'
import { faNum, fmtMoneyShort } from '../lib/format.js'

/*
  DrillBox — نمودار با دریل‌داون تا سه سطح:
  levels[i] = {
    kind: 'bars' | 'table',
    label: 'عنوان سطح',
    load: async (sel1, sel2) => ({ rows, total, cols? }),
    renderItem?: (cell) => JSX   // فقط برای سطح جدولی
  }
  مسیر انتخاب با breadcrumb قابل برگشت است.
*/

export function DrillBox ({ title, unit, levels, rootLabel = 'همه موارد', icon = 'analytics', hint }) {
  const [path, setPath] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const depth = path.length
  const level = levels[Math.min(depth, levels.length - 1)]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await level.load(...path)
      setData(d || { rows: [] })
    } catch (ex) {
      console.error('DrillBox load error:', ex)
      setData({ rows: [] })
    }
    setLoading(false)
  }, [level, path])

  useEffect(() => { load() }, [load])

  const enter = (item) => {
    if (depth < levels.length - 1) setPath(p => [...p, item])
  }
  const jumpTo = (d) => setPath(p => p.slice(0, d))

  // نرمال‌سازی خروجی سطح: آرایه خام یا {rows, total} — و کلید amount یا value
  const rawRows = Array.isArray(data) ? data : (data?.rows || [])
  const rawTotal = Array.isArray(data) ? rawRows.reduce((s, r) => s + (r.value ?? r.amount ?? 0), 0) : data?.total
  const normRows = rawRows.map(r => ({ ...r, value: r.value ?? r.amount ?? 0 }))

  return (
    <div className="drill">
      <div className="drill-crumbs">
        <span className="drill-level num">سطح {faNum(depth + 1)} از {faNum(levels.length)}</span>
        <button className={`drill-crumb ${depth === 0 ? 'active' : ''}`} onClick={() => jumpTo(0)}>{rootLabel}</button>
        {path.map((p, i) => (
          <React.Fragment key={i}>
            <Icon name="chevronL" size={12} />
            <button className={`drill-crumb ${i === depth - 1 ? 'active' : ''}`} onClick={() => jumpTo(i + 1)}>
              {p.labelShort || p.label || p.no}
            </button>
          </React.Fragment>
        ))}
        {depth > 0 && (
          <button className="drill-back" onClick={() => jumpTo(depth - 1)}>
            <Icon name="chevronR" size={12} /> برگشت
          </button>
        )}
      </div>

      {hint && depth === 0 && <div className="drill-hint small muted">{hint}</div>}

      {loading ? (
        <div className="empty">در حال دریافت…</div>
      ) : level.kind === 'table' ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                {(data.cols || []).map((c, i) => <th key={i}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rawRows.map((r, i) => (
                <tr key={i}>
                  <td className="num muted small">{faNum(i + 1)}</td>
                  {(data.cols || []).map((c, j) => (
                    <td key={j} className={c.num ? 'num' : ''}>{r[j]}</td>
                  ))}
                </tr>
              ))}
              {!rawRows.length && <tr><td colSpan={(data.cols || []).length + 1}><Empty text="موردی در این سطح نیست" /></td></tr>}
            </tbody>
            {rawTotal != null && rawRows.length > 0 && (
              <tfoot><tr>
                <td colSpan={(data.cols || []).length}>جمع کل</td>
                <td className="num">{unit ? fmtTotal(rawTotal, unit) : faNum(rawTotal)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      ) : (
        <HBar items={normRows} unit={unit} onItemClick={depth < levels.length - 1 ? enter : undefined}
          emptyText="داده‌ای برای نمایش نیست" />
      )}
    </div>
  )
}

function fmtTotal (v, unit) {
  // نمایش کوتاه جمع — برای جلوگیری از شلوغی
  return fmtMoneyShort(v, unit)
}
