import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

function sameText(a?: string, b?: string) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query('customers').order('desc').collect()
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
  handler: async (ctx, { id }) => ctx.db.delete(id)
})
