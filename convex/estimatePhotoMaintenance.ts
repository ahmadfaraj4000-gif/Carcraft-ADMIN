import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'

// CLI-only backfill: never exposes customer photos through a public endpoint.
export const batch = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query('estimateLeads').paginate(paginationOpts)
    const photos = []
    for (const lead of result.page) {
      for (const photo of lead.photos) {
        if (photo.thumbnailStorageId) continue
        photos.push({ leadId: lead._id, storageId: photo.storageId, url: await ctx.storage.getUrl(photo.storageId) })
      }
    }
    return { photos, isDone: result.isDone, continueCursor: result.continueCursor }
  }
})

export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl()
})

export const attach = internalMutation({
  args: { leadId: v.id('estimateLeads'), storageId: v.id('_storage'), thumbnailStorageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId)
    const thumbnail = await ctx.db.system.get(args.thumbnailStorageId)
    if (!thumbnail || !thumbnail.contentType?.startsWith('image/')) throw new Error('Invalid thumbnail')
    if (!lead || !lead.photos.some((photo) => photo.storageId === args.storageId && !photo.thumbnailStorageId)) {
      await ctx.storage.delete(args.thumbnailStorageId)
      return false
    }
    await ctx.db.patch(lead._id, {
      photos: lead.photos.map((photo) => photo.storageId === args.storageId
        ? { ...photo, thumbnailStorageId: args.thumbnailStorageId } : photo)
    })
    return true
  }
})
