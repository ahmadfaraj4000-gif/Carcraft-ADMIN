import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

import { estimateEmail } from '../../shared/estimateEmail'

const dollars = (cents) => cents === undefined ? '' : (cents / 100).toFixed(2)
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function parseAmount(value) {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error('Enter a dollar amount with up to two decimal places.')
  const cents = Math.round(Number(trimmed) * 100)
  if (!Number.isSafeInteger(cents)) throw new Error('This amount is too large. Please check the quote.')
  return cents
}

export default function LeadQuote({ lead }) {
  const saveQuote = useMutation(api.estimateLeads.saveQuote)
  const history = useQuery(api.estimateEmails.history, { id: lead._id })
  const retry = useMutation(api.estimateEmails.retry)
  const [sendKey, setSendKey] = useState('')
  const [details, setDetails] = useState('')
  const [queued, setQueued] = useState(false)
  const helpId = useId()
  const [amount, setAmount] = useState(dollars(lead.quote?.minAmountCents))
  const [upper, setUpper] = useState(dollars(lead.quote?.maxAmountCents))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setAmount(dollars(lead.quote?.minAmountCents))
    setUpper(dollars(lead.quote?.maxAmountCents))
  }, [lead._id, lead.quote?.minAmountCents, lead.quote?.maxAmountCents])

  function quoteAmounts() {
    const minAmountCents = parseAmount(amount)
    if (!upper.trim()) return { minAmountCents }
    const maxAmountCents = parseAmount(upper)
    if (maxAmountCents < minAmountCents) throw new Error('The upper amount must be at least the quoted amount.')
    return { minAmountCents, maxAmountCents }
  }

  let preview
  if (sendKey && details.trim()) {
    try {
      preview = estimateEmail({ kind: 'estimate', name: lead.name, vehicle: lead.vehicle, details: details.trim(), ...quoteAmounts() })
    } catch { /* Show the preview once both amounts are valid. */ }
  }

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    try {
      setSaving(true)
      const email = sendKey ? { details: details.trim(), key: sendKey, recipient: lead.email, name: lead.name, vehicle: lead.vehicle || '' } : undefined
      await saveQuote({ id: lead._id, ...quoteAmounts(), ...(email ? { email } : {}) })
      setSaved(!email)
      setQueued(Boolean(email))
      setSendKey('')
      setDetails('')
    } catch (err) {
      setError(err.message || 'Unable to save the quote. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="lead-quote" aria-label={`Customer quote for ${lead.name}`} onSubmit={submit}>
    <p className="lead-quote-summary"><strong>Customer quote: </strong>{lead.quote
      ? `${money.format(lead.quote.minAmountCents / 100)}${lead.quote.maxAmountCents === undefined ? '' : ` – ${money.format(lead.quote.maxAmountCents / 100)}`}`
      : 'Not recorded'}</p>
    <div className="lead-quote-fields">
      <label>Amount quoted ($)
        <input type="text" inputMode="decimal" required value={amount} placeholder="1500.00"
          aria-describedby={helpId} disabled={saving || Boolean(lead.deletedAt)}
          onChange={(event) => { setAmount(event.target.value); setSaved(false); setError('') }} />
      </label>
      <label>Upper amount ($, optional)
        <input type="text" inputMode="decimal" value={upper} placeholder="2000.00"
          aria-describedby={helpId} disabled={saving || Boolean(lead.deletedAt)}
          onChange={(event) => { setUpper(event.target.value); setSaved(false); setError('') }} />
      </label>
      {!sendKey && <button type="button" className="ghost-btn" disabled={saving || lead.archived || lead.deletedAt || lead.submissionState === 'pending_upload'} onClick={() => {
        setSendKey(crypto.randomUUID()); setError(''); setSaved(false); setQueued(false)
      }}>Send estimate</button>}
      {!sendKey && <button className="primary-btn small" type="submit" disabled={saving || Boolean(lead.deletedAt)}>{saving ? 'Saving…' : 'Save quote'}</button>}
    </div>
    <p className="muted lead-quote-help" id={helpId}>Enter the price quoted to the customer in USD. For a range, add an upper amount.</p>
    {lead.quote?.updatedAt ? <p className="muted lead-quote-help">Last saved {new Date(lead.quote.updatedAt).toLocaleString()}</p> : null}
    {sendKey && <section>
      <p><strong>To</strong> {lead.email}</p>
      <label>Estimate details<textarea rows={4} required maxLength={10000} value={details} onChange={e => setDetails(e.target.value)} /></label>
      {preview && <><p><strong>Subject</strong> {preview.subject}</p><iframe title="Customer email preview" sandbox="" style={{width:'100%', height:400, border:0}} srcDoc={preview.htmlContent} /></>}
      {!history?.enabled && <p role="status">Email sending is awaiting Brevo activation.</p>}
      <button type="submit" className="primary-btn" disabled={!preview || !history?.enabled || saving}>{saving ? 'Queueing…' : 'Send email'}</button>
      <button type="button" className="ghost-btn" disabled={saving} onClick={() => setSendKey('')}>Cancel</button>
    </section>}
    {queued && <p role="status">Estimate queued. See email history below.</p>}
    {history?.rows?.length > 0 && <section><h3>Email history</h3>{history.rows.map(row => <details key={row._id}>
      <summary>{new Date(row._creationTime).toLocaleString()} · {row.subject} · {({pending:'Queued', sending:'Sending', sent:'Accepted by Brevo', failed:'Failed', review:'Delivery uncertain'})[row.status]}</summary>
      <p>To {row.email}</p><p style={{whiteSpace:'pre-wrap'}}>{row.textContent}</p>
      {row.errorCode && <p>{row.errorCode.replaceAll('_',' ')}</p>}
      {row.status === 'failed' && <button type="button" onClick={async () => {
        try { await retry({id: row._id}) } catch (err) { setError(err.message) }
      }}>Retry email</button>}
    </details>)}</section>}
    {error ? <p className="error-box" role="alert">{error}</p> : null}
    {saved ? <p className="lead-quote-saved" role="status">Quote saved.</p> : null}
  </form>
}
