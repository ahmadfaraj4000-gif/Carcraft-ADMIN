import { useEffect, useId, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

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

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    try {
      const minAmountCents = parseAmount(amount)
      const maxAmountCents = upper.trim() ? parseAmount(upper) : undefined
      if (maxAmountCents !== undefined && maxAmountCents < minAmountCents) {
        throw new Error('The upper amount must be at least the quoted amount.')
      }
      setSaving(true)
      await saveQuote({ id: lead._id, minAmountCents, ...(maxAmountCents === undefined ? {} : { maxAmountCents }) })
      setSaved(true)
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
      <button className="primary-btn small" type="submit" disabled={saving || Boolean(lead.deletedAt)}>{saving ? 'Saving…' : 'Save quote'}</button>
    </div>
    <p className="muted lead-quote-help" id={helpId}>Enter the price quoted to the customer in USD. For a range, add an upper amount.</p>
    {lead.quote?.updatedAt ? <p className="muted lead-quote-help">Last saved {new Date(lead.quote.updatedAt).toLocaleString()}</p> : null}
    {error ? <p className="error-box" role="alert">{error}</p> : null}
    {saved ? <p className="lead-quote-saved" role="status">Quote saved.</p> : null}
  </form>
}
