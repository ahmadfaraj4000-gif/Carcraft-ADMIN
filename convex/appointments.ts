import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

async function upsertCustomer(ctx: any, args: any, appointmentId: any, source = 'appointment') {
  const now = Date.now()
  const vehicle = args.vehicle || [args.vehicleYear, args.vehicleMake, args.vehicleModel].filter(Boolean).join(' ')
  const customers = await ctx.db.query('customers').collect()
  const existing = customers.find((customer: any) =>
    (args.phone && customer.phone === args.phone) ||
    (args.email && customer.email === args.email) ||
    (customer.name.toLowerCase() === args.name.toLowerCase() && customer.vehicle?.toLowerCase() === vehicle.toLowerCase())
  )
  const patch = {
    name: args.name,
    phone: args.phone,
    email: args.email,
    vehicleYear: args.vehicleYear,
    vehicleMake: args.vehicleMake,
    vehicleModel: args.vehicleModel,
    vehicle,
    vin: args.vin,
    mileage: args.mileage,
    source,
    updatedAt: now
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...patch,
      appointmentIds: existing.appointmentIds.includes(appointmentId) ? existing.appointmentIds : [...existing.appointmentIds, appointmentId]
    })
    return existing._id
  }
  return ctx.db.insert('customers', {
    ...patch,
    leadIds: args.leadId ? [args.leadId] : [],
    appointmentIds: [appointmentId],
    createdAt: now
  })
}

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query('appointments').order('desc').collect()
})

export const create = mutation({
  args: {
    leadId: v.optional(v.id('estimateLeads')),
    customerId: v.optional(v.id('customers')),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    vehicleYear: v.optional(v.string()),
    vehicleMake: v.optional(v.string()),
    vehicleModel: v.optional(v.string()),
    vehicle: v.optional(v.string()),
    vin: v.optional(v.string()),
    mileage: v.optional(v.string()),
    serviceRequested: v.string(),
    appointmentDate: v.string(),
    appointmentTime: v.string(),
    photos: v.optional(v.array(v.any())),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const id = await ctx.db.insert('appointments', {
      ...args,
      photos: args.photos || [],
      notes: args.note ? [{ body: args.note, createdAt: now }] : [],
      status: 'new_request',
      createdAt: now,
      updatedAt: now
    })
    const customerId = await upsertCustomer(ctx, args, id)
    await ctx.db.patch(id, { customerId })
    return id
  }
})

export const convertLead = mutation({
  args: {
    leadId: v.id('estimateLeads'),
    appointmentDate: v.string(),
    appointmentTime: v.string()
  },
  handler: async (ctx, { leadId, appointmentDate, appointmentTime }) => {
    const lead = await ctx.db.get(leadId)
    if (!lead) throw new Error('Lead not found')
    const now = Date.now()
    const appointmentId = await ctx.db.insert('appointments', {
      leadId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      vehicleYear: lead.vehicleYear,
      vehicleMake: lead.vehicleMake,
      vehicleModel: lead.vehicleModel,
      vehicle: lead.vehicle,
      vin: lead.vin,
      mileage: lead.mileage,
      serviceRequested: `Photo estimate: ${lead.damageArea} ${lead.damageType}`.trim(),
      appointmentDate,
      appointmentTime,
      status: 'new_request',
      photos: lead.photos,
      notes: [{ body: `Converted from estimate lead. Customer notes: ${lead.description}`, createdAt: now }],
      createdAt: now,
      updatedAt: now
    })
    const customerId = await upsertCustomer(ctx, lead, appointmentId, 'estimate_lead')
    await ctx.db.patch(appointmentId, { customerId })
    await ctx.db.patch(leadId, { status: 'booked', updatedAt: now })
    return appointmentId
  }
})

export const update = mutation({
  args: {
    id: v.id('appointments'),
    status: v.optional(v.string()),
    note: v.optional(v.string()),
    appointmentDate: v.optional(v.string()),
    appointmentTime: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Appointment not found')
    await ctx.db.patch(args.id, {
      status: args.status as any || row.status,
      appointmentDate: args.appointmentDate || row.appointmentDate,
      appointmentTime: args.appointmentTime || row.appointmentTime,
      notes: args.note ? [...row.notes, { body: args.note, createdAt: Date.now() }] : row.notes,
      updatedAt: Date.now()
    })
  }
})
