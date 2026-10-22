import { useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { dateTime, money, parseAmount, paymentError, statusLabel } from '../payments/shared'

export default function AfterpayManager() {
  const settings = useQuery(api.payments.settings, {})
  const requests = useQuery(api.payments.list, {})
  const createLink = useAction(api.afterpay.createLink)
  const checkConnection = useAction(api.afterpay.checkConnection)
  const checkPayment = useAction(api.afterpay.checkPayment)
  const cancelRequest = useMutation(api.payments.cancel)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [created, setCreated] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(null)
  const cents = parseAmount(amount)

  async function copyLink(link) {
    setError(''); setMessage('')
    try { await navigator.clipboard.writeText(link); setMessage('Payment link copied.') }
    catch { setError('Copy was unavailable. Select the payment link and copy it manually.') }
  }
  async function create(event) {
    event.preventDefault(); setError(''); setMessage('')
    if (!cents) { setError('Enter a valid amount with up to two decimal places.'); return }
    setBusy('create')
    try {
      const result = await createLink({ invoiceNumber, amountCents: cents, note, expiresInDays })
      setCreated({ ...result, invoiceNumber: invoiceNumber.trim(), amountCents: cents })
      setMessage(result.reused ? 'This invoice already has a link. Its existing link is shown below.' : 'Payment link created.')
      setInvoiceNumber(''); setAmount(''); setNote('')
    } catch (e) { setError(paymentError(e, 'The payment link could not be created. Please try again.')) }
    finally { setBusy('') }
  }
  async function run(key, action, success) {
    setBusy(key); setError(''); setMessage('')
    try { const result = await action(); setMessage(typeof success === 'function' ? success(result) : success) }
    catch (e) { setError(paymentError(e, 'The request could not be completed. Please try again.')) }
    finally { setBusy('') }
  }
  const visible = (requests || []).filter(r => (filter === 'all' || r.status === filter) && r.invoiceNumber.toLowerCase().includes(search.toLowerCase()))
  const outsideLimits = cents && settings?.limits && (cents < settings.limits.minimumCents || cents > settings.limits.maximumCents)
  return <section className="module afterpay-module">
    <div className="module-intro">
      <div><p className="eyebrow">Customer payments</p><h2>Invoice payment links</h2><p>Create a link for a specific invoice and track its Afterpay payment here.</p></div>
      <span className={`integration-badge ${settings?.enabled ? 'integration-badge-live' : 'integration-badge-waiting'}`}>{!settings ? 'Loading…' : settings.enabled ? settings.environment === 'sandbox' ? 'Test checkout' : 'Checkout enabled' : 'Checkout not enabled'}</span>
    </div>
    {settings && !settings.enabled && <div className="payment-setup-notice"><strong>Links can be created; customer payments are not enabled yet.</strong><p>Finish the Afterpay connection and checkout testing before sharing links with customers.</p>{settings.configured && <button className="ghost-btn" disabled={!!busy} onClick={() => run('connection', () => checkConnection({}), 'Afterpay connection verified. Checkout remains disabled until launch.')}>Check connection</button>}</div>}
    {settings?.environment === 'sandbox' && <div className="payment-setup-notice"><strong>Test environment — no real payments.</strong><p>Use test customer information only. Sandbox payments do not settle an invoice.</p></div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {message && <div className="success-box" role="status">{message}</div>}
    <div className="afterpay-layout">
      <form className="panel-form afterpay-request-form" onSubmit={create}>
        <div className="form-heading"><div><p className="eyebrow">New request</p><h3>Create a payment link</h3></div></div>
        <label>Invoice number<input disabled={busy === 'create'} required maxLength={64} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="CC-10482" autoComplete="off" /></label>
        <label>Invoice amount ($)<input disabled={busy === 'create'} required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label>Link expires in<select disabled={busy === 'create'} value={expiresInDays} onChange={e => setExpiresInDays(Number(e.target.value))}>{[1,3,7,14,30].map(d => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}</select></label>
        <label>Internal note (optional)<textarea disabled={busy === 'create'} value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Visible only in the admin portal" /></label>
        <div className="payment-total-line"><span>Customer total</span><strong>{money(cents || 0)}</strong></div>
        <small className="control-note">The link charges the invoice amount. No additional payment fee is added.</small>
        {outsideLimits && <p className="error-box">This amount is outside the last verified Afterpay range ({money(settings.limits.minimumCents)}–{money(settings.limits.maximumCents)}). Checkout will not be available for it.</p>}
        <button className="primary-btn" disabled={!!busy || !settings || !!outsideLimits} type="submit">{busy === 'create' ? 'Creating link…' : 'Create payment link'}</button>
      </form>
      <aside className="payment-preview-card">
        <p className="eyebrow">Share with your customer</p><h3>{created ? `Invoice ${created.invoiceNumber}` : 'One invoice. One payment link.'}</h3>
        {created ? <><p className="payment-link-total">{money(created.amountCents)}</p><label>Payment link<input className="payment-link-input" readOnly value={created.link} onFocus={e => e.target.select()} /></label><div className="payment-row-actions"><button className="primary-btn" onClick={() => copyLink(created.link)}>Copy payment link</button><a className="ghost-btn" href={created.link} target="_blank" rel="noreferrer">Open link</a></div></> : <p className="muted">Enter the invoice number and amount. Copy the generated link into your own text or email to the customer.</p>}
        <ol className="payment-steps"><li>The customer opens their invoice link.</li><li>They review the amount and continue to Afterpay.</li><li>A verified payment updates the invoice status here.</li></ol>
        {settings?.limits && <p className="muted">Afterpay range: {money(settings.limits.minimumCents)}–{money(settings.limits.maximumCents)}.<br />Last checked {dateTime(settings.limits.checkedAt)}.</p>}
      </aside>
    </div>
    <div className="section-heading"><div><h2>Payment request history</h2><p>Latest 100 requests. Amounts are fixed; cancel an unpaid link to replace it.</p></div><div className="history-controls"><input aria-label="Search invoice number" placeholder="Find invoice…" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Filter payment requests" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option>{['pending','checkout_started','processing','review','paid','declined','cancelled','expired'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></div></div>
    <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Created / expires</th><th>Actions</th></tr></thead><tbody>
      {visible.map(r => <tr key={r.id}><td><strong>{r.invoiceNumber}</strong>{r.note && <span>{r.note}</span>}{r.orderId && <span>Afterpay order: {r.orderId}</span>}{r.environment === 'sandbox' && <span>TEST — not a real payment</span>}</td><td>{money(r.amountCents)}</td><td><span className={`status-pill payment-status-${r.status}`}>{statusLabel(r.status)}</span>{r.paidAt && <span>{dateTime(r.paidAt)}</span>}</td><td>{dateTime(r.createdAt)}<span>Expires {dateTime(r.expiresAt)}</span></td><td><div className="payment-row-actions"><button className="ghost-btn small" onClick={() => copyLink(r.link)}>Copy link</button><a className="ghost-btn small" href={r.link} target="_blank" rel="noreferrer">View</a>{['checkout_started','processing','review'].includes(r.status) && <button className="ghost-btn small" disabled={!!busy} onClick={() => run(r.id, () => checkPayment({ id: r.id }), result => `Payment status: ${statusLabel(result.status)}.`)}>Check payment</button>}{['pending','declined','checkout_started','creating_checkout','expired'].includes(r.status) && <button className="delete-btn small" disabled={!!busy} onClick={() => setConfirmCancel(r)}>Cancel link</button>}</div></td></tr>)}
      {!visible.length && <tr><td colSpan="5" className="empty-cell">{requests === undefined ? 'Loading payment requests…' : 'No matching payment requests.'}</td></tr>}
    </tbody></table></div>
    {confirmCancel && <div className="payment-dialog-backdrop"><section className="payment-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><h3 id="cancel-title">Cancel invoice {confirmCancel.invoiceNumber}?</h3><p>This disables the unpaid link. It does not refund a payment. You can create a replacement after cancellation.</p><div className="payment-row-actions"><button className="ghost-btn" disabled={!!busy} onClick={() => setConfirmCancel(null)}>Keep link</button><button className="delete-btn" disabled={!!busy} onClick={() => run('cancel', async () => { await cancelRequest({ id: confirmCancel.id }); setConfirmCancel(null) }, 'Payment link cancelled.')}>Cancel payment link</button></div></section></div>}
  </section>
}
