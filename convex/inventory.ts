import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { getAdminUserId, requireAdmin } from './lib/requireAdmin'

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
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return ctx.storage.generateUploadUrl()
  }
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    if (!await getAdminUserId(ctx)) return []
    const rows = await ctx.db.query('inventoryVehicles').order('desc').collect()
    return Promise.all(rows.map((row) => withUrls(ctx, row)))
  }
})

export const publicList = query({
  args: { showSold: v.optional(v.boolean()) },
  handler: async (ctx, { showSold }) => {
    const rows = await ctx.db.query('inventoryVehicles').collect()
    const publicRows = rows
      .filter((row) => row.status !== 'archived')
      .filter((row) => showSold || row.status !== 'sold')
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return Promise.all(publicRows.map((row) => withUrls(ctx, row)))
  }
})

export const save = mutation({
  args: {
    id: v.optional(v.id('inventoryVehicles')),
    year: v.string(),
    make: v.string(),
    model: v.string(),
    price: v.optional(v.string()),
    mileage: v.optional(v.string()),
    color: v.optional(v.string()),
    bodyType: v.optional(v.string()),
    transmission: v.optional(v.string()),
    vin: v.optional(v.string()),
    titleStatus: v.string(),
    status: v.string(),
    description: v.optional(v.string()),
    featured: v.boolean(),
    sortOrder: v.number(),
    photos: v.array(photoArg)
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const now = Date.now()
    const payload = { ...args, status: args.status as any, updatedAt: now }
    if (args.id) {
      const { id, ...patch } = payload
      await ctx.db.patch(args.id, patch)
      return args.id
    }
    const { id, ...insert } = payload
    return ctx.db.insert('inventoryVehicles', { ...insert, createdAt: now })
  }
})

export const archive = mutation({
  args: { id: v.id('inventoryVehicles') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    return ctx.db.patch(id, { status: 'archived', updatedAt: Date.now() })
  }
})

async function deleteVehicle(ctx: any, id: any) {
  const vehicle = await ctx.db.get(id)
  if (!vehicle) return false

  for (const photo of vehicle.photos || []) {
    try {
      await ctx.storage.delete(photo.storageId)
    } catch {
      // If a file was already removed, still delete the vehicle record.
    }
  }

  const photoRows = await ctx.db
    .query('inventoryPhotos')
    .withIndex('by_vehicle', (q: any) => q.eq('vehicleId', id))
    .collect()
  for (const photoRow of photoRows) {
    await ctx.db.delete(photoRow._id)
  }

  await ctx.db.delete(id)
  return true
}

export const remove = mutation({
  args: { id: v.id('inventoryVehicles') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    return deleteVehicle(ctx, id)
  }
})

export const removeMany = mutation({
  args: { ids: v.array(v.id('inventoryVehicles')) },
  handler: async (ctx, { ids }) => {
    await requireAdmin(ctx)
    let deleted = 0
    for (const id of ids) {
      if (await deleteVehicle(ctx, id)) deleted += 1
    }
    return { deleted }
  }
})
