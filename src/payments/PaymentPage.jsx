import { useEffect, useRef, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import logo from '../assets/images/branding/carcraft-logo.png'
import { dateTime, money, paymentError } from './shared'

export default function PaymentPage() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('payment') || ''
  const checkoutToken = params.get('orderToken') || ''
  const returning = params.get('return') === '1'
  const cancelled = params.get('cancel') === '1' || params.get('status') === 'CANCELLED'
  const confirmedReturn = returning && params.get('status') === 'SUCCESS' && !cancelled
  const validToken = /^[a-f0-9]{64}$/.test(token)
  const request = useQuery(api.payments.publicRequest, validToken ? { token } : 'skip')
  const startCheckout = useAction(api.afterpay.startCheckout)
  const completeCheckout = useAction(api.afterpay.completeCheckout)
  const [customer, setCustomer] = useState({ givenNames: '', surname: '', email: '', phoneNumber: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const startedVerification = useRef(false)

  async function verify() {
    setBusy(true); setError('')
    try { await completeCheckout({ token, checkoutToken }) }
    catch (e) { setError(paymentError(e, 'Payment verification could not finish. Please retry or contact Car Craft before making another payment.')) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (confirmedReturn && checkoutToken && request && ['checkout_started', 'processing', 'review'].includes(request.status) && !startedVerification.current) {
      startedVerification.current = true
      void verify()
    }
  }, [confirmedReturn, checkoutToken, request?.status])

  async function pay(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await startCheckout({ token, consumer: customer })
      window.location.assign(result.url)
    } catch (e) { setError(paymentError(e, 'Checkout could not be opened. Please try again.')); setBusy(false) }
  }
  const test = request?.environment === 'sandbox'
  const closed = request && ['paid', 'declined', 'cancelled', 'expired'].includes(request.status)
  const verifying = request && ['processing', 'review'].includes(request.status)
  const checkoutAllowed = request?.checkoutEnabled && !closed && !verifying && !returning
  let notice = ''
  if (request?.status === 'cancelled') notice = 'This payment link was cancelled. Please ask Car Craft for a current link.'
  if (request?.status === 'expired') notice = 'This payment link has expired. Please ask Car Craft for a new link.'
  if (request?.status === 'declined') notice = 'Afterpay did not approve this payment. Contact Car Craft to arrange another payment method.'
  return <main className="invoice-page">
    <header className="invoice-brand"><a href="/" aria-label="Car Craft home"><img src={logo} alt="Car Craft Auto Body & Towing" /></a><span>INVOICE PAYMENT</span></header>
    <section className="invoice-card">
      {!validToken ? <><p className="invoice-eyebrow">Car Craft payments</p><h1>Have an invoice to pay?</h1><p>Open the payment link Car Craft sent you. Each link is prepared for your invoice and amount.</p></> : request === undefined ? <p role="status">Loading your invoice…</p> : !request ? <><h1>Link unavailable</h1><p>Check that you opened the complete payment link, or contact Car Craft for help.</p></> : <>
        {test && <div className="invoice-notice">Test checkout — no real money is collected.</div>}
        <p className="invoice-eyebrow">Car Craft Auto Body & Towing</p>
        <h1>{request.status === 'paid' ? test ? 'Test payment completed' : 'Payment received' : 'Your invoice'}</h1>
        <div className="invoice-summary"><span>Invoice <strong>{request.invoiceNumber}</strong></span><strong className="invoice-amount">{money(request.amountCents)}</strong><span>USD · Invoice total</span></div>
        {request.status === 'paid' ? <div className="invoice-success" role="status"><strong>{test ? 'This was a sandbox test, not an invoice payment.' : 'Thank you. Your payment has been confirmed.'}</strong>{request.paidAt && <p>{dateTime(request.paidAt)}</p>}<p>{test ? 'No funds were collected.' : 'Car Craft’s records have been updated. You can close this page.'}</p></div> : <>
          {notice && <div className="invoice-notice">{notice}</div>}
          {verifying && <div className="invoice-notice" role="status"><strong>{request.status === 'processing' ? 'Verifying your payment…' : 'Your payment needs verification.'}</strong><p>Please do not make another payment. Retry verification here or call Car Craft.</p></div>}
          {!closed && !verifying && !request.checkoutEnabled && <div className="invoice-notice"><strong>Online payment is not available yet.</strong><p>Your invoice is ready to review. Please call Car Craft to arrange payment.</p></div>}
          {cancelled && !closed && !verifying && <p className="invoice-muted">You returned from Afterpay. No payment has been confirmed.</p>}
          {returning && !checkoutToken && !closed && <div className="invoice-notice">The checkout reference is missing. Please contact Car Craft to check your payment before trying again.</div>}
          {returning && checkoutToken && !confirmedReturn && !cancelled && !closed && <div className="invoice-notice">Afterpay did not return a successful checkout confirmation. Please contact Car Craft to check your payment.</div>}
          {confirmedReturn && checkoutToken && !closed && <button className="invoice-button" disabled={busy} onClick={verify}>{busy ? 'Verifying payment…' : 'Retry payment verification'}</button>}
          {checkoutAllowed && <form onSubmit={pay}>
            <p>Continue to Afterpay to review your available payment options.</p>
            <div className="invoice-name-row"><label>First name<input required maxLength={100} autoComplete="given-name" value={customer.givenNames} onChange={e => setCustomer({ ...customer, givenNames: e.target.value })} /></label><label>Last name<input required maxLength={100} autoComplete="family-name" value={customer.surname} onChange={e => setCustomer({ ...customer, surname: e.target.value })} /></label></div>
            <label>Email address<input required type="email" maxLength={254} autoComplete="email" value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} /></label>
            <label>Phone number<input required type="tel" maxLength={25} autoComplete="tel" value={customer.phoneNumber} onChange={e => setCustomer({ ...customer, phoneNumber: e.target.value })} /></label>
            <button className="invoice-button" disabled={busy}>{busy ? 'Opening secure checkout…' : 'Continue to Afterpay'}</button>
            <p className="invoice-small">Your contact details and invoice amount are shared with Afterpay to prepare checkout. Payment options are subject to Afterpay approval. You’ll review the terms there before confirming.</p>
          </form>}
          {error && <div className="invoice-error" role="alert">{error}</div>}
          {!closed && <p className="invoice-small">Link expires {dateTime(request.expiresAt)}.</p>}
        </>}
      </>}
      <footer className="invoice-footer">Questions about your invoice? <a href="tel:+18609531966">Call 860-953-1966</a><div><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></div></footer>
    </section>
    <p className="invoice-caption">8 South Street · West Hartford, CT</p>
  </main>
}
