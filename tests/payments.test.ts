import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
const modules = import.meta.glob('../convex/**/*.{ts,js}')
const customer = { givenNames: 'Test', surname: 'Customer', email: 'test@example.com', phoneNumber: '202-555-0100' }
let checkoutReference = ''
let checkoutSequence = 0
let lastCheckoutToken = ''
let captureMode = 'paid'
let captureGate: Promise<void> | null = null
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('ADMIN_USERNAME', 'admin@example.com')
  vi.stubEnv('AFTERPAY_ENVIRONMENT', 'sandbox')
  vi.stubEnv('AFTERPAY_MERCHANT_ID', 'test-merchant')
  vi.stubEnv('AFTERPAY_SECRET_KEY', 'test-secret')
  vi.stubEnv('AFTERPAY_CHECKOUT_ENABLED', 'true')
  vi.stubEnv('PAYMENT_PUBLIC_URL', 'https://carcraft.example/after-pay.html')
  checkoutSequence = 0; checkoutReference = ''; lastCheckoutToken = ''; captureMode = 'paid'; captureGate = null
  fetchMock = vi.fn(async (url: string, options: any) => {
    expect(url.startsWith('https://global-api-sandbox.afterpay.com/v2/')).toBe(true)
    if (url.endsWith('/configuration')) return Response.json({ minimumAmount: { amount: '1.00', currency: 'USD' }, maximumAmount: { amount: '2000.00', currency: 'USD' } })
    if (url.endsWith('/checkouts')) {
      const body = JSON.parse(options.body)
      checkoutReference = body.merchantReference
      lastCheckoutToken = `checkout-${++checkoutSequence}`
      return Response.json({ token: lastCheckoutToken, expires: new Date(Date.now() + 3600000).toISOString(), redirectCheckoutUrl: `https://portal.sandbox.afterpay.com/us/checkout/?token=${lastCheckoutToken}` })
    }
    if (url.endsWith('/payments/capture') || url.includes('/payments/token:')) {
      if (captureGate) await captureGate
      if (captureMode === 'timeout') throw new Error('Network interrupted')
      return Response.json({ id: 'provider-order-123', token: captureMode === 'wrong_token' ? 'other-token' : lastCheckoutToken, merchantReference: captureMode === 'wrong_reference' ? 'other-invoice' : checkoutReference, status: captureMode === 'declined' ? 'DECLINED' : 'APPROVED', paymentState: captureMode === 'authorized' ? 'AUTH_APPROVED' : captureMode === 'partial' ? 'PARTIALLY_CAPTURED' : 'CAPTURED', originalAmount: { amount: captureMode === 'wrong_amount' ? '99.00' : '100.25', currency: captureMode === 'wrong_currency' ? 'CAD' : 'USD' } })
    }
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function setup() {
  const t = convexTest(schema, modules)
  const user = await t.run(ctx => ctx.db.insert('users', { email: 'admin@example.com' }))
  const admin = t.withIdentity({ subject: `${user}|session` })
  return { t, admin }
}
async function create(admin: any, invoiceNumber = 'CC-10482', amountCents = 10025) {
  const result = await admin.action(api.afterpay.createLink, { invoiceNumber, amountCents, note: 'Internal only', expiresInDays: 7 })
  return { ...result, token: new URL(result.link).searchParams.get('payment')! }
}
async function start(t: any, token: string) {
  return t.action(api.afterpay.startCheckout, { token, consumer: customer })
}

test('only the configured admin can create, list, cancel, or inspect payment settings', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  const outsider = await t.run(ctx => ctx.db.insert('users', { email: 'outsider@example.com' }))
  for (const client of [t, t.withIdentity({ subject: `${outsider}|session` })]) {
    await expect(create(client)).rejects.toThrow('Admin authentication required')
    await expect(client.query(api.payments.list, {})).rejects.toThrow('Admin authentication required')
    await expect(client.query(api.payments.settings, {})).rejects.toThrow('Admin authentication required')
    await expect(client.mutation(api.payments.cancel, { id: r.id })).rejects.toThrow('Admin authentication required')
    await expect(client.action(api.afterpay.checkConnection, {})).rejects.toThrow('Admin authentication required')
  }
  expect(fetchMock).not.toHaveBeenCalled()
})
test('links work without credentials, use unguessable tokens, and expose only invoice details', async () => {
  vi.stubEnv('AFTERPAY_SECRET_KEY', '')
  const { t, admin } = await setup()
  const r = await create(admin)
  expect(r.token).toMatch(/^[a-f0-9]{64}$/)
  const view = await t.query(api.payments.publicRequest, { token: r.token })
  expect(view).toMatchObject({ invoiceNumber: 'CC-10482', amountCents: 10025, status: 'pending', checkoutEnabled: false })
  for (const key of ['note', 'createdBy', 'accessToken', 'tokenHash', 'checkoutToken', 'merchantId']) expect(view).not.toHaveProperty(key)
  expect(await t.query(api.payments.publicRequest, { token: 'guess' })).toBeNull()
  expect(await t.query(api.payments.publicRequest, { token: '0'.repeat(64) })).toBeNull()
  await expect(start(t, r.token)).rejects.toThrow('not available')
  expect(fetchMock).not.toHaveBeenCalled()
})
test('creation retries return one link, normalized duplicates and invalid amounts are rejected', async () => {
  const { t, admin } = await setup()
  const first = await create(admin)
  const retry = await create(admin, ' cc-10482 ')
  expect(retry.id).toBe(first.id)
  expect(retry.link).toBe(first.link)
  expect(retry.reused).toBe(true)
  await expect(create(admin, 'CC-10482', 20000)).rejects.toThrow('already has')
  for (const amount of [0, -10, 12.5, Infinity, NaN, 100000001]) await expect(create(admin, 'BAD', amount)).rejects.toThrow()
  expect(await admin.query(api.payments.list, {})).toHaveLength(1)
  await admin.mutation(api.payments.cancel, { id: first.id })
  const replacement = await create(admin)
  expect(replacement.token).not.toBe(first.token)
  expect((await t.query(api.payments.publicRequest, { token: first.token }))?.status).toBe('cancelled')
})
test('checkout amount and reference come from the locked invoice; concurrent starts reuse one token', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  const first = await start(t, r.token)
  expect(await start(t, r.token)).toEqual(first)
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/checkouts'))).toHaveLength(1)
  const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/checkouts'))![1].body)
  expect(body.amount).toEqual({ amount: '100.25', currency: 'USD' })
  expect(body.merchantReference).toBe(r.id)
  expect(body.isCashAppPay).toBeUndefined()
  expect(new URL(body.merchant.redirectConfirmUrl).searchParams.get('payment')).toBe(r.token)
  expect(body).not.toHaveProperty('note')
  expect((await admin.query(api.payments.list, {}))[0].status).toBe('checkout_started')
})
test('expired, cancelled and out-of-range invoices cannot create checkout', async () => {
  const { t, admin } = await setup()
  const expired = await create(admin, 'EXPIRED')
  await t.run(ctx => ctx.db.patch(expired.id, { expiresAt: Date.now() - 1 }))
  expect((await t.query(api.payments.publicRequest, { token: expired.token }))?.status).toBe('expired')
  await expect(start(t, expired.token)).rejects.toThrow('expired')
  const cancelled = await create(admin, 'CANCELLED')
  await admin.mutation(api.payments.cancel, { id: cancelled.id })
  await expect(start(t, cancelled.token)).rejects.toThrow('cannot start')
  const excessive = await create(admin, 'EXCESSIVE', 250000)
  await expect(start(t, excessive.token)).rejects.toThrow('limits')
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/checkouts'))).toHaveLength(0)
})
test('only server-verified, matching, fully captured payments become paid; repeats do not recapture', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  const checkoutToken = lastCheckoutToken
  await expect(t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: 'forged-token' })).rejects.toThrow('does not match')
  expect(await t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken })).toEqual({ status: 'paid' })
  expect(await t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken })).toEqual({ status: 'paid' })
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/payments/capture'))).toHaveLength(1)
  expect((await admin.query(api.payments.list, {}))[0]).toMatchObject({ status: 'paid', orderId: 'provider-order-123', environment: 'sandbox', paidAt: expect.any(Number) })
  await expect(admin.mutation(api.payments.cancel, { id: r.id })).rejects.toThrow('cannot be cancelled')
  await expect(create(admin)).rejects.toThrow('already has')
})
test.each(['wrong_amount', 'wrong_token', 'wrong_reference', 'wrong_currency', 'partial', 'authorized', 'timeout'])('uncertain capture (%s) blocks another payment and can be reconciled', async mode => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  captureMode = mode
  expect(await t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })).toEqual({ status: 'review' })
  await expect(start(t, r.token)).rejects.toThrow('cannot start')
  await expect(admin.mutation(api.payments.cancel, { id: r.id })).rejects.toThrow('cannot be cancelled')
  captureMode = 'paid'
  expect(await admin.action(api.afterpay.checkPayment, { id: r.id })).toEqual({ status: 'paid' })
})
test('processing locks prevent cancellation, duplicate capture and invoice replacement', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  let release!: () => void
  captureGate = new Promise(resolve => { release = resolve })
  const operation = t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/payments/capture'))).toBe(true))
  await expect(t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })).rejects.toThrow('in progress')
  await expect(admin.action(api.afterpay.checkPayment, { id: r.id })).rejects.toThrow('still in progress')
  await expect(admin.mutation(api.payments.cancel, { id: r.id })).rejects.toThrow('cannot be cancelled')
  await expect(create(admin)).rejects.toThrow('already has')
  release(); expect(await operation).toEqual({ status: 'paid' })
})
test('a cancelled checkout cannot be captured by an old return link', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  await admin.mutation(api.payments.cancel, { id: r.id })
  await expect(t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })).rejects.toThrow('no longer available')
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/payments/capture'))).toHaveLength(0)
})
test('sandbox tokens cannot be used against production credentials', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  vi.stubEnv('AFTERPAY_ENVIRONMENT', 'production')
  expect((await t.query(api.payments.publicRequest, { token: r.token }))?.checkoutEnabled).toBe(false)
  await expect(t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })).rejects.toThrow('does not match')
})
test('a malicious checkout URL is never returned to customers', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await admin.action(api.afterpay.checkConnection, {})
  fetchMock.mockResolvedValueOnce(Response.json({ token: 'x', expires: new Date(Date.now() + 3600000).toISOString(), redirectCheckoutUrl: 'https://attacker.example/checkout' }))
  await expect(start(t, r.token)).rejects.toThrow('could not be opened')
  expect((await admin.query(api.payments.list, {}))[0].status).toBe('pending')
})

test.each([false, true])('a merchant with no minimum amount can accept checkout (legacy array: %s)', async legacy => {
  const { t, admin } = await setup()
  const data = { maximumAmount: { amount: '2000.00', currency: 'USD' } }
  fetchMock.mockResolvedValueOnce(Response.json(legacy ? [data] : data))
  expect(await admin.action(api.afterpay.checkConnection, {})).toMatchObject({ minimumCents: 0, maximumCents: 200000 })
  const r = await create(admin)
  expect(await start(t, r.token)).toHaveProperty('url')
})

test.each(['cash.app', 'api.cash.app'])('US migration checkout host %s is accepted only for production', async host => {
  vi.stubEnv('AFTERPAY_ENVIRONMENT', 'production')
  const { t, admin } = await setup()
  fetchMock.mockResolvedValueOnce(Response.json({ maximumAmount: { amount: '2000.00', currency: 'USD' } }))
  await admin.action(api.afterpay.checkConnection, {})
  const r = await create(admin)
  fetchMock.mockResolvedValueOnce(Response.json({ token: 'migration-token', expires: new Date(Date.now() + 3600000).toISOString(), redirectCheckoutUrl: `https://${host}/checkout?token=migration-token` }))
  expect(await start(t, r.token)).toEqual({ url: `https://${host}/checkout?token=migration-token` })
})

test.each(['https://portal.sandbox.afterpay.com.attacker.example/', 'http://portal.sandbox.afterpay.com/', 'https://portal.sandbox.afterpay.com:8443/', 'https://user@portal.sandbox.afterpay.com/', 'https://cash.app/'])('unsafe or wrong-environment redirect %s is rejected', async url => {
  const { t, admin } = await setup()
  await admin.action(api.afterpay.checkConnection, {})
  const r = await create(admin)
  fetchMock.mockResolvedValueOnce(Response.json({ token: 'token', expires: new Date(Date.now() + 3600000).toISOString(), redirectCheckoutUrl: url }))
  await expect(start(t, r.token)).rejects.toThrow('could not be opened')
})

test('declined payments require a replacement request instead of reusing a declined token', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  captureMode = 'declined'
  expect(await t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })).toEqual({ status: 'declined' })
  await expect(start(t, r.token)).rejects.toThrow('cannot start')
  await admin.mutation(api.payments.cancel, { id: r.id })
  expect((await create(admin)).id).not.toBe(r.id)
})

test('a reconciliation started before capture cannot overwrite that capture or unlock cancellation', async () => {
  const { t, admin } = await setup()
  const r = await create(admin)
  await start(t, r.token)
  let releaseRead!: () => void
  const readGate = new Promise<void>(resolve => { releaseRead = resolve })
  fetchMock.mockImplementationOnce(async () => {
    await readGate
    return Response.json({ id: 'provider-order-123', token: lastCheckoutToken, merchantReference: checkoutReference, status: 'DECLINED', paymentState: 'AUTH_DECLINED', originalAmount: { amount: '100.25', currency: 'USD' } })
  })
  const read = admin.action(api.afterpay.checkPayment, { id: r.id })
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/payments/token:'))).toBe(true))
  let releaseCapture!: () => void
  captureGate = new Promise<void>(resolve => { releaseCapture = resolve })
  const capture = t.action(api.afterpay.completeCheckout, { token: r.token, checkoutToken: lastCheckoutToken })
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/payments/capture'))).toBe(true))
  releaseRead()
  expect(await read).toEqual({ status: 'processing' })
  await expect(admin.mutation(api.payments.cancel, { id: r.id })).rejects.toThrow('cannot be cancelled')
  releaseCapture()
  expect(await capture).toEqual({ status: 'paid' })
})

test('admin connection errors include safe support identifiers without provider body contents', async () => {
  const { admin } = await setup()
  fetchMock.mockResolvedValueOnce(Response.json({ errorCode: 'merchant_channel_setup_error', errorId: 'support123', message: 'SECRET CUSTOMER DATA' }, { status: 403 }))
  let error: any
  try { await admin.action(api.afterpay.checkConnection, {}) } catch (e) { error = e }
  expect(error.data).toContain('HTTP 403 (merchant_channel_setup_error)')
  expect(error.data).toContain('support123')
  expect(error.data).not.toContain('SECRET CUSTOMER DATA')
})
