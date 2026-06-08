import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const photoArg = v.object({
  storageId: v.id('_storage'),
  name: v.optional(v.string()),
  order: v.optional(v.number())
})

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
    const rows = await ctx.db.query('estimateLeads').order('desc').collect()
    return Promise.all(rows.map((row) => withUrls(ctx, row)))
  }
})

export const create = mutation({
  args: {
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
    photos: v.array(photoArg)
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const vehicle = [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')
    const id = await ctx.db.insert('estimateLeads', {
      ...args,
      vehicle,
      status: 'new',
      notes: [],
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

export const updateStatus = mutation({
  args: { id: v.id('estimateLeads'), status: v.string() },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status: status as any, archived: status === 'archived', updatedAt: Date.now() })
  }
})

export const addNote = mutation({
  args: { id: v.id('estimateLeads'), body: v.string() },
  handler: async (ctx, { id, body }) => {
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
    await ctx.db.patch(id, { status: 'archived', archived: true, updatedAt: Date.now() })
  }
})

export const deleteLead = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
  }
})
