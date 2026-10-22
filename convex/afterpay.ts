'use node'

import { randomBytes } from 'node:crypto'
import { action } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import { checkoutSettings, customerLink, DAY, moneyToCents } from './lib/payments'

function config(requireEnabled = true) {
  const settings = checkoutSettings()
  if (!settings.configured || (requireEnabled && !settings.enabled)) throw new ConvexError('Online payments are not available yet. Please contact Car Craft.')
  return { environment: settings.environment!, merchantId: process.env.AFTERPAY_MERCHANT_ID!, secret: process.env.AFTERPAY_SECRET_KEY!, base: settings.environment === 'production' ? 'https://global-api.afterpay.com' : 'https://global-api-sandbox.afterpay.com' }
}
class ProviderError extends Error {
  constructor(public status: number, public code?: string, public reference?: string) { super('Payment provider request failed') }
}
async function request(path: string, body?: unknown, requireEnabled = true) {
  const c = config(requireEnabled)
  const response = await fetch(`${c.base}/v2${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${c.merchantId}:${c.secret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': `CarCraft/1.0 (Merchant/${c.merchantId})` },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Capture documents up to 10 seconds to connect plus 70 seconds to read.
    signal: AbortSignal.timeout(path === '/payments/capture' ? 85000 : 35000),
    redirect: 'error'
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined
    // Preserve support identifiers, never a raw provider message or response body.
    throw new ProviderError(response.status, safeId(data?.errorCode), safeId(data?.errorId))
  }
  return response.json()
}
async function limits(ctx: any, force = false) {
  const c = config(false)
  const saved = await ctx.runQuery(internal.payments.getConfiguration, {})
  if (!force && saved && saved.environment === c.environment && saved.merchantId === c.merchantId && saved.checkedAt > Date.now() - DAY) return saved
  const data = await request('/configuration', undefined, false)
  // API v2 uses an object; some legacy accounts still return a configuration array.
  const entry = Array.isArray(data) ? data.find(x => x.maximumAmount?.currency === 'USD') : data
  if (entry?.maximumAmount?.currency !== 'USD' || (entry.minimumAmount !== undefined && entry.minimumAmount?.currency !== 'USD')) throw new Error('USD configuration unavailable')
  // Afterpay may omit minimumAmount for merchants without a minimum order value.
  const minimumCents = entry.minimumAmount === undefined ? 0 : moneyToCents(entry.minimumAmount.amount)
  const maximumCents = moneyToCents(entry.maximumAmount.amount)
  if (maximumCents < minimumCents || maximumCents < 1) throw new Error('Invalid merchant limits')
  const result = { environment: c.environment, merchantId: c.merchantId, minimumCents, maximumCents }
  await ctx.runMutation(internal.payments.saveConfiguration, result)
  return result
}
export const createLink = action({ args: { invoiceNumber: v.string(), amountCents: v.number(), note: v.optional(v.string()), expiresInDays: v.number() }, handler: async (ctx, args): Promise<any> => {
  await ctx.runQuery(internal.payments.adminIdentity, {})
  return ctx.runMutation(internal.payments.insertRequest, { ...args, note: args.note || '', accessToken: randomBytes(32).toString('hex') })
} })
export const checkConnection = action({ args: {}, handler: async (ctx): Promise<any> => {
  await ctx.runQuery(internal.payments.adminIdentity, {})
  config(false)
  try {
    const data = await limits(ctx, true)
    return { environment: data.environment, minimumCents: data.minimumCents, maximumCents: data.maximumCents }
  } catch (error) {
    const detail = error instanceof ProviderError
      ? ` HTTP ${error.status}${error.code ? ` (${error.code})` : ''}.${error.reference ? ` Support reference: ${error.reference}.` : ''}` : ''
    throw new ConvexError(`Afterpay could not verify this connection. Check the environment, merchant credentials, and online account access.${detail}`)
  }
} })
const consumer = v.object({ givenNames: v.string(), surname: v.string(), email: v.string(), phoneNumber: v.string() })
export const startCheckout = action({ args: { token: v.string(), consumer }, handler: async (ctx, args): Promise<any> => {
  const c = config()
  const customer = Object.fromEntries(Object.entries(args.consumer).map(([k, value]) => [k, value.trim()]))
  if (!customer.givenNames || !customer.surname || customer.givenNames.length > 100 || customer.surname.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || customer.email.length > 254 || !/^[+()\d .-]{7,25}$/.test(customer.phoneNumber)) throw new ConvexError('Enter your name, email address and phone number.')
  let available
  try { available = await limits(ctx) } catch { throw new ConvexError('Afterpay is temporarily unavailable. Please try again later.') }
  const attemptId = randomBytes(16).toString('hex')
  const r = await ctx.runMutation(internal.payments.beginCheckout, { token: args.token, environment: c.environment, merchantId: c.merchantId, minimumCents: available.minimumCents, maximumCents: available.maximumCents, attemptId })
  if (r.reuse) return { url: r.checkoutUrl }
  try {
    const confirm = new URL(customerLink(args.token)); confirm.searchParams.set('return', '1')
    const cancel = new URL(customerLink(args.token)); cancel.searchParams.set('cancel', '1')
    const data = await request('/checkouts', {
      amount: { amount: (r.amountCents / 100).toFixed(2), currency: 'USD' },
      consumer: customer,
      merchantReference: r._id,
      merchant: { redirectConfirmUrl: confirm.href, redirectCancelUrl: cancel.href },
      items: [{ name: `Car Craft invoice ${r.invoiceNumber}`, quantity: 1, price: { amount: (r.amountCents / 100).toFixed(2), currency: 'USD' } }]
    })
    const url = new URL(data.redirectCheckoutUrl)
    const checkoutHosts = c.environment === 'production' ? ['portal.afterpay.com', 'cash.app', 'api.cash.app'] : ['portal.sandbox.afterpay.com']
    // US migration adds exact Cash App hosts. Never accept suffix matches or arbitrary ports.
    if (url.protocol !== 'https:' || !checkoutHosts.includes(url.hostname) || url.port || url.username || url.password || typeof data.token !== 'string' || !data.token || data.token.length > 500 || !Number.isFinite(Date.parse(data.expires)) || Date.parse(data.expires) <= Date.now()) throw new Error('Invalid checkout response')
    await ctx.runMutation(internal.payments.saveCheckout, { id: r._id, attemptId, token: data.token, url: url.href, expiresAt: Date.parse(data.expires) })
    return { url: url.href }
  } catch {
    await ctx.runMutation(internal.payments.checkoutFailed, { id: r._id, attemptId })
    throw new ConvexError('Checkout could not be opened. No payment has been recorded. Please try again.')
  }
} })
async function recordPayment(ctx: any, r: any, data: any) {
  // A browser redirect is not payment evidence. Validate every value from the server response.
  const matched = data?.token === r.checkoutToken && data.merchantReference === r._id && data.originalAmount?.currency === 'USD' && moneyToCents(data.originalAmount?.amount) === r.amountCents
  let status: 'paid' | 'declined' | 'review' = 'review'
  if (matched && data.status === 'APPROVED' && data.paymentState === 'CAPTURED' && typeof data.id === 'string' && data.id) status = 'paid'
  else if (matched && data.status === 'DECLINED') status = 'declined'
  return await ctx.runMutation(internal.payments.recordResult, { id: r._id, checkoutToken: r.checkoutToken, captureVersion: r.captureVersion || 0, status, ...(typeof data?.id === 'string' ? { orderId: data.id } : {}) })
}
export const completeCheckout = action({ args: { token: v.string(), checkoutToken: v.string() }, handler: async (ctx, args): Promise<any> => {
  // Finish payments already started even if new checkout creation has been disabled.
  const c = config(false)
  const r = await ctx.runMutation(internal.payments.claimCapture, { ...args, environment: c.environment, merchantId: c.merchantId })
  if (r.alreadyPaid) return { status: 'paid' }
  try {
    const data = await request('/payments/capture', { token: r.checkoutToken, merchantReference: r._id }, false)
    return await recordPayment(ctx, r, data)
  } catch {
    // Do not issue another checkout after an ambiguous timeout. The same token is safely retryable.
    return await ctx.runMutation(internal.payments.recordResult, { id: r._id, checkoutToken: r.checkoutToken, captureVersion: r.captureVersion || 0, status: 'review' })
  }
} })
export const checkPayment = action({ args: { id: v.id('paymentRequests') }, handler: async (ctx, { id }): Promise<any> => {
  const r = await ctx.runQuery(internal.payments.getForAdmin, { id })
  if (!r?.checkoutToken) throw new ConvexError('This request has not started checkout.')
  if (r.status === 'processing' && (r.captureLockUntil || 0) > Date.now()) throw new ConvexError('Payment capture is still in progress. Wait before checking its status.')
  const c = config(false)
  if (r.environment !== c.environment || r.merchantId !== c.merchantId) throw new ConvexError('Restore the original payment environment before checking this request.')
  if (r.status === 'paid' || r.status === 'cancelled') return { status: r.status }
  try {
    const data = await request(`/payments/token:${encodeURIComponent(r.checkoutToken)}`, undefined, false)
    return await recordPayment(ctx, r, data)
  } catch {
    throw new ConvexError('No verified payment result is available yet. Do not collect another payment while this request is processing or under review.')
  }
} })
