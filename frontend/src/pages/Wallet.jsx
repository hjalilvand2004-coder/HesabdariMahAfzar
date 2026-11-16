import React, { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { call } from '../api/index.js'
import { Modal, Icon, Badge, JDate, JDateText, Empty, MoneyInput, Money, useToast } from '../ui/components.jsx'
import { PageHeader } from '../ui/Help.jsx'
import { fmtMoney, walletTypeLabels, walletStatusLabels, walletMethodLabels } from '../lib/format.js'

// پردازش بازگشت از درگاه بانک ملی — نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس
function useGatewayResult (onDone) {
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    const m = window.location.hash.match(/\?gw=(ok|cancel|fail)(?:&ref=([\w-]+))?(?:&amt=(\d+))?(?:&alloc=(\d+))?(?:&msg=([^&]*))?/)
    if (!m) return
    const [, kind, ref, amt, alloc, msg] = m
    const clean = () => { window.history.replaceState(null, '', '#/wallet') }
    if (kind === 'ok') {
      setBanner({
        kind: 'ok',
        title: `نتیجه سرویس پرداخت بانک ملی: موفق ✅ — شماره مرجع: ${ref || '—'}`,
        text: `مبلغ ${Number(amt || 0).toLocaleString('fa-IR')} ریال${Number(alloc) > 0 ? ` به‌طور مستقیم به تعهد مصوب شما تخصیص یافت (${Number(alloc).toLocaleString('fa-IR')} ریال)` : ' به کیف پول شما شارژ شد'}. سند حسابداری به‌صورت خودکار صادر شد.`,
      })
    } else {
      setBanner({
        kind: 'err',
        title: kind === 'cancel' ? 'پرداخت لغو شد' : 'نتیجه سرویس پرداخت بانک ملی: ناموفق ⛔',
        text: msg ? decodeURIComponent(msg) : 'تراکنش از طرف بانک تأیید نشد؛ مبلغی از حساب شما کسر نشده است. می‌توانید دوباره تلاش کنید.',
      })
    }
    clean()
    onDone?.()
  }, [])
  return banner
}

export default function Wallet ({ user, settings }) {
  const toast = useToast()
  const { settings: st } = useApp()
  const unit = settings?.currency_display || 'toman'
  const isMember = user.role === 'member'
  const [data, setData] = useState(null)
  const [banks, setBanks] = useState([])
  const [charge, setCharge] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => call('GET', '/api/wallet').then(setData)
  useEffect(() => { load(); call('GET', '/api/banks').then(setBanks).catch(() => {}) }, [])
  const banner = useGatewayResult(load)

  const openCharge = (commitment = null) => {
    setCharge({ amount: commitment ? commitment.remaining : '', wdate: '', method: 'gateway', bank_id: banks[0]?.id || '', commitment_id: commitment?.id || null, commitment })
  }

  const doCharge = async () => {
    if (!charge.amount || Number(charge.amount) <= 0) return toast.error('مبلغ شارژ را وارد کنید')
    if (!charge.wdate) return toast.error('تاریخ را انتخاب کنید')
    if (charge.method === 'manual' && !charge.bank_id) return toast.error('حساب واریز را انتخاب کنید')
    setBusy(true)
    try {
      const res = await call('POST', '/api/wallet/charge', {
        amount: Number(charge.amount), wdate: charge.wdate, method: charge.method,
        bank_id: charge.method === 'manual' ? charge.bank_id : null,
        commitment_id: charge.commitment_id,
        note: charge.commitment ? `پرداخت آنلاین تعهد ${charge.commitment.funding_no} از کارتابل` : undefined,
      })
      setCharge(null)
      if (charge.method === 'gateway') {
        toast('در حال اتصال به درگاه بانک ملی…')
        window.location.hash = res.gateway_url || `#/gateway?tx=${res.id}`
      } else {
        toast('اعلام شارژ ثبت شد؛ پس از تأیید مالی، موجودی کیف پول اعمال می‌شود')
        load()
      }
    } catch (ex) { toast.error(ex.message) }
    setBusy(false)
  }

  const doSettle = async () => {
    setBusy(true)
    try {
      const res = await call('POST', '/api/wallet/settle', {})
      toast(`تسویه انجام شد — ${res.allocated.toLocaleString('fa-IR')} ریال از کیف پول به تعهدات تخصیص یافت`)
      load()
    } catch (ex) { toast.error(ex.message) }
    setBusy(false)
  }

  const approveCharge = async (tx, decision) => {
    try {
      await call('POST', `/api/wallet/charges/${tx.id}/approve`, decision === 'ok' ? { bank_id: tx.bank_id || banks[0]?.id } : { decision: 'reject', note: 'رد توسط مدیر مالی' })
      toast(decision === 'ok' ? 'شارژ تأیید و سند حسابداری صادر شد؛ موجودی عضو اعمال گردید' : 'اعلام شارژ رد شد')
      load()
    } catch (ex) { toast.error(ex.message) }
  }

  if (!data) return <div className="page"><div className="card pad center muted">در حال دریافت کیف پول…</div></div>

  const charges = data.txs.filter(t => t.type === 'charge' && t.status === 'approved').reduce((s, t) => s + t.amount, 0)
  const used = data.txs.filter(t => ['settle', 'spend'].includes(t.type)).reduce((s, t) => s + t.amount, 0)
  const pendingCharges = data.txs.filter(t => t.type === 'charge' && t.status === 'pending')

  return (
    <div className="page">
      <PageHeader icon="wallet" topic="wallet" title="کیف پول اعضا"
        subtitle={isMember
          ? 'شارژ پیش‌پرداخت شما نزد شرکت — از موجودی کیف پول می‌توانید تعهدات خود را یک‌جا تسویه کنید یا از کارتابل، آنلاین از درگاه بانک ملی پرداخت کنید'
          : 'مانده پیش‌پرداخت هر عضو نزد شرکت، اعلام شارژها و تراکنش‌های درگاه بانک ملی'} />

      {banner && (
        <div className={`alert ${banner.kind === 'ok' ? '' : 'danger'} mb`} style={banner.kind === 'ok' ? { background: 'var(--success-soft)', color: 'var(--success-ink)', borderColor: 'rgba(5, 150, 105, .25)' } : {}}>
          <Icon name={banner.kind === 'ok' ? 'check' : 'alert'} size={18} />
          <div><b>{banner.title}</b>{banner.text}</div>
        </div>
      )}

      {isMember ? (
        <>
          <div className="stat-grid stat-grid-3 mb">
            <div className="stat s2">
              <span className="stat-icon"><Icon name="wallet" size={34} /></span>
              <div className="stat-label">موجودی کیف پول من</div>
              <div className="stat-value num">{fmtMoney(data.balance, unit)}</div>
              <div className="stat-foot">پیش‌پرداخت من نزد شرکت — قابل استفاده برای تسویه تعهدات</div>
            </div>
            <div className="stat s6">
              <span className="stat-icon"><Icon name="download" size={34} /></span>
              <div className="stat-label">مجموع شارژهای تأییدشده</div>
              <div className="stat-value num">{fmtMoney(charges, unit)}</div>
              <div className="stat-foot">از درگاه بانک ملی و واریز دستی</div>
            </div>
            <div className="stat s4">
              <span className="stat-icon"><Icon name="payments" size={34} /></span>
              <div className="stat-label">استفاده‌شده برای تسویه</div>
              <div className="stat-value num">{fmtMoney(used, unit)}</div>
              <div className="stat-foot">تهاتر با تعهدات مصوب</div>
            </div>
          </div>

          <div className="card mb">
            <div className="card-head">
              <h3>کارتابل پرداخت من</h3>
              <div className="spacer" />
              <button className="btn btn-soft btn-sm" onClick={() => openCharge(null)} disabled={busy}>
                <Icon name="plus" size={14} /> شارژ کیف پول
              </button>
              {data.balance > 0 && data.commitments.length > 0 && (
                <button className="btn btn-primary btn-sm" onClick={doSettle} disabled={busy}>
                  <Icon name="check" size={14} /> تسویه تعهدات از کیف پول ({fmtMoney(data.balance, unit)})
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>مصوبه</th><th>عنوان</th><th>مانده تعهد من</th><th>سررسید</th><th></th></tr></thead>
                <tbody>
                  {data.commitments.map(c => (
                    <tr key={c.id}>
                      <td className="num">{c.funding_no}</td>
                      <td className="small">{c.funding_title}</td>
                      <td><Money rial={c.remaining} unit={unit} bold /></td>
                      <td>{c.due_date ? <JDateText iso={c.due_date} /> : '—'}</td>
                      <td>
                        <button className="btn btn-primary btn-sm" onClick={() => openCharge(c)} disabled={busy}>
                          <Icon name="bank" size={14} /> پرداخت آنلاین (درگاه بانک ملی)
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!data.commitments.length && <tr><td colSpan={5}><Empty icon="✅" text="تعهد باز ندارید — همه تعهدات شما تسویه شده است" /></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="stat-grid stat-grid-3 mb">
            <div className="stat s2">
              <span className="stat-icon"><Icon name="wallet" size={34} /></span>
              <div className="stat-label">مجموع موجودی کیف پول اعضا</div>
              <div className="stat-value num">{fmtMoney((data.members || []).reduce((s, m) => s + m.balance, 0), unit)}</div>
              <div className="stat-foot">بدهی شرکت به اعضا بابت شارژ کیف پول (حساب ۲۱۰۲)</div>
            </div>
            <div className="stat s3">
              <span className="stat-icon"><Icon name="clock" size={34} /></span>
              <div className="stat-label">اعلام شارژ در انتظار تأیید</div>
              <div className="stat-value num">{fmtMoney((data.members || []).reduce((s, m) => s + m.pending, 0), unit)}</div>
              <div className="stat-foot">{pendingCharges.length.toLocaleString('fa-IR')} تراکنش</div>
            </div>
            <div className="stat s6">
              <span className="stat-icon"><Icon name="bank" size={34} /></span>
              <div className="stat-label">پرداخت‌های درگاه بانک ملی</div>
              <div className="stat-value num">{data.txs.filter(t => t.method === 'gateway' && t.status === 'approved').length.toLocaleString('fa-IR')}</div>
              <div className="stat-foot">نتیجه مستقیم سرویس بانک — بدون نیاز به تأیید دستی</div>
            </div>
          </div>

          <div className="card mb">
            <div className="card-head"><h3>مانده کیف پول هر عضو</h3></div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>عضو</th><th>کد</th><th>موجودی کیف پول</th><th>شارژ در انتظار تأیید</th></tr></thead>
                <tbody>
                  {(data.members || []).map(m => (
                    <tr key={m.member_id}>
                      <td><b>{m.full_name}</b></td>
                      <td className="num">{m.code}</td>
                      <td><Money rial={m.balance} unit={unit} bold /></td>
                      <td>{m.pending ? <span className="badge b-pending">{fmtMoney(m.pending, unit)}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head"><h3>تراکنش‌های کیف پول</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>{isMember ? 'نوع' : 'عضو / نوع'}</th><th>روش</th><th>مرجع بانکی</th><th>مبلغ</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {data.txs.map(t => (
                <tr key={t.id}>
                  <td className="num">{t.no}</td>
                  <td><JDateText iso={t.wdate} /></td>
                  <td>{!isMember && <b style={{ marginLeft: 6 }}>{t.member_name}</b>}<span className="small muted">{walletTypeLabels[t.type]}</span></td>
                  <td className="small">{walletMethodLabels[t.method] || '—'}{t.gateway_ref && <div className="small muted num">{t.gateway_ref}</div>}{t.tracking_no && !t.gateway_ref && <div className="small muted num">{t.tracking_no}</div>}</td>
                  <td className="num small">{t.gateway_ref || t.tracking_no || '—'}</td>
                  <td><Money rial={t.amount} unit={unit} /></td>
                  <td><Badge k={t.status === 'approved' ? 'approved' : t.status === 'pending' ? 'pending' : 'rejected'} text={walletStatusLabels[t.status]} /></td>
                  <td>
                    {!isMember && t.type === 'charge' && t.status === 'pending' && t.method === 'manual' && (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn btn-soft btn-sm" onClick={() => approveCharge(t, 'ok')}><Icon name="check" size={13} /> تأیید</button>
                        <button className="btn btn-danger btn-sm" onClick={() => approveCharge(t, 'no')}>رد</button>
                      </div>
                    )}
                    {!isMember && t.type === 'charge' && t.status === 'pending' && t.method === 'gateway' && <span className="small muted">در انتظار نتیجه بانک</span>}
                  </td>
                </tr>
              ))}
              {!data.txs.length && <tr><td colSpan={8}><Empty icon="🪙" text="هنوز تراکنش کیف پولی ثبت نشده است" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {charge && (
        <Modal title={charge.commitment ? `پرداخت آنلاین تعهد ${charge.commitment.funding_no}` : 'شارژ کیف پول'} onClose={() => setCharge(null)}
          foot={<>
            <button className="btn btn-primary" disabled={busy} onClick={doCharge}>
              {charge.method === 'gateway' ? 'اتصال به درگاه بانک ملی' : 'ثبت اعلام شارژ'}
            </button>
            <button className="btn btn-ghost" onClick={() => setCharge(null)}>انصراف</button>
          </>}>
          {charge.commitment && (
            <div className="alert info">
              <Icon name="bank" size={16} />
              <div>پرداخت مانده تعهد مصوب <b>{charge.commitment.funding_no}</b> — پس از پرداخت موفق در بانک، نتیجه مستقیم سرویس اعمال و تعهد تسویه می‌شود.</div>
            </div>
          )}
          <div className="field"><label>مبلغ (تومان) *</label>
            <MoneyInput value={charge.amount || null} onChange={(v) => setCharge(c => ({ ...c, amount: v || 0 }))} unit={unit} /></div>
          <div className="form-row">
            <div className="field"><label>تاریخ *</label>
              <JDate value={charge.wdate} onChange={(v) => setCharge(c => ({ ...c, wdate: v || '' }))} /></div>
            <div className="field"><label>روش شارژ *</label>
              <select className="input" value={charge.method} onChange={(e) => setCharge(c => ({ ...c, method: e.target.value }))}>
                <option value="gateway">درگاه پرداخت بانک ملی — نتیجه فوری و خودکار</option>
                <option value="manual">اعلام واریز دستی — در انتظار تأیید مالی</option>
              </select></div>
          </div>
          {charge.method === 'manual' && (
            <div className="field"><label>واریز به حساب *</label>
              <select className="input" value={charge.bank_id || ''} onChange={(e) => setCharge(c => ({ ...c, bank_id: Number(e.target.value) }))}>
                {banks.filter(b => b.is_active !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
          )}
          <div className="alert info" style={{ marginBottom: 0 }}>
            <Icon name="sparkle" size={16} />
            <div>در روش درگاه بانک ملی، پس از پرداخت موفق در صفحه بانک، «نتیجه پرداخت مستقیم به‌عنوان نتیجه سرویس» ثبت می‌شود؛ سند حسابداری و تخصیص به تعهد (در صورت انتخاب) خودکار انجام می‌شود.</div>
          </div>
        </Modal>
      )}
    </div>
  )
}
