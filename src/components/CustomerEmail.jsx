import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { estimateEmail } from '../../shared/estimateEmail'
import './customer-email.css'

const labels = {
  pending: 'Queued', sending: 'Sending', sent: 'Accepted by Brevo', failed: 'Send failed',
  review: 'Delivery uncertain', delivered: 'Delivered', bounced: 'Bounced', blocked: 'Blocked'
}

function Composer({ lead, enabled, close }) {
  const dialog = useRef(null)
  const [key] = useState(() => crypto.randomUUID())
  const [body, setBody] = useState('')
  const [queued, setQueued] = useState(false)
  const doneButton = useRef(null)
  useEffect(() => { if (queued) doneButton.current?.focus() }, [queued])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = useMutation(api.estimateEmails.send)
  useEffect(() => {
    const modal = dialog.current
    modal.showModal()
    return () => modal.close()
  }, [])
  const preview = estimateEmail({ kind: 'estimate', name: lead.name, vehicle: lead.vehicle,
    details: body.trim() || 'Your estimate details will appear here.' })
  async function submit(event) {
    event.preventDefault()
    if (busy || !body.trim()) return
    setBusy(true)
    setError('')
    try {
      await send({id: lead._id, recipient: lead.email, details: body.trim(), key})
      setQueued(true)
      setBusy(false)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return <dialog className={"estimate-email-dialog" + (queued ? " is-confirmed" : "")} aria-labelledby="estimate-email-title" ref={dialog}
    onCancel={event => {event.preventDefault(); if (!busy) close(false)}}>
    {queued ? <section className="mail-confirmation">
      <div role="status"><h2 id="estimate-email-title">Estimate email queued</h2>
        <p>Your estimate for <strong>{lead.email}</strong> is queued for delivery. Email history will show when it arrives.</p></div>
      <button ref={doneButton} className="primary-btn" onClick={close}>Back to email history</button>
    </section> : <form onSubmit={submit}>
      <header><h2 id="estimate-email-title">Send estimate email</h2><button type="button" className="ghost-btn" disabled={busy} onClick={() => close(false)}>Close</button></header>
      <div className="mail-columns"><div className="mail-editor">
        <p><strong>To</strong><br/>{lead.name} &lt;{lead.email}&gt;</p>
        <p><strong>Subject</strong><br/>{preview.subject}</p>
        <label>Your estimate<textarea autoFocus required maxLength={10000} rows={8} value={body} disabled={busy}
          onChange={e => setBody(e.target.value)} placeholder="Describe the repair, price, and next steps." /></label>
      </div><section className="mail-preview"><h3>Customer preview</h3><iframe title="Customer email preview" sandbox="" srcDoc={preview.htmlContent}/></section></div>
      <footer>
        {error && <div className="mail-feedback" role="alert">Couldn’t confirm the send. Your draft is ready to retry. {error}</div>}
        {busy && <div className="mail-feedback" role="status">Queueing your estimate for {lead.email}…</div>}
        {!enabled && <div className="mail-feedback">Email sending is unavailable.</div>}
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => close(false)}>Cancel</button>
        <button className="primary-btn" disabled={busy || !enabled || !body.trim()}>{busy ? 'Queueing…' : 'Send email'}</button>
      </footer>
    </form>}
  </dialog>
}

export default function CustomerEmail({ lead }) {
  const history = useQuery(api.estimateEmails.history, {id: lead._id})
  const refresh = useMutation(api.estimateEmails.refreshHistory)
  const retry = useMutation(api.estimateEmails.retry)
  const [composing, setComposing] = useState(false)
  const [notice, setNotice] = useState('')
  const waiting = history?.rows?.some(row => row.status === 'sent' && !row.delivery)
  useEffect(() => {
    if (!waiting) return
    const check = () => refresh({id:lead._id}).catch(() => setNotice('Could not refresh delivery status.'))
    check()
    const timer = setInterval(check, 60000)
    return () => clearInterval(timer)
  }, [waiting, lead._id, refresh])
  return <section className="lead-email-history" aria-label="Customer email">
    <header><h3>Email history</h3><button className="primary-btn" disabled={lead.archived || lead.deletedAt || lead.submissionState === 'pending_upload'}
      onClick={() => {setNotice(''); setComposing(true)}}>Send estimate email</button></header>
    {notice && <p role="status">{notice}</p>}
    {!history ? <p>Loading email history…</p> : !history.rows?.length ? <p>No emails recorded.</p> : history.rows.map(row =>
      <details key={row._id}><summary><strong>{row.kind === 'thanks' ? 'Thank-you email' : 'Estimate email'}</strong>
        <span className="mail-stage" data-stage={row.delivery || row.status} aria-live="polite">{labels[row.delivery || row.status]}</span><time>{new Date(row.deliveryAt || row._creationTime).toLocaleString()}</time></summary>
        <p>To {row.email}</p><p className="mail-snapshot">{row.textContent}</p>
        {row.status === 'failed' && <button className="ghost-btn" onClick={() => retry({id:row._id}).catch(err => setNotice(err.message))}>Retry email</button>}
      </details>)}
    {composing && <Composer lead={lead} enabled={history?.enabled} close={() => setComposing(false)}/>}
  </section>
}
