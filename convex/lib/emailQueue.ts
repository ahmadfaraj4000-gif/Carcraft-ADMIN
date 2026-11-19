import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { estimateEmail } from '../../shared/estimateEmail'

type Recipient = Pick<Doc<'estimateLeads'>, '_id' | 'email' | 'name' | 'vehicle'>
export function emailEnabled(email: string) {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL &&
    (process.env.BREVO_ENABLED === 'true' || email.toLowerCase() === process.env.BREVO_TEST_INBOX?.toLowerCase()))
}

export async function enqueue(ctx: MutationCtx, lead: Recipient, kind: 'thanks' | 'estimate', key: string, message: ReturnType<typeof estimateEmail>) {
  const existing = await ctx.db.query('emailDeliveries').withIndex('by_key', q => q.eq('key', key)).unique()
  if (existing) return false
  const id = await ctx.db.insert('emailDeliveries', { leadId: lead._id, kind, key, email: lead.email, name: lead.name,
    ...message, status: 'pending', attempts: 0, nextAttemptAt: Date.now() })
  await ctx.scheduler.runAfter(0, internal.estimateEmails.deliver, { id })
  return true
}

export async function queueThanks(ctx: MutationCtx, lead: Recipient) {
  if (emailEnabled(lead.email)) await enqueue(ctx, lead, 'thanks', 'thanks:' + lead._id,
    estimateEmail({ kind: 'thanks', name: lead.name, vehicle: lead.vehicle }))
}
