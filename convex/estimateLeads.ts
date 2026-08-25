import { action, internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { getAdminUserId, requireAdmin } from './lib/requireAdmin'

const photoArg = v.object({
  storageId: v.id('_storage'),
  name: v.optional(v.string()),
  order: v.optional(v.number())
})

const createLeadArgs = {
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
  towAssistanceInterest: v.optional(v.boolean()),
  photos: v.array(photoArg)
}

function validateLeadInput(args: any) {
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
  if (!/^\S+@\S+\.\S+$/.test(args.email) || args.photos.length < 1 || args.photos.length > 8) {
    throw new Error('Invalid estimate request.')
  }
}

async function withUrls(ctx: any, row: any) {
  return {
    ...row,
    photos: await Promise.all((row.photos || []).map(async (photo: any) => ({
      ...photo,
      url: await ctx.storage.getUrl(photo.storageId)
    })))
  }
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl()
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!await getAdminUserId(ctx)) return []
    const rows = await ctx.db.query('estimateLeads').order('desc').collect()
    return Promise.all(rows.map((row) => withUrls(ctx, row)))
  }
})

export const create = internalMutation({
  args: createLeadArgs,
  handler: async (ctx, args) => {
    const now = Date.now()
    const vehicle = [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')
    const notes = [
      args.rentalVehicleInterest
        ? { body: 'Customer is interested in rental assistance. Car Craft can help arrange a rental around their repair and vehicle drop-off.', createdAt: now }
        : null,
      args.towAssistanceInterest
        ? { body: 'Customer needs tow assistance for their vehicle.', createdAt: now }
        : null
    ].filter(Boolean) as { body: string; createdAt: number }[]
    const id = await ctx.db.insert('estimateLeads', {
      ...args,
      vehicle,
      status: 'new',
      notes,
      archived: false,
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
    const existingCustomers = await ctx.db.query('customers').collect()
    const existing = existingCustomers.find((customer) =>
      (args.phone && customer.phone === args.phone) ||
      (args.email && customer.email === args.email) ||
      (customer.name.toLowerCase() === args.name.toLowerCase() && customer.vehicle?.toLowerCase() === vehicle.toLowerCase())
    )
    const customerPatch = {
      name: args.name,
      phone: args.phone,
      email: args.email,
      vehicleYear: args.vehicleYear,
      vehicleMake: args.vehicleMake,
      vehicleModel: args.vehicleModel,
      vehicle,
      vin: args.vin,
      mileage: args.mileage,
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
    return id
  }
})

export const createWithNotification = action({
  args: createLeadArgs,
  handler: async (ctx, args) => {
    validateLeadInput(args)
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

    return { leadId: id, notificationSent: notification.sent }
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
    await ctx.db.patch(id, { status: 'archived', archived: true, updatedAt: Date.now() })
  }
})

export const deleteLead = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    await ctx.db.delete(id)
  }
})
