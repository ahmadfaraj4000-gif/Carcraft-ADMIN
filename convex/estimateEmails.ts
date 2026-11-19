import { action, internalQuery, internalMutation, internalAction, query, mutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { requireAdmin } from './lib/requireAdmin'
import { enqueue, emailEnabled } from './lib/emailQueue'
import { estimateEmail, shop, inbox } from '../shared/estimateEmail'

import { validatePdf, attachedEstimateMessage } from '../shared/estimateAttachment'
import type { Doc, Id } from './_generated/dataModel'

export const history = query({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const lead = await ctx.db.get(id)
    const rows = await ctx.db.query('emailDeliveries').withIndex('by_lead', q => q.eq('leadId', id)).order('desc').collect()
    return { enabled: !!lead && emailEnabled(lead.email), rows: rows.map(({_id, _creationTime, status, email, subject, textContent, errorCode, kind, delivery, deliveryAt, attachment}) => ({_id, _creationTime, status, email, subject, textContent, errorCode, kind, delivery, deliveryAt, attachmentName:attachment?.name})) }
  }
})
const sendArgs = { id: v.id('estimateLeads'), recipient: v.string(), details: v.string(), key: v.string() }
type SendArgs = {id: Id<'estimateLeads'>, recipient: string, details: string, key: string}

async function queueEstimate(ctx: MutationCtx, {id, recipient, details, key}: SendArgs, attachment?: Doc<'emailDeliveries'>['attachment']) {
  await requireAdmin(ctx)
  const lead = await ctx.db.get(id)
  if (!lead || lead.deletedAt || lead.archived || lead.submissionState === 'pending_upload') throw new Error('Open a completed active request.')
  if (recipient !== lead.email || !emailEnabled(recipient)) throw new Error('Check the recipient and email configuration.')
  const body = details.trim() || (attachment ? attachedEstimateMessage : '')
  if (!body || body.length > 10000 || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new Error('Enter the customer estimate.')
  return enqueue(ctx, lead, 'estimate', id + ':' + key, estimateEmail({kind:'estimate', name:lead.name, vehicle:lead.vehicle, details:body}), attachment)
}

export const send = mutation({ args: sendArgs, handler: (ctx, args) => queueEstimate(ctx, args) })

export const authorizeAttachment = internalQuery({args:{}, handler: ctx => requireAdmin(ctx)})
export const queuePdf = internalMutation({
  args: {...sendArgs, storageId:v.id('_storage'), name:v.string()},
  handler: (ctx, {storageId,name,...args}) => queueEstimate(ctx, args, {storageId,name})
})

export const discardUnusedPdf = internalMutation({
  args:{storageId:v.id('_storage'), key:v.string()},
  handler: async (ctx, {storageId,key}) => {
    const row = await ctx.db.query('emailDeliveries').withIndex('by_key', q => q.eq('key',key)).unique()
    if (row?.attachment?.storageId !== storageId) await ctx.storage.delete(storageId)
  }
})

export const sendWithPdf = action({
  args: {...sendArgs, name:v.string(), pdf:v.bytes()},
  handler: async (ctx, {name,pdf,...args}): Promise<void> => {
    await ctx.runQuery(internal.estimateEmails.authorizeAttachment,{})
    validatePdf(name,pdf.byteLength)
    if (new TextDecoder().decode(pdf.slice(0,5)) !== '%PDF-') throw new Error('Choose a valid PDF document.')
    const storageId = await ctx.storage.store(new Blob([pdf],{type:'application/pdf'}))
    let added = false
    try {
      added = await ctx.runMutation(internal.estimateEmails.queuePdf,{...args,name,storageId})
    } finally {
      if (!added) await ctx.runMutation(internal.estimateEmails.discardUnusedPdf,{storageId,key:args.id + ':' + args.key})
    }
  }
})

export const refreshHistory = mutation({
  args: { id: v.id('estimateLeads') },
  handler: async (ctx, {id}) => {
    await requireAdmin(ctx)
    const rows = await ctx.db.query('emailDeliveries').withIndex('by_lead', q => q.eq('leadId', id)).collect()
    for (const row of rows) {
      if (row.status !== 'sent' || !row.messageId || row.delivery || Date.now() - (row.checkedAt || 0) < 15000) continue
      await ctx.db.patch(row._id, {checkedAt: Date.now()})
      await ctx.scheduler.runAfter(0, internal.estimateEmails.checkDelivery, {id:row._id,messageId:row.messageId})
    }
  }
})

export const checkDelivery = internalAction({
  args: { id: v.id('emailDeliveries'), messageId: v.string() },
  handler: async (ctx, {id,messageId}) => {
    const params = new URLSearchParams({messageId, days:'90', limit:'50'})
    const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?' + params, {
      headers: {'api-key': process.env.BREVO_API_KEY!}, signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error('Brevo delivery lookup returned ' + response.status)
    const data = await response.json()
    const outcomes: Record<string,'delivered'|'blocked'|'bounced'> = {delivered:'delivered',blocked:'blocked',invalid:'blocked',hardBounces:'bounced',hardBounce:'bounced'}
    for (const event of data.events || []) {
      const delivery = outcomes[event.event]
      if (event.messageId !== messageId || !delivery) continue
      await ctx.runMutation(internal.estimateEmails.recordDelivery, {id,messageId,delivery,deliveryAt:Date.parse(event.date)})
      break
    }
  }
})

export const recordDelivery = internalMutation({
  args: {id:v.id('emailDeliveries'), messageId:v.string(), delivery:v.union(v.literal('delivered'),v.literal('blocked'),v.literal('bounced')), deliveryAt:v.number()},
  handler: async (ctx, {id,messageId,delivery,deliveryAt}) => {
    const row = await ctx.db.get(id)
    if (row?.messageId === messageId) await ctx.db.patch(id, {delivery,deliveryAt})
  }
})

export const retry = mutation({
  args: { id: v.id('emailDeliveries') },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    const row = await ctx.db.get(id)
    if (!row || row.status !== 'failed' || !emailEnabled(row.email)) throw new Error('This message cannot be retried.')
    await ctx.db.patch(id, { status: 'pending', nextAttemptAt: Date.now(), errorCode: undefined })
    await ctx.scheduler.runAfter(0, internal.estimateEmails.deliver, { id })
  }
})
export const claim = internalMutation({
  args: { id: v.id("emailDeliveries") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id),
      now = Date.now();
    if (!row || row.status !== "pending" || row.nextAttemptAt > now)
      return null;
    if (
      !emailEnabled(row.email) ||
      !process.env.BREVO_API_KEY ||
      !process.env.BREVO_SENDER_EMAIL
    )
      return null;
    const attempts = await ctx.db
      .query("emailAttempts")
      .withIndex("by_at", (q) => q.gt("at", now - 86400000))
      .collect();
    if (attempts.length >= 290) {
      await ctx.db.patch(id, {
        nextAttemptAt: attempts[0].at + 86400001,
        errorCode: "daily_limit",
      });
      return null;
    }
    await ctx.db.insert("emailAttempts", { at: now });
    await ctx.db.patch(id, {
      status: "sending",
      attempts: row.attempts + 1,
      attemptedAt: now,
      errorCode: undefined,
    });
    return row;
  },
});
export const recordResult = internalMutation({
  args: {
    id: v.id("emailDeliveries"),
    status: v.union(
      v.literal("sent"),
      v.literal("pending"),
      v.literal("failed"),
      v.literal("review"),
    ),
    errorCode: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "sending") return;
    await ctx.db.patch(row._id, {
      status: args.status,
      errorCode: args.errorCode,
      messageId: args.messageId,
      sentAt: args.status === "sent" ? Date.now() : undefined,
      nextAttemptAt: Date.now() + 3600000,
    });
    if (args.status === "sent" && args.messageId) await ctx.scheduler.runAfter(60000, internal.estimateEmails.checkDelivery, {id:args.id, messageId:args.messageId});

  },
});
export const deliver = internalAction({
  args: { id: v.id("emailDeliveries") },
  handler: async (ctx, { id }): Promise<void> => {
    const row = await ctx.runMutation(internal.estimateEmails.claim, { id });
    if (!row) return;
    const record = (
      status: "sent" | "pending" | "failed" | "review",
      errorCode?: string,
      messageId?: string,
    ) =>
      ctx.runMutation(internal.estimateEmails.recordResult, {
        id,
        status,
        errorCode,
        messageId,
      });
    const headers = {
      "api-key": process.env.BREVO_API_KEY!,
      "Content-Type": "application/json",
      accept: "application/json",
    };
    // Inspect account credits too: campaigns or other integrations may share the account.
    try {
      const response = await fetch("https://api.brevo.com/v3/account", {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await record(
          response.status === 429 || response.status >= 500
            ? "pending"
            : "failed",
          "account_check_failed",
        );
        return;
      }
      const account = await response.json();
      if (account.relay?.enabled === false) {
        await record("failed", "transactional_email_not_active");
        return;
      }
      const credits = (account.plan || [])
        .filter((p: { type: string; credits?: number }) =>
          ["free", "subscription", "payAsYouGo"].includes(p.type),
        )
        .map((p: { credits?: number }) => p.credits)
        .filter((n: unknown): n is number => typeof n === "number");
      if (!credits.length || Math.max(...credits) <= 10) {
        await record("pending", "brevo_credit_buffer");
        return;
      }
    } catch {
      await record("pending", "account_check_unavailable");
      return;
    }
    let attachment
    if (row.attachment) {
      try {
        const file = await ctx.storage.get(row.attachment.storageId)
        if (!file) throw new Error('Missing PDF')
        const bytes = new Uint8Array(await file.arrayBuffer())
        // Multiples of three keep intermediate base64 chunks free of padding.
        const chunks = []
        for (let start = 0; start < bytes.length; start += 24576)
          chunks.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24576))))
        attachment = [{name:row.attachment.name, content:chunks.join('')}]
      } catch {
        await record('failed', 'pdf_attachment_unavailable')
        return
      }
    }
    let response: Response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          sender: {
            name: shop,
            email: process.env.BREVO_SENDER_EMAIL,
          },
          replyTo: {
            name: shop,
            email:
              process.env.BREVO_REPLY_TO_EMAIL || inbox,
          },
          attachment,
          to: [{ email: row.email, name: row.name }],
          subject: row.subject, htmlContent: row.htmlContent, textContent: row.textContent,
          headers: { idempotencyKey: row._id },
          tags: ["car-craft-estimates", row.kind],
        }),
      });
    } catch {
      await record("review", "delivery_unknown_check_brevo");
      return;
    }
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      await record(
        "sent",
        undefined,
        typeof data.messageId === "string" ? data.messageId : undefined,
      );
    } else if (response.status === 429)
      await record("pending", "brevo_rate_limit");
    else if (response.status >= 500)
      await record("review", "delivery_unknown_check_brevo");
    else await record("failed", `brevo_http_${response.status}`);
  },
});
export const drain = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_status_next", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", Date.now()),
      )
      .take(25);
    for (const row of pending)
      await ctx.scheduler.runAfter(0, internal.estimateEmails.deliver, { id: row._id });
    const sending = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "sending"))
      .collect();
    for (const row of sending)
      if ((row.attemptedAt || 0) < Date.now() - 600000)
        await ctx.db.patch(row._id, {
          status: "review",
          errorCode: "delivery_unknown_check_brevo",
        });
    const expired = await ctx.db
      .query("emailAttempts")
      .withIndex("by_at", (q) => q.lt("at", Date.now() - 172800000))
      .take(1000);
    for (const row of expired) await ctx.db.delete(row._id);
  },
});
