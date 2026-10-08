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
test('invalid submission keys and empty submissions cannot be finalized', async () => {
  const { t } = await setup()
  const { leadId } = await t.mutation(api.estimateLeads.startSubmission, { ...details, submissionKey: 'test-validation-123456' })
  await expect(t.mutation(api.estimateLeads.finalizeSubmission, { leadId, submissionKey: 'different-key-123456' })).rejects.toThrow('not found')
  await expect(t.mutation(api.estimateLeads.finalizeSubmission, { leadId, submissionKey: 'test-validation-123456' })).rejects.toThrow('between one and eight')
})
