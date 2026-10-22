import { query, mutation, internalQuery, internalMutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { requireAdmin } from './lib/requireAdmin'
import { checkoutSettings, customerLink, DAY, displayedStatus, hashToken, invoiceKey, validAmount } from './lib/payments'

const requestId = v.id('paymentRequests')
async function findByToken(ctx: any, token: string) {
  const hash = await hashToken(token)
  if (!hash) return null
  return ctx.db.query('paymentRequests').withIndex('by_token_hash', (q: any) => q.eq('tokenHash', hash)).unique()
}
async function event(ctx: any, id: any, type: string) {
  await ctx.db.insert('paymentEvents', { requestId: id, type, createdAt: Date.now() })
}
export const adminIdentity = internalQuery({ args: {}, handler: ctx => requireAdmin(ctx) })
export const settings = query({ args: {}, handler: async ctx => {
  await requireAdmin(ctx)
  const settings = checkoutSettings()
  const config = await ctx.db.query('paymentConfiguration').withIndex('by_key', q => q.eq('key', 'afterpay')).unique()
  const matching = config && config.environment === settings.environment && config.merchantId === process.env.AFTERPAY_MERCHANT_ID
  return { ...settings, publicUrl: customerLink('LINK'), limits: matching ? { minimumCents: config.minimumCents, maximumCents: config.maximumCents, checkedAt: config.checkedAt } : null }
} })
export const list = query({ args: {}, handler: async ctx => {
  await requireAdmin(ctx)
  const rows = await ctx.db.query('paymentRequests').order('desc').take(100)
  return rows.map(r => ({ id: r._id, invoiceNumber: r.invoiceNumber, amountCents: r.amountCents, note: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt, status: displayedStatus(r), paidAt: r.paidAt, orderId: r.orderId, environment: r.environment, link: customerLink(r.accessToken) }))
} })
export const insertRequest = internalMutation({ args: { invoiceNumber: v.string(), amountCents: v.number(), note: v.string(), expiresInDays: v.number(), accessToken: v.string() }, handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx)
  const key = invoiceKey(args.invoiceNumber)
  validAmount(args.amountCents)
  if (![1, 3, 7, 14, 30].includes(args.expiresInDays)) throw new ConvexError('Choose a valid expiration period.')
  if (args.note.length > 500) throw new ConvexError('Keep the internal note under 500 characters.')
  const tokenHash = await hashToken(args.accessToken)
  if (!tokenHash) throw new Error('Invalid generated token')
  const existing = await ctx.db.query('paymentRequests').withIndex('by_invoice', q => q.eq('invoiceKey', key)).collect()
  // Cancelled records are safe to replace: cancellation is forbidden once a capture has started.
  // An expired link must be explicitly cancelled before a replacement is issued.
  const active = existing.find(r => r.status !== 'cancelled')
  if (active) {
    if (active.amountCents === args.amountCents && active.note === args.note.trim() && displayedStatus(active) === 'pending') return { id: active._id, link: customerLink(active.accessToken), reused: true }
    throw new ConvexError('This invoice already has a payment request. Use its existing link, or cancel the unpaid request before replacing it.')
  }
  const now = Date.now()
  const id = await ctx.db.insert('paymentRequests', { invoiceNumber: args.invoiceNumber.trim(), invoiceKey: key, amountCents: args.amountCents, currency: 'USD', note: args.note.trim(), accessToken: args.accessToken, tokenHash, status: 'pending', createdAt: now, updatedAt: now, expiresAt: now + args.expiresInDays * DAY, createdBy: admin, checkoutAttempts: 0 })
  await event(ctx, id, 'created')
  return { id, link: customerLink(args.accessToken), reused: false }
} })
export const cancel = mutation({ args: { id: requestId }, handler: async (ctx, { id }) => {
  await requireAdmin(ctx)
  const r = await ctx.db.get(id)
  if (!r || (!['pending', 'declined', 'checkout_started', 'expired'].includes(r.status) && !(r.status === 'creating_checkout' && (r.checkoutLockUntil || 0) <= Date.now()))) throw new ConvexError('This request cannot be cancelled while checkout is being prepared, payment is processing, under review, or paid.')
  await ctx.db.patch(id, { status: 'cancelled', updatedAt: Date.now() })
  await event(ctx, id, 'cancelled')
} })
export const publicRequest = query({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  const r = await findByToken(ctx, token)
  if (!r) return null
  const settings = checkoutSettings()
  return { invoiceNumber: r.invoiceNumber, amountCents: r.amountCents, currency: r.currency, status: displayedStatus(r), expiresAt: r.expiresAt, paidAt: r.paidAt, environment: r.environment || settings.environment, checkoutEnabled: settings.enabled && (!r.environment || r.environment === settings.environment), hasCheckout: !!r.checkoutToken }
} })
export const getConfiguration = internalQuery({ args: {}, handler: async ctx => ctx.db.query('paymentConfiguration').withIndex('by_key', q => q.eq('key', 'afterpay')).unique() })
export const saveConfiguration = internalMutation({ args: { environment: v.string(), merchantId: v.string(), minimumCents: v.number(), maximumCents: v.number() }, handler: async (ctx, args) => {
  const current = await ctx.db.query('paymentConfiguration').withIndex('by_key', q => q.eq('key', 'afterpay')).unique()
  const data = { ...args, key: 'afterpay', checkedAt: Date.now() }
  if (current) await ctx.db.patch(current._id, data)
  else await ctx.db.insert('paymentConfiguration', data)
} })
export const beginCheckout = internalMutation({ args: { token: v.string(), environment: v.string(), merchantId: v.string(), minimumCents: v.number(), maximumCents: v.number(), attemptId: v.string() }, handler: async (ctx, args) => {
  const r = await findByToken(ctx, args.token)
  if (!r) throw new ConvexError('This payment link is unavailable.')
  if (r.environment && (r.environment !== args.environment || r.merchantId !== args.merchantId)) throw new ConvexError('This payment needs assistance from Car Craft. Please call the shop.')
  if (['paid', 'declined', 'cancelled', 'processing', 'review'].includes(r.status)) throw new ConvexError('This invoice cannot start another checkout. Check its payment status.')
  if (r.expiresAt <= Date.now()) throw new ConvexError('This payment link has expired. Ask Car Craft for a new link.')
  if (r.amountCents < args.minimumCents || r.amountCents > args.maximumCents) throw new ConvexError('This invoice is outside the available Afterpay payment limits. Please contact Car Craft.')
  if (r.checkoutToken) {
    if ((r.checkoutExpiresAt || 0) <= Date.now()) throw new ConvexError('This checkout has expired. Please contact Car Craft to verify the payment and issue a new link.')
    return { ...r, reuse: true }
  }
  if (r.status === 'creating_checkout' && (r.checkoutLockUntil || 0) > Date.now()) throw new ConvexError('Checkout is being prepared. Please try again in a moment.')
  if (r.checkoutAttempts >= 5) throw new ConvexError('This link needs assistance from Car Craft. Please call the shop.')
  await ctx.db.patch(r._id, { status: 'creating_checkout', attemptId: args.attemptId, checkoutLockUntil: Date.now() + 120000, environment: args.environment, merchantId: args.merchantId, checkoutAttempts: r.checkoutAttempts + 1, updatedAt: Date.now() })
  await event(ctx, r._id, 'checkout_requested')
  return { ...r, reuse: false }
} })
export const saveCheckout = internalMutation({ args: { id: requestId, attemptId: v.string(), token: v.string(), url: v.string(), expiresAt: v.number() }, handler: async (ctx, args) => {
  const r = await ctx.db.get(args.id)
  if (!r || r.status !== 'creating_checkout' || r.attemptId !== args.attemptId) throw new Error('Checkout attempt superseded')
  await ctx.db.patch(r._id, { status: 'checkout_started', checkoutToken: args.token, checkoutUrl: args.url, checkoutExpiresAt: args.expiresAt, updatedAt: Date.now() })
  await event(ctx, r._id, 'checkout_started')
} })
export const checkoutFailed = internalMutation({ args: { id: requestId, attemptId: v.string() }, handler: async (ctx, args) => {
  const r = await ctx.db.get(args.id)
  // No checkout URL is exposed until saveCheckout succeeds. An orphan checkout cannot be paid through this app.
  if (r?.status === 'creating_checkout' && r.attemptId === args.attemptId) {
    await ctx.db.patch(r._id, { status: 'pending', updatedAt: Date.now() })
    await event(ctx, r._id, 'checkout_failed')
  }
} })
export const claimCapture = internalMutation({ args: { token: v.string(), checkoutToken: v.string(), environment: v.string(), merchantId: v.string() }, handler: async (ctx, args) => {
  const r = await findByToken(ctx, args.token)
  if (!r || r.checkoutToken !== args.checkoutToken || r.environment !== args.environment || r.merchantId !== args.merchantId) throw new ConvexError('The checkout does not match this payment request.')
  if (r.status === 'paid') return { ...r, alreadyPaid: true }
  if (!['checkout_started', 'processing', 'review'].includes(r.status)) throw new ConvexError('This payment request is no longer available.')
  // Checkout started while link valid may finish after link expiration; never expire an in-flight capture.
  if (r.status === 'processing' && (r.captureLockUntil || 0) > Date.now()) throw new ConvexError('Payment verification is in progress. Please wait a moment.')
  const captureVersion = (r.captureVersion || 0) + 1
  await ctx.db.patch(r._id, { status: 'processing', captureVersion, captureLockUntil: Date.now() + 120000, updatedAt: Date.now() })
  await event(ctx, r._id, 'capture_requested')
  return { ...r, captureVersion, alreadyPaid: false }
} })
export const recordResult = internalMutation({ args: { id: requestId, checkoutToken: v.string(), captureVersion: v.number(), status: v.union(v.literal('paid'), v.literal('declined'), v.literal('review')), orderId: v.optional(v.string()) }, handler: async (ctx, args) => {
  const r = await ctx.db.get(args.id)
  if (!r || r.checkoutToken !== args.checkoutToken) throw new Error('Payment result does not match the request')
  // A GET started before capture (or an older timed-out capture) cannot overwrite a newer attempt.
  if ((r.captureVersion || 0) !== args.captureVersion || r.status === 'paid' || r.status === 'cancelled') return { status: r.status }
  // A definitive verified result can arrive after a network timeout and supersedes review.
  if (r.status === 'declined' && args.status === 'review') return { status: r.status }
  await ctx.db.patch(r._id, { status: args.status, orderId: args.orderId || r.orderId, paidAt: args.status === 'paid' ? Date.now() : r.paidAt, captureLockUntil: 0, updatedAt: Date.now() })
  await event(ctx, r._id, args.status)
  return { status: args.status }
} })
export const getForAdmin = internalQuery({ args: { id: requestId }, handler: async (ctx, { id }) => { await requireAdmin(ctx); return ctx.db.get(id) } })
