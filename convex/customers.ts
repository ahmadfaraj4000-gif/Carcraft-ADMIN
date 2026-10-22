import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { getAdminUserId, requireAdmin } from './lib/requireAdmin'

function sameText(a?: string, b?: string) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function hasText(value?: string) {
  return Boolean(String(value || '').trim())
}

function sameCustomerRecord(customer: any, row: any) {
  return (
    (hasText(customer.phone) && sameText(customer.phone, row.phone)) ||
    (hasText(customer.email) && sameText(customer.email, row.email)) ||
    (hasText(customer.vin) && sameText(customer.vin, row.vin)) ||
    (hasText(customer.name) && hasText(customer.vehicle) && sameText(customer.name, row.name) && sameText(customer.vehicle, row.vehicle))
  )
}

async function deleteUploadedPhotoRecords(ctx: any, ownerType: 'estimateLead' | 'appointment', ownerId: string, storageIds: Set<any>) {
  const uploadedPhotos = await ctx.db
    .query('uploadedPhotos')
    .withIndex('by_owner', (q: any) => q.eq('ownerType', ownerType).eq('ownerId', ownerId))
    .collect()

  for (const photo of uploadedPhotos) {
    storageIds.add(photo.storageId)
    await ctx.db.delete(photo._id)
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!await getAdminUserId(ctx)) return []
    return ctx.db.query('customers').order('desc').collect()
  }
})

export const upsertFromContact = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    vehicleYear: v.optional(v.string()),
    vehicleMake: v.optional(v.string()),
    vehicleModel: v.optional(v.string()),
    vehicle: v.optional(v.string()),
    vin: v.optional(v.string()),
    mileage: v.optional(v.string()),
    source: v.string(),
    leadId: v.optional(v.id('estimateLeads')),
    appointmentId: v.optional(v.id('appointments')),
    notes: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const now = Date.now()
    const rows = await ctx.db.query('customers').collect()
    const existing = rows.find((customer) =>
      (args.phone && sameText(customer.phone, args.phone)) ||
      (args.email && sameText(customer.email, args.email)) ||
      (sameText(customer.name, args.name) && sameText(customer.vehicle, args.vehicle))
    )
    const patch = {
      name: args.name,
      phone: args.phone,
      email: args.email,
      address: args.address,
      vehicleYear: args.vehicleYear,
      vehicleMake: args.vehicleMake,
      vehicleModel: args.vehicleModel,
      vehicle: args.vehicle || [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' '),
      vin: args.vin,
      mileage: args.mileage,
      source: args.source,
      notes: args.notes,
      updatedAt: now
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...patch,
        leadIds: args.leadId && !existing.leadIds.includes(args.leadId) ? [...existing.leadIds, args.leadId] : existing.leadIds,
        appointmentIds: args.appointmentId && !existing.appointmentIds.includes(args.appointmentId) ? [...existing.appointmentIds, args.appointmentId] : existing.appointmentIds
      })
      return existing._id
    }
    return ctx.db.insert('customers', {
      ...patch,
      leadIds: args.leadId ? [args.leadId] : [],
      appointmentIds: args.appointmentId ? [args.appointmentId] : [],
      createdAt: now
    })
  }
})

export const remove = mutation({
  args: { id: v.id('customers') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const customer = await ctx.db.get(id)
    if (!customer) return

    const allLeads = await ctx.db.query('estimateLeads').collect()
    const leadIds = new Set(customer.leadIds.map((leadId) => String(leadId)))
    for (const lead of allLeads) {
      if (leadIds.has(String(lead._id)) || sameCustomerRecord(customer, lead)) {
        leadIds.add(String(lead._id))
      }
    }

    const allAppointments = await ctx.db.query('appointments').collect()
    const appointmentIds = new Set(customer.appointmentIds.map((appointmentId) => String(appointmentId)))
    for (const appointment of allAppointments) {
      if (
        appointmentIds.has(String(appointment._id)) ||
        String(appointment.customerId || '') === String(id) ||
        (appointment.leadId && leadIds.has(String(appointment.leadId))) ||
        sameCustomerRecord(customer, appointment)
      ) {
        appointmentIds.add(String(appointment._id))
      }
    }

    const storageIds = new Set<any>()
    for (const lead of allLeads) {
      if (!leadIds.has(String(lead._id))) continue
      for (const photo of lead.photos || []) storageIds.add(photo.storageId)
      await deleteUploadedPhotoRecords(ctx, 'estimateLead', String(lead._id), storageIds)
      await ctx.db.delete(lead._id)
    }

    for (const appointment of allAppointments) {
      if (!appointmentIds.has(String(appointment._id))) continue
      for (const photo of appointment.photos || []) storageIds.add(photo.storageId)
      await deleteUploadedPhotoRecords(ctx, 'appointment', String(appointment._id), storageIds)
      await ctx.db.delete(appointment._id)
    }

    for (const storageId of storageIds) {
      await ctx.storage.delete(storageId)
    }

    await ctx.db.delete(id)
  }
})
