import { ConvexError } from 'convex/values'

export const DAY = 86400000
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/
export function invoiceKey(value: string) {
  const key = value.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9 ._/-]{0,63}$/.test(key)) throw new ConvexError('Enter an invoice number using letters, numbers, spaces, /, -, _ or . (up to 64 characters).')
  return key
}
export function validAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000) throw new ConvexError('Enter a valid invoice amount between $0.01 and $1,000,000.00.')
  return cents
}
export function moneyToCents(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('Invalid provider amount')
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
export function checkoutSettings() {
  const environment = process.env.AFTERPAY_ENVIRONMENT
  const configured = (environment === 'sandbox' || environment === 'production') && !!process.env.AFTERPAY_MERCHANT_ID && !!process.env.AFTERPAY_SECRET_KEY
  return {
    environment: environment === 'sandbox' || environment === 'production' ? environment : null,
    enabled: configured && process.env.AFTERPAY_CHECKOUT_ENABLED === 'true',
    configured,
  }
}
export function paymentPageUrl() {
  const url = new URL(process.env.PAYMENT_PUBLIC_URL || 'https://carcraftautobodytowing.com/after-pay.html')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ConvexError('The payment page URL must be HTTPS with no query or fragment.')
  return url.href
}
export function customerLink(token: string) {
  const url = new URL(paymentPageUrl())
  url.searchParams.set('payment', token)
  return url.href
}
export async function hashToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
export function displayedStatus(request: { status: string; expiresAt: number }) {
  return ['pending', 'declined'].includes(request.status) && request.expiresAt <= Date.now() ? 'expired' : request.status
}
