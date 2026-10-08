import { action, internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { getAdminUserId, requireAdmin } from './lib/requireAdmin'

const photoArg = v.object({
  storageId: v.id('_storage'),
  thumbnailStorageId: v.optional(v.id('_storage')),
  name: v.optional(v.string()),
  order: v.optional(v.number())
})

const leadDetailsArgs = {
  name: v.string(),
  phone: v.string(),
  email: v.string(),
  preferredContactMethod: v.string(),
  vehicleYear: v.optional(v.string()),
  vehicleMake: v.optional(v.string()),
  vehicleModel: v.optional(v.string()),
  vin: v.optional(v.string()),
  mileage: v.optional(v.string()),
  damageArea: v.string(),
  damageType: v.string(),
  severity: v.string(),
  description: v.string(),
  rentalVehicleInterest: v.optional(v.boolean()),
  towAssistanceInterest: v.optional(v.boolean())
}

const createLeadArgs = {
  ...leadDetailsArgs,
  photos: v.array(photoArg)
}

function validateLeadDetails(args: any) {
  const requiredFields = [
    ['name', 120],
    ['phone', 40],
    ['email', 254],
    ['preferredContactMethod', 20],
    ['damageArea', 120],
    ['damageType', 120],
    ['severity', 40],
    ['description', 5000]
  ] as const
  const optionalFields = [
    ['vehicleYear', 10],
    ['vehicleMake', 80],
    ['vehicleModel', 80],
    ['vin', 40],
    ['mileage', 40]
  ] as const

  for (const [field, maxLength] of requiredFields) {
    const value = String(args[field] || '').trim()
    if (!value || value.length > maxLength) throw new Error('Invalid estimate request.')
  }
  for (const [field, maxLength] of optionalFields) {
    if (String(args[field] || '').trim().length > maxLength) throw new Error('Invalid estimate request.')
  }
  if (!/^\S+@\S+\.\S+$/.test(args.email)) {
    throw new Error('Invalid estimate request.')
  }
}

function validatePhotos(photos: any[]) {
  if (photos.length < 1 || photos.length > 8) throw new Error('Please upload between one and eight photos.')
}

function validateSubmissionKey(submissionKey: string) {
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(submissionKey)) throw new Error('Invalid submission key.')
}

function notesForLead(args: any, now: number) {
  return [
    args.rentalVehicleInterest
      ? { body: 'Customer is interested in rental assistance. Car Craft can help arrange a rental around their repair and vehicle drop-off.', createdAt: now }
      : null,
    args.towAssistanceInterest
      ? { body: 'Customer needs tow assistance for their vehicle.', createdAt: now }
      : null
  ].filter(Boolean) as { body: string; createdAt: number }[]
}

async function upsertCustomer(ctx: any, lead: any, id: any, now: number) {
  const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ')
  const existingCustomers = await ctx.db.query('customers').collect()
  const existing = existingCustomers.find((customer: any) =>
    (lead.phone && customer.phone === lead.phone) ||
    (lead.email && customer.email === lead.email) ||
    (customer.name.toLowerCase() === lead.name.toLowerCase() && customer.vehicle?.toLowerCase() === vehicle.toLowerCase())
  )
  const customerPatch = {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    vehicleYear: lead.vehicleYear,
    vehicleMake: lead.vehicleMake,
    vehicleModel: lead.vehicleModel,
    vehicle,
    vin: lead.vin,
    mileage: lead.mileage,
    source: 'estimate_lead',
    updatedAt: now
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...customerPatch,
      leadIds: existing.leadIds.includes(id) ? existing.leadIds : [...existing.leadIds, id]
    })
  } else {
    await ctx.db.insert('customers', {
      ...customerPatch,
      leadIds: [id],
      appointmentIds: [],
      createdAt: now
    })
  }
}

async function withUrls(ctx: any, row: any) {
  return {
    ...row,
    photos: await Promise.all((row.photos || []).map(async (photo: any) => ({
      ...photo,
      url: await ctx.storage.getUrl(photo.storageId),
      thumbnailUrl: await ctx.storage.getUrl(photo.thumbnailStorageId || photo.storageId)
    })))
  }
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl()
})

export const startSubmission = mutation({
  args: { ...leadDetailsArgs, submissionKey: v.string() },
  handler: async (ctx, args) => {
    validateLeadDetails(args)
    validateSubmissionKey(args.submissionKey)
    const existing = await ctx.db
      .query('estimateLeads')
      .withIndex('by_submission_key', (q) => q.eq('submissionKey', args.submissionKey))
      .unique()
    if (existing) return { leadId: existing._id, submissionState: existing.submissionState || 'submitted' }

    const now = Date.now()
    const vehicle = [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')
    const id = await ctx.db.insert('estimateLeads', {
      ...args,
      vehicle,
      status: 'new',
      photos: [],
      notes: notesForLead(args, now),
      archived: false,
      submissionState: 'pending_upload',
      notificationStatus: 'pending',
      notificationAttempts: 0,
      createdAt: now,
      updatedAt: now
    })
    await ctx.db.insert('estimateLeadEvents', { leadId: id, eventType: 'lead_saved', createdAt: now })
    return { leadId: id, submissionState: 'pending_upload' as const }
  }
})

export const generateSubmissionUploadUrl = mutation({
  args: { leadId: v.id('estimateLeads'), submissionKey: v.string() },
  handler: async (ctx, args) => {
    validateSubmissionKey(args.submissionKey)
    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.submissionKey !== args.submissionKey || lead.submissionState !== 'pending_upload') {
      throw new Error('Estimate submission is not available for uploads.')
    }
    if (lead.photos.length >= 8) throw new Error('A maximum of eight photos is allowed.')
    return ctx.storage.generateUploadUrl()
  }
})

export const attachSubmissionPhoto = mutation({
  args: { leadId: v.id('estimateLeads'), submissionKey: v.string(), photo: photoArg },
  handler: async (ctx, args) => {
    validateSubmissionKey(args.submissionKey)
    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.submissionKey !== args.submissionKey || lead.submissionState !== 'pending_upload') {
      throw new Error('Estimate submission is not available for uploads.')
    }
    if (lead.photos.some((photo) => photo.storageId === args.photo.storageId)) return { attached: true }
    if (lead.photos.length >= 8) throw new Error('A maximum of eight photos is allowed.')
    const now = Date.now()
    await ctx.db.patch(args.leadId, { photos: [...lead.photos, args.photo], updatedAt: now })
    await ctx.db.insert('uploadedPhotos', {
      storageId: args.photo.storageId,
      ownerType: 'estimateLead',
      ownerId: args.leadId,
      name: args.photo.name,
      createdAt: now
    })
    await ctx.db.insert('estimateLeadEvents', {
      leadId: args.leadId,
      eventType: 'photo_attached',
      detail: args.photo.name,
      createdAt: now
    })
    return { attached: true }
  }
})

export const finalizeSubmission = mutation({
  args: { leadId: v.id('estimateLeads'), submissionKey: v.string() },
  handler: async (ctx, args) => {
    validateSubmissionKey(args.submissionKey)
    const lead = await ctx.db.get(args.leadId)
    if (!lead || lead.submissionKey !== args.submissionKey) throw new Error('Estimate submission was not found.')
    if (lead.submissionState === 'submitted') {
      return { leadId: args.leadId, notificationStatus: lead.notificationStatus || 'pending' }
    }
    validatePhotos(lead.photos)
    const now = Date.now()
    await ctx.db.patch(args.leadId, {
      submissionState: 'submitted',
      submittedAt: now,
      notificationStatus: 'pending',
      updatedAt: now
    })
    await upsertCustomer(ctx, lead, args.leadId, now)
    await ctx.db.insert('estimateLeadEvents', { leadId: args.leadId, eventType: 'submitted', createdAt: now })
    await ctx.scheduler.runAfter(0, internal.estimateLeads.deliverNotification, { id: args.leadId })
    return { leadId: args.leadId, notificationStatus: 'pending' as const }
  }
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!await getAdminUserId(ctx)) return []
    const rows = await ctx.db.query('estimateLeads').order('desc').collect()
    return Promise.all(rows.map((row) => withUrls(ctx, row)))
  }
})

// Lists never resolve storage URLs or send private submission keys to the UI.
export const listSummaries = query({
  args: { archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!await getAdminUserId(ctx)) return []
    const rows = await ctx.db.query('estimateLeads')
      .withIndex('by_archived', (q) => q.eq('archived', args.archived ?? false))
      .order('desc').collect()
    return rows.filter((row) => args.archived || !row.deletedAt).map((row) => {
      const { photos, notes, submissionKey, ...summary } = row
      return { ...summary, photoCount: photos.length }
    })
  }
})

export const getPhotos = query({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const lead = await ctx.db.get(args.id)
    if (!lead || lead.deletedAt) return []
    return (await withUrls(ctx, lead)).photos
  }
})

export const getDetails = query({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const lead = await ctx.db.get(args.id)
    if (!lead || lead.deletedAt) return null
    const { submissionKey, ...details } = await withUrls(ctx, lead)
    return details
  }
})

export const restoreLead = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const now = Date.now()
    await ctx.db.patch(id, { status: 'new', archived: false, deletedAt: undefined, updatedAt: now })
    await ctx.db.insert('estimateLeadEvents', { leadId: id, eventType: 'restored', createdAt: now })
  }
})

export const create = internalMutation({
  args: createLeadArgs,
  handler: async (ctx, args) => {
    const now = Date.now()
    const vehicle = [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')
    const id = await ctx.db.insert('estimateLeads', {
      ...args,
      vehicle,
      status: 'new',
      notes: notesForLead(args, now),
      archived: false,
      submissionState: 'submitted',
      notificationStatus: 'pending',
      notificationAttempts: 0,
      submittedAt: now,
      createdAt: now,
      updatedAt: now
    })
    for (const photo of args.photos) {
      await ctx.db.insert('uploadedPhotos', {
        storageId: photo.storageId,
        ownerType: 'estimateLead',
        ownerId: id,
        name: photo.name,
        createdAt: now
      })
    }
    await upsertCustomer(ctx, args, id, now)
    await ctx.db.insert('estimateLeadEvents', { leadId: id, eventType: 'submitted', createdAt: now })
    return id
  }
})

export const createWithNotification = action({
  args: createLeadArgs,
  handler: async (ctx, args) => {
    validateLeadDetails(args)
    validatePhotos(args.photos)
    const id = await ctx.runMutation(internal.estimateLeads.create, args)
    const vehicle = [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')

    const notification = await ctx.runAction(internal.notifications.sendEstimateLead, {
      leadId: String(id),
      name: args.name,
      phone: args.phone,
      email: args.email,
      vehicle,
      damageArea: args.damageArea,
      severity: args.severity,
      rentalVehicleInterest: args.rentalVehicleInterest,
      towAssistanceInterest: args.towAssistanceInterest
    })

    await ctx.runMutation(internal.estimateLeads.recordNotificationResult, {
      id,
      sent: notification.sent,
      reason: notification.sent ? undefined : notification.reason
    })
    return { leadId: id, notificationSent: notification.sent }
  }
})

export const getForNotification = internalQuery({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, args) => ctx.db.get(args.id)
})

export const recordNotificationResult = internalMutation({
  args: { id: v.id('estimateLeads'), sent: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.id)
    if (!lead) return
    const now = Date.now()
    const attempts = (lead.notificationAttempts || 0) + 1
    const retry = !args.sent && attempts < 4
    await ctx.db.patch(args.id, {
      notificationStatus: args.sent ? 'sent' : retry ? 'pending' : 'failed',
      notificationAttempts: attempts,
      notificationLastError: args.sent ? undefined : (args.reason || 'unknown_error'),
      notificationSentAt: args.sent ? now : undefined,
      updatedAt: now
    })
    await ctx.db.insert('estimateLeadEvents', {
      leadId: args.id,
      eventType: args.sent ? 'notification_sent' : 'notification_failed',
      detail: args.sent ? undefined : (args.reason || 'unknown_error'),
      createdAt: now
    })
    if (retry) {
      const delays = [60_000, 5 * 60_000, 30 * 60_000]
      await ctx.scheduler.runAfter(delays[Math.min(attempts - 1, delays.length - 1)], internal.estimateLeads.deliverNotification, { id: args.id })
    }
  }
})

export const deliverNotification = internalAction({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, args) => {
    const lead = await ctx.runQuery(internal.estimateLeads.getForNotification, args)
    if (!lead || lead.notificationStatus === 'sent' || lead.submissionState !== 'submitted') return
    const notification = await ctx.runAction(internal.notifications.sendEstimateLead, {
      leadId: String(args.id),
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      vehicle: lead.vehicle,
      damageArea: lead.damageArea,
      severity: lead.severity,
      rentalVehicleInterest: lead.rentalVehicleInterest,
      towAssistanceInterest: lead.towAssistanceInterest
    })
    await ctx.runMutation(internal.estimateLeads.recordNotificationResult, {
      id: args.id,
      sent: notification.sent,
      reason: notification.sent ? undefined : notification.reason
    })
  }
})

export const updateStatus = mutation({
  args: { id: v.id('estimateLeads'), status: v.string() },
  handler: async (ctx, { id, status }) => {
    await requireAdmin(ctx)
    await ctx.db.patch(id, { status: status as any, archived: status === 'archived', updatedAt: Date.now() })
  }
})

export const addNote = mutation({
  args: { id: v.id('estimateLeads'), body: v.string() },
  handler: async (ctx, { id, body }) => {
    await requireAdmin(ctx)
    const lead = await ctx.db.get(id)
    if (!lead) throw new Error('Lead not found')
    await ctx.db.patch(id, {
      notes: [...lead.notes, { body, createdAt: Date.now() }],
      updatedAt: Date.now()
    })
  }
})

export const archiveLead = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const now = Date.now()
    await ctx.db.patch(id, { status: 'archived', archived: true, updatedAt: now })
    await ctx.db.insert('estimateLeadEvents', { leadId: id, eventType: 'archived', createdAt: now })
  }
})

export const deleteLead = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const lead = await ctx.db.get(id)
    if (!lead) return
    const now = Date.now()
    await ctx.db.patch(id, { status: 'archived', archived: true, deletedAt: now, updatedAt: now })
    await ctx.db.insert('estimateLeadEvents', {
      leadId: id,
      eventType: 'archived',
      detail: 'Moved to recoverable deletion by an administrator.',
      createdAt: now
    })
  }
})
