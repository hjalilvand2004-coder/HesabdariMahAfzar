import React, { useEffect, useRef, useState } from 'react'
import { useApp, navigate } from '../App.jsx'
import { Icon } from './components.jsx'

// دستیار هوشمند مالیار — پنل گفتگو شناور با راهنمایی و اقدام متناسب با نقش و سطح دسترسی
// پاسخ‌ها از /api/assistant (خلاصه وضعیت) و /api/assistant/ask (پرسش‌وپاسخ) می‌آید
export default function AssistantPanel () {
  const { user, call } = useApp()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const boxRef = useRef(null)
  const bootedRef = useRef(false)

  const boot = async () => {
    setLoading(true)
    setError('')
    try {
      const ov = await call('GET', '/api/assistant')
      setOverview(ov)
      setMessages([{ kind: 'bot', text: ov.greeting, overview: ov }])
      bootedRef.current = true
    } catch (e) {
      setError(e?.message || 'خطا در دریافت وضعیت دستیار')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !bootedRef.current && !loading) boot()
    // پرسش متفاوت هر کاربر — با تغییر کاربر، جلسه دستیار از نو ساخته می‌شود
    bootedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id])

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [messages, open])

  const send = async (text) => {
    const q = String(text || '').trim()
    if (!q || asking) return
    setInput('')
    setMessages(m => [...m, { kind: 'user', text: q }])
    setAsking(true)
    try {
      const res = await call('POST', '/api/assistant/ask', { question: q })
      setMessages(m => [...m, { kind: 'bot', text: res.answer, links: res.links || [] }])
    } catch (e) {
      setMessages(m => [...m, { kind: 'bot', text: e?.message || 'پاسخ دستیار دریافت نشد؛ دوباره تلاش کنید.' }])
    } finally {
      setAsking(false)
    }
  }

  const go = (path) => {
    setOpen(false)
    navigate(path)
  }

  const sevClass = { success: 'ok', warning: 'warn', danger: 'bad', info: 'info' }

  return (
    <>
      <button
        className={`assistant-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="دستیار هوشمند مالیار" aria-label="دستیار هوشمند مالیار">
        <Icon name={open ? 'x' : 'sparkle'} size={22} />
        {!open && <span className="assistant-dot" />}
      </button>
      {open && (
        <div className="assistant-panel" role="dialog" aria-label="پنل دستیار هوشمند">
          <div className="assistant-head">
            <div className="assistant-title">
              <Icon name="sparkle" size={18} />
              <div>
                <b>دستیار هوشمند مالیار</b>
                <span>{overview ? `راهنمای نقش «${overview.role_label}»` : 'در حال آماده‌سازی…'}</span>
              </div>
            </div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="بستن">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="assistant-body" ref={boxRef}>
            {loading && <div className="assistant-loading">در حال تحلیل وضعیت حسابی شما…</div>}
            {error && !loading && (
              <div className="assistant-error">
                {error}
                <button className="btn btn-sm" onClick={boot}><Icon name="refresh" size={14} /> تلاش دوباره</button>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.kind === 'user' ? 'me' : 'bot'}`}>
                {m.kind === 'bot' && m.overview && (
                  <>
                    {m.overview.role_guide && <div className="assistant-guide">{m.overview.role_guide}</div>}
                    <div className="assistant-stats">
                      {m.overview.stats.map((s, j) => (
                        <div key={j} className="assistant-stat"><span>{s.label}</span><b>{s.value}</b></div>
                      ))}
                    </div>
                    {m.overview.insights.map(ins => (
                      <div key={ins.id} className={`assistant-card ${sevClass[ins.severity] || 'info'}`}>
                        <div className="assistant-card-head">
                          <Icon name={ins.icon || 'info'} size={15} />
                          <b>{ins.title}</b>
                        </div>
                        <p>{ins.text}</p>
                        {!!ins.actions?.length && (
                          <div className="assistant-actions">
                            {ins.actions.map((a, k) => (
                              <button key={k} className="btn btn-sm" onClick={() => go(a.path)}>
                                {a.label} <Icon name="arrowL" size={12} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="assistant-disclaimer">{m.overview.disclaimer}</div>
                  </>
                )}
                {m.kind === 'bot' && !m.overview && (
                  <>
                    <p className="assistant-text">{m.text}</p>
                    {!!m.links?.length && (
                      <div className="assistant-actions">
                        {m.links.map((a, k) => (
                          <button key={k} className="btn btn-sm" onClick={() => go(a.path)}>
                            {a.label} <Icon name="arrowL" size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {m.kind === 'user' && <p className="assistant-text">{m.text}</p>}
              </div>
            ))}
            {asking && <div className="assistant-loading">دستیار در حال بررسی داده‌های حساب…</div>}
          </div>

          {overview?.chips?.length ? (
            <div className="assistant-chips">
              {overview.chips.map((c, i) => (
                <button key={i} className="assistant-chip" onClick={() => send(c)}>{c}</button>
              ))}
            </div>
          ) : null}

          <form
            className="assistant-input"
            onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="پرسش خود را بنویسید…"
              aria-label="متن پرسش از دستیار" />
            <button className="btn btn-primary" type="submit" disabled={asking || !input.trim()}>
              <Icon name="send" size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
