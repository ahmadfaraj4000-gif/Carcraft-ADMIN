import { internalAction } from './_generated/server'
import { v } from 'convex/values'

const clockEventType = v.union(
  v.literal('clock_in'),
  v.literal('lunch_start'),
  v.literal('lunch_end'),
  v.literal('clock_out')
)

const clockEventPhrases = {
  clock_in: 'clocked in',
  lunch_start: 'started lunch',
  lunch_end: 'ended lunch',
  clock_out: 'clocked out'
} as const

function easternTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(timestamp))
}

async function sendPushover(args: {
  title: string
  message: string
  context: string
  timestamp?: number
  priority?: '-1' | '0' | '1'
}) {
  const token = process.env.PUSHOVER_API_TOKEN
  const user = process.env.PUSHOVER_USER_KEY
  if (!token || !user) {
    console.warn(`Pushover notification skipped for ${args.context}: missing PUSHOVER_API_TOKEN or PUSHOVER_USER_KEY.`)
    return { sent: false, reason: 'not_configured' as const }
  }

  const payload: Record<string, string> = {
    token,
    user,
    title: args.title,
    message: args.message,
    priority: args.priority || '0'
  }
  if (args.timestamp) payload.timestamp = String(Math.floor(args.timestamp / 1000))

  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload)
    })
    const body = await response.text()
    if (!response.ok) {
      console.error(`Pushover notification failed for ${args.context} with ${response.status}: ${body}`)
      return { sent: false, reason: 'rejected' as const }
    }
    console.log(`Pushover notification accepted for ${args.context}: ${body}`)
    return { sent: true as const }
  } catch (error) {
    console.error(`Pushover notification request failed for ${args.context}: ${error}`)
    return { sent: false, reason: 'request_failed' as const }
  }
}

export const sendEstimateLead = internalAction({
  args: {
    leadId: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.string(),
    vehicle: v.optional(v.string()),
    damageArea: v.string(),
    severity: v.string(),
    rentalVehicleInterest: v.optional(v.boolean()),
    towAssistanceInterest: v.optional(v.boolean())
  },
  handler: async (_ctx, args) => {
    const message = [
      `${args.name} submitted a new estimate request.`,
      args.vehicle ? `Vehicle: ${args.vehicle}` : null,
      `Phone: ${args.phone}`,
      `Email: ${args.email}`,
      `Damage: ${args.damageArea}`,
      `Severity: ${args.severity}`,
      args.rentalVehicleInterest ? 'Rental: Interested' : null,
      args.towAssistanceInterest ? 'Tow: Needed' : null,
      `Lead ID: ${args.leadId}`
    ].filter(Boolean).join('\n')
    return sendPushover({
      title: 'New Car Craft Estimate Lead',
      message,
      context: `estimate lead ${args.leadId}`
    })
  }
})

export const sendTimeClockEvent = internalAction({
  args: {
    employeeName: v.string(),
    eventType: clockEventType,
    occurredAt: v.number(),
    source: v.union(v.literal('nfc'), v.literal('admin')),
    note: v.optional(v.string())
  },
  handler: async (_ctx, args) => {
    const phrase = clockEventPhrases[args.eventType]
    const message = [
      `${args.employeeName} ${phrase} at ${easternTime(args.occurredAt)}.`,
      args.source === 'admin' ? 'Recorded by an administrator.' : null,
      args.note || null
    ].filter(Boolean).join('\n')
    return sendPushover({
      title: `Time Clock — ${args.employeeName}`,
      message,
      context: `${args.employeeName} ${args.eventType}`,
      timestamp: args.occurredAt
    })
  }
})

export const sendMissingClockOutReminder = internalAction({
  args: {
    employeeNames: v.array(v.string()),
    checkedAt: v.number()
  },
  handler: async (_ctx, args) => {
    if (!args.employeeNames.length) return { sent: false, reason: 'no_employees' as const }
    const names = args.employeeNames.join(', ')
    const message = args.employeeNames.length === 1
      ? `${names} clocked in today and has not clocked out as of 5:00 PM ET.`
      : `${args.employeeNames.length} employees clocked in today and have not clocked out as of 5:00 PM ET: ${names}.`
    return sendPushover({
      title: '5:00 PM Clock-Out Reminder',
      message,
      context: `missing clock-outs at ${easternTime(args.checkedAt)}`,
      timestamp: args.checkedAt,
      priority: '0'
    })
  }
})
