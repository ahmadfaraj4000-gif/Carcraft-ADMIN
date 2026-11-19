import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'
const modules = import.meta.glob('../convex/**/*.{ts,js}')
const details = { name: 'TEST LEAD', phone: '202-555-0100', email: 'test@example.com', preferredContactMethod: 'email', vehicleYear: '2020', vehicleMake: 'Test', vehicleModel: 'Vehicle', damageArea: 'Bumper', damageType: 'Scratch', severity: 'minor', description: 'Automated test' }
beforeEach(() => { vi.stubEnv('ADMIN_USERNAME', 'admin@example.com'); vi.useFakeTimers() })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
async function setup() {
  const t = convexTest(schema, modules)
  const user = await t.run((ctx) => ctx.db.insert('users', { email: 'admin@example.com' }))
  const admin = t.withIdentity({ subject: `${user}|session` })
  return { t, admin }
}
test('photo submission retries are idempotent, keep originals and previews, and create one customer', async () => {
  const { t, admin } = await setup()
  const submissionKey = 'test-submission-123456'
  const saved = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey })
  const retry = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey })
  expect(retry.leadId).toBe(saved.leadId)
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['original'], { type: 'image/jpeg' })))
  const thumbnailStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['preview'], { type: 'image/webp' })))
  const photo = { storageId, thumbnailStorageId, name: 'damage.jpg', order: 0 }
  const submission = { leadId: saved.leadId, submissionKey }
  await t.mutation(api.estimateLeads.attachSubmissionPhoto, { ...submission, photo })
  await t.mutation(api.estimateLeads.attachSubmissionPhoto, { ...submission, photo })
  await t.mutation(api.estimateLeads.finalizeSubmission, submission)
  await t.mutation(api.estimateLeads.finalizeSubmission, submission)
  const lead = await admin.query(api.estimateLeads.getDetails, { id: saved.leadId })
  expect(lead.submissionState).toBe('submitted')
  expect(lead.photos).toHaveLength(1)
  expect(lead.photos[0].url).not.toBe(lead.photos[0].thumbnailUrl)
  expect(lead.submissionKey).toBeUndefined()
  expect(await t.run((ctx) => ctx.db.query('customers').collect())).toHaveLength(1)
  expect((await t.run((ctx) => ctx.db.query('estimateLeadEvents').collect())).filter((event) => event.eventType === 'submitted')).toHaveLength(1)
  await t.mutation(internal.estimateLeads.recordNotificationResult, { id: saved.leadId, sent: true })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
})
test('archive is excluded from active summaries, supports restore, and protects photo access', async () => {
  const { t, admin } = await setup()
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey: 'test-archive-1234567' })
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' })))
  await t.mutation(api.estimateLeads.attachSubmissionPhoto, { leadId, submissionKey: 'test-archive-1234567', photo: { storageId } })
  const [summary] = await admin.query(api.estimateLeads.listSummaries, {})
  expect(summary.photoCount).toBe(1)
  expect(summary.photos).toBeUndefined()
  expect(summary.submissionKey).toBeUndefined()
  const [legacyPhoto] = await admin.query(api.estimateLeads.getPhotos, { id: leadId })
  expect(legacyPhoto.thumbnailUrl).toBe(legacyPhoto.url)
  await admin.mutation(api.estimateLeads.archiveLead, { id: leadId })
  expect(await admin.query(api.estimateLeads.listSummaries, {})).toHaveLength(0)
  expect(await admin.query(api.estimateLeads.listSummaries, { archived: true })).toHaveLength(1)
  expect(await t.query(api.estimateLeads.listSummaries, { archived: true })).toEqual([])
  await expect(t.query(api.estimateLeads.getPhotos, { id: leadId })).rejects.toThrow('Admin authentication required')
  await expect(t.mutation(api.estimateLeads.restoreLead, { id: leadId })).rejects.toThrow('Admin authentication required')
  await admin.mutation(api.estimateLeads.restoreLead, { id: leadId })
  expect(await admin.query(api.estimateLeads.listSummaries, {})).toHaveLength(1)
  await admin.mutation(api.estimateLeads.deleteLead, { id: leadId })
  expect((await admin.query(api.estimateLeads.listSummaries, { archived: true }))[0].deletedAt).toBeDefined()
  await admin.mutation(api.estimateLeads.restoreLead, { id: leadId })
  expect(await admin.query(api.estimateLeads.listSummaries, {})).toHaveLength(1)
})
test('zero photos are supported and the correct submission key is required', async () => {
  const { t } = await setup()
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey: 'test-validation-123456' })
  await expect(t.mutation(api.estimateLeads.finalizeSubmission, { leadId, submissionKey: 'different-key-123456' })).rejects.toThrow('not found')
  await t.mutation(api.estimateLeads.finalizeSubmission, { leadId, submissionKey: 'test-validation-123456' })
})

test('quotes persist with photos, admin attribution, revisions, and archive/restore', async () => {
  const { t, admin } = await setup()
  const submissionKey = 'test-quote-123456789'
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey })
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['damage'], { type: 'image/jpeg' })))
  await t.mutation(api.estimateLeads.attachSubmissionPhoto, { leadId, submissionKey, photo: { storageId } })
  const quote = await admin.mutation(api.estimateLeads.saveQuote, { id: leadId, minAmountCents: 150050, maxAmountCents: 200000 })
  expect(quote).toMatchObject({ minAmountCents: 150050, maxAmountCents: 200000, currency: 'USD', updatedAt: expect.any(Number), updatedBy: expect.any(String) })
  expect((await admin.query(api.estimateLeads.listSummaries, {}))[0].quote).toEqual(quote)
  await admin.mutation(api.estimateLeads.archiveLead, { id: leadId })
  await admin.mutation(api.estimateLeads.saveQuote, { id: leadId, minAmountCents: 175025 })
  await admin.mutation(api.estimateLeads.restoreLead, { id: leadId })
  const lead = await admin.query(api.estimateLeads.getDetails, { id: leadId })
  expect(lead.quote.minAmountCents).toBe(175025)
  expect(lead.quote.maxAmountCents).toBeUndefined()
  expect(lead.photos[0].storageId).toBe(storageId)
  expect(lead.description).toBe(details.description)
  const revisions = await t.run((ctx) => ctx.db.query('estimateLeadEvents').withIndex('by_lead', (q) => q.eq('leadId', leadId)).collect())
  expect(revisions.filter((event) => event.eventType === 'quote_saved').map((event) => event.quote.minAmountCents)).toEqual([150050, 175025])
})

test('only admins can save quotes, and recovery leads must be restored first', async () => {
  const { t, admin } = await setup()
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey: 'quote-auth-123456789' })
  const args = { id: leadId, minAmountCents: 10000 }
  await expect(t.mutation(api.estimateLeads.saveQuote, args)).rejects.toThrow('Admin authentication required')
  const other = await t.run((ctx) => ctx.db.insert('users', { email: 'customer@example.com' }))
  await expect(t.withIdentity({ subject: `${other}|session` }).mutation(api.estimateLeads.saveQuote, args)).rejects.toThrow('Admin authentication required')
  await admin.mutation(api.estimateLeads.deleteLead, { id: leadId })
  await expect(admin.mutation(api.estimateLeads.saveQuote, args)).rejects.toThrow('Restore it')
})

test('invalid amounts and reversed ranges cannot overwrite a saved quote', async () => {
  const { t, admin } = await setup()
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey: 'quote-validation-12345' })
  await admin.mutation(api.estimateLeads.saveQuote, { id: leadId, minAmountCents: 0 })
  for (const amounts of [
    { minAmountCents: -1 }, { minAmountCents: 1.5 }, { minAmountCents: NaN },
    { minAmountCents: Infinity }, { minAmountCents: Number.MAX_SAFE_INTEGER + 1 },
    { minAmountCents: 500, maxAmountCents: 499 }, { minAmountCents: 0, maxAmountCents: -1 },
    { minAmountCents: 0, maxAmountCents: 10.5 }
  ]) {
    await expect(admin.mutation(api.estimateLeads.saveQuote, { id: leadId, ...amounts })).rejects.toThrow()
  }
  expect((await admin.query(api.estimateLeads.getDetails, { id: leadId })).quote.minAmountCents).toBe(0)
})

function enableTestEmail() {
  vi.stubEnv('BREVO_TEST_INBOX', details.email)
  vi.stubEnv('BREVO_API_KEY', 'test')
  vi.stubEnv('BREVO_SENDER_EMAIL', 'shop@example.com')
}
test('one receipt per finalized request and one immutable message per admin send', async () => {
  enableTestEmail()
  const { t, admin } = await setup()
  const submissionKey = 'receipt-test-1234567'
  const {leadId} = await t.mutation(api.estimateLeads.startSubmission, {...details, submissionKey})
  const history = () => admin.query(api.estimateEmails.history, {id:leadId})
  expect((await history()).rows).toHaveLength(0)
  await t.mutation(api.estimateLeads.finalizeSubmission, {leadId, submissionKey})
  await t.mutation(api.estimateLeads.finalizeSubmission, {leadId, submissionKey})
  expect((await history()).rows).toHaveLength(1)
  const quote = {id:leadId,minAmountCents:45000,maxAmountCents:55000}
  await admin.mutation(api.estimateLeads.saveQuote, quote)
  expect((await history()).rows).toHaveLength(1)
  const email = {key:'repair-estimate-test-123',recipient:details.email,id:leadId,details:'Repair <bumper>.'}
  await expect(t.mutation(api.estimateEmails.send,email)).rejects.toThrow('Admin')
  await admin.mutation(api.estimateEmails.send,email)
  await admin.mutation(api.estimateEmails.send,email)
  await admin.mutation(api.estimateLeads.saveQuote,{id:leadId,minAmountCents:70000})
  expect((await history()).rows).toHaveLength(2)
  const row = await t.run(ctx => ctx.db.query('emailDeliveries').filter(q=>q.eq(q.field('kind'),'estimate')).unique())
  expect(row?.htmlContent).toContain('Repair &lt;bumper&gt;.')
  expect(row?.textContent).not.toContain('$450.00')
  expect(row?.textContent).not.toContain('Estimated repair cost:')
})
test.each([[201,'sent'],[429,'pending'],[503,'review'],[400,'failed']])('records provider response %s as %s', async (code,status) => {
  enableTestEmail()
  const {t} = await setup()
  await t.mutation(internal.estimateLeads.create,{...details,photos:[]})
  const row = await t.run(ctx => ctx.db.query('emailDeliveries').unique())
  const provider = vi.spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(Response.json({plan:[{type:'free',credits:300}]}))
    .mockResolvedValueOnce(Response.json({messageId:'sample'}, {status:Number(code)}))
  try {
    await t.action(internal.estimateEmails.deliver,{id:row!._id})
    expect((await t.run(ctx => ctx.db.get(row!._id)))?.status).toBe(status)
    expect(provider).toHaveBeenCalledTimes(2)
  } finally { provider.mockRestore() }
})
