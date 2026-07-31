import { getAuthUserId } from '@convex-dev/auth/server'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'

const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const DEFAULT_LUNCH_MINUTES = 60
const SETTINGS_KEY = 'default'
const eventType = v.union(
  v.literal('clock_in'),
  v.literal('lunch_start'),
  v.literal('lunch_end'),
  v.literal('clock_out')
)

type ClockEvent = 'clock_in' | 'lunch_start' | 'lunch_end' | 'clock_out'

function cleanCode(value: string) {
  return value.trim().toLowerCase()
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stateAfter(event?: ClockEvent) {
  if (!event || event === 'clock_out') return 'off_shift' as const
  if (event === 'lunch_start') return 'on_lunch' as const
  return 'working' as const
}

function validActions(state: ReturnType<typeof stateAfter>): ClockEvent[] {
  if (state === 'off_shift') return ['clock_in']
  if (state === 'on_lunch') return ['lunch_end']
  return ['lunch_start', 'clock_out']
}

async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Admin authentication required')
  return userId
}

async function locationForTag(ctx: any, tagCode: string) {
  const code = cleanCode(tagCode)
  if (!code || code.length < 16) return null
  const location = await ctx.db
    .query('timeClockLocations')
    .withIndex('by_tag_code', (q: any) => q.eq('tagCode', code))
    .unique()
  return location?.active ? location : null
}

async function sessionForToken(ctx: any, sessionToken: string) {
  if (!sessionToken || sessionToken.length < 32) return null
  const tokenHash = await sha256(sessionToken)
  const session = await ctx.db
    .query('timeClockSessions')
    .withIndex('by_token_hash', (q: any) => q.eq('tokenHash', tokenHash))
    .unique()
  if (!session || !session.active || session.expiresAt <= Date.now()) return null
  const employee = await ctx.db.get(session.employeeId)
  if (!employee?.active) return null
  return { session, employee }
}

async function latestEmployeeEvent(ctx: any, employeeId: any) {
  return ctx.db
    .query('timeClockEvents')
    .withIndex('by_employee_time', (q: any) => q.eq('employeeId', employeeId))
    .order('desc')
    .first()
}

async function getSettings(ctx: any) {
  const settings = await ctx.db
    .query('timeClockSettings')
    .withIndex('by_key', (q: any) => q.eq('key', SETTINGS_KEY))
    .unique()
  return settings || {
    automaticLunchEndEnabled: false,
    automaticLunchMinutes: DEFAULT_LUNCH_MINUTES
  }
}

export const getClockState = query({
  args: {
    tagCode: v.string(),
    sessionToken: v.optional(v.string())
  },
  handler: async (ctx, { tagCode, sessionToken }) => {
    const location = await locationForTag(ctx, tagCode)
    if (!location) return { status: 'invalid_tag' as const }

    if (!sessionToken) {
      return { status: 'enrollment_required' as const, locationName: location.name }
    }

    const identity = await sessionForToken(ctx, sessionToken)
    if (!identity) {
      return { status: 'enrollment_required' as const, locationName: location.name }
    }

    const latest = await latestEmployeeEvent(ctx, identity.employee._id)
    const clockState = stateAfter(latest?.eventType)
    const settings = await getSettings(ctx)
    return {
      status: 'ready' as const,
      locationName: location.name,
      employeeName: identity.employee.name,
      clockState,
      validActions: validActions(clockState),
      automaticLunchEndAt: clockState === 'on_lunch' && settings.automaticLunchEndEnabled
        ? latest.occurredAt + settings.automaticLunchMinutes * 60 * 1000
        : null,
      lastEvent: latest ? { eventType: latest.eventType, occurredAt: latest.occurredAt } : null
    }
  }
})

export const enrollDevice = mutation({
  args: {
    tagCode: v.string(),
    enrollmentCodeHash: v.string(),
    sessionToken: v.string()
  },
  handler: async (ctx, args) => {
    const location = await locationForTag(ctx, args.tagCode)
    if (!location) throw new ConvexError('This clock tag is not active.')
    if (args.sessionToken.length < 32 || args.enrollmentCodeHash.length !== 64) {
      throw new ConvexError('Invalid enrollment information.')
    }

    const now = Date.now()
    const employees = await ctx.db.query('timeClockEmployees').withIndex('by_active', (q) => q.eq('active', true)).collect()
    const employee = employees.find((row) =>
      row.enrollmentCodeHash === args.enrollmentCodeHash &&
      Boolean(row.enrollmentCodeExpiresAt && row.enrollmentCodeExpiresAt > now)
    )
    if (!employee) throw new ConvexError('That enrollment code is invalid or expired.')

    const tokenHash = await sha256(args.sessionToken)
    const existing = await ctx.db
      .query('timeClockSessions')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', tokenHash))
      .unique()
    if (existing) await ctx.db.delete(existing._id)

    await ctx.db.insert('timeClockSessions', {
      employeeId: employee._id,
      tokenHash,
      active: true,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_LIFETIME_MS
    })
    await ctx.db.patch(employee._id, {
      enrollmentCodeHash: undefined,
      enrollmentCodeExpiresAt: undefined,
      updatedAt: now
    })
    return { employeeName: employee.name }
  }
})

export const recordEvent = mutation({
  args: {
    tagCode: v.string(),
    sessionToken: v.string(),
    eventType
  },
  handler: async (ctx, args) => {
    const [location, identity] = await Promise.all([
      locationForTag(ctx, args.tagCode),
      sessionForToken(ctx, args.sessionToken)
    ])
    if (!location) throw new ConvexError('This clock tag is not active.')
    if (!identity) throw new ConvexError('This phone is no longer enrolled. Ask a manager for a new code.')

    const latest = await latestEmployeeEvent(ctx, identity.employee._id)
    const clockState = stateAfter(latest?.eventType)
    if (!validActions(clockState).includes(args.eventType)) {
      throw new ConvexError('That action is not available for your current clock status.')
    }

    const now = Date.now()
    const eventId = await ctx.db.insert('timeClockEvents', {
      employeeId: identity.employee._id,
      eventType: args.eventType,
      occurredAt: now,
      locationId: location._id,
      sessionId: identity.session._id,
      source: 'nfc',
      createdAt: now
    })
    await ctx.db.patch(identity.session._id, { lastSeenAt: now })
    let automaticLunchEndAt = null
    if (args.eventType === 'lunch_start') {
      const settings = await getSettings(ctx)
      if (settings.automaticLunchEndEnabled) {
        automaticLunchEndAt = now + settings.automaticLunchMinutes * 60 * 1000
        await ctx.scheduler.runAfter(
          settings.automaticLunchMinutes * 60 * 1000,
          internal.timeClock.automaticLunchEnd,
          { lunchStartEventId: eventId, automaticLunchMinutes: settings.automaticLunchMinutes }
        )
      }
    }
    return { eventId, employeeName: identity.employee.name, eventType: args.eventType, occurredAt: now, automaticLunchEndAt }
  }
})

export const automaticLunchEnd = internalMutation({
  args: {
    lunchStartEventId: v.id('timeClockEvents'),
    automaticLunchMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const [lunchStart, settings] = await Promise.all([
      ctx.db.get(args.lunchStartEventId),
      getSettings(ctx)
    ])
    if (!lunchStart || lunchStart.eventType !== 'lunch_start') return
    if (!settings.automaticLunchEndEnabled || settings.automaticLunchMinutes !== args.automaticLunchMinutes) return

    const latest = await latestEmployeeEvent(ctx, lunchStart.employeeId)
    if (!latest || latest._id !== lunchStart._id || latest.eventType !== 'lunch_start') return

    const dueAt = lunchStart.occurredAt + args.automaticLunchMinutes * 60 * 1000
    if (Date.now() < dueAt) {
      await ctx.scheduler.runAfter(dueAt - Date.now(), internal.timeClock.automaticLunchEnd, args)
      return
    }

    const now = Date.now()
    await ctx.db.insert('timeClockEvents', {
      employeeId: lunchStart.employeeId,
      eventType: 'lunch_end',
      occurredAt: now,
      locationId: lunchStart.locationId,
      sessionId: lunchStart.sessionId,
      source: 'admin',
      note: `Lunch ended automatically after ${args.automaticLunchMinutes} minutes.`,
      createdAt: now
    })
  }
})

export const forgetDevice = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const identity = await sessionForToken(ctx, sessionToken)
    if (identity) await ctx.db.patch(identity.session._id, { active: false, lastSeenAt: Date.now() })
  }
})

export const adminDashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const [employees, locations, events, settings] = await Promise.all([
      ctx.db.query('timeClockEmployees').order('asc').collect(),
      ctx.db.query('timeClockLocations').order('asc').collect(),
      ctx.db.query('timeClockEvents').withIndex('by_time').order('desc').take(250),
      getSettings(ctx)
    ])

    const employeeById = new Map(employees.map((employee) => [String(employee._id), employee]))
    const locationById = new Map(locations.map((location) => [String(location._id), location]))
    const latestByEmployee = new Map<string, any>()
    for (const event of events) {
      const key = String(event.employeeId)
      if (!latestByEmployee.has(key)) latestByEmployee.set(key, event)
    }

    return {
      employees: employees.map((employee) => {
        const latest = latestByEmployee.get(String(employee._id))
        return {
          ...employee,
          enrollmentPending: Boolean(employee.enrollmentCodeHash && employee.enrollmentCodeExpiresAt && employee.enrollmentCodeExpiresAt > Date.now()),
          clockState: stateAfter(latest?.eventType),
          lastEventAt: latest?.occurredAt
        }
      }),
      locations,
      settings: {
        automaticLunchEndEnabled: settings.automaticLunchEndEnabled,
        automaticLunchMinutes: settings.automaticLunchMinutes
      },
      events: events.map((event) => ({
        ...event,
        employeeName: employeeById.get(String(event.employeeId))?.name || 'Unknown employee',
        locationName: locationById.get(String(event.locationId))?.name || 'Unknown location'
      }))
    }
  }
})

export const adminWeeklySummary = query({
  args: {
    startAt: v.number(),
    endAt: v.number(),
    asOf: v.number()
  },
  handler: async (ctx, { startAt, endAt, asOf }) => {
    await requireAdmin(ctx)
    const weekLength = endAt - startAt
    if (weekLength < 6 * 24 * 60 * 60 * 1000 || weekLength > 8 * 24 * 60 * 60 * 1000) {
      throw new Error('Invalid weekly reporting range.')
    }

    const employees = await ctx.db.query('timeClockEmployees').order('asc').collect()
    const cutoff = Math.max(startAt, Math.min(asOf, endAt, Date.now()))
    const rows = await Promise.all(employees.map(async (employee) => {
      const [previous, events] = await Promise.all([
        ctx.db
          .query('timeClockEvents')
          .withIndex('by_employee_time', (q) => q.eq('employeeId', employee._id).lt('occurredAt', startAt))
          .order('desc')
          .first(),
        ctx.db
          .query('timeClockEvents')
          .withIndex('by_employee_time', (q) => q.eq('employeeId', employee._id).gte('occurredAt', startAt).lt('occurredAt', endAt))
          .order('asc')
          .collect()
      ])

      let working = stateAfter(previous?.eventType) === 'working'
      let workingSince = working ? startAt : null
      let workedMilliseconds = 0

      for (const event of events) {
        if (event.occurredAt > cutoff) break
        if (event.eventType === 'clock_in' || event.eventType === 'lunch_end') {
          if (!working) {
            working = true
            workingSince = Math.max(startAt, event.occurredAt)
          }
        } else if (working && workingSince !== null) {
          workedMilliseconds += Math.max(0, event.occurredAt - workingSince)
          working = false
          workingSince = null
        }
      }

      if (working && workingSince !== null && cutoff > workingSince) {
        workedMilliseconds += cutoff - workingSince
      }

      return {
        employeeId: employee._id,
        employeeName: employee.name,
        active: employee.active,
        workedMilliseconds,
        currentlyWorking: working && cutoff < endAt
      }
    }))

    return { startAt, endAt, asOf: cutoff, employees: rows }
  }
})

export const updateLunchSettings = mutation({
  args: {
    automaticLunchEndEnabled: v.boolean(),
    automaticLunchMinutes: v.number()
  },
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx)
    const minutes = Math.round(args.automaticLunchMinutes)
    if (minutes < 15 || minutes > 180) throw new Error('Automatic lunch must be between 15 and 180 minutes.')

    const existing = await ctx.db
      .query('timeClockSettings')
      .withIndex('by_key', (q) => q.eq('key', SETTINGS_KEY))
      .unique()
    const payload = {
      automaticLunchEndEnabled: args.automaticLunchEndEnabled,
      automaticLunchMinutes: minutes,
      updatedAt: Date.now(),
      updatedBy: userId
    }
    if (existing) {
      await ctx.db.patch(existing._id, payload)
    } else {
      await ctx.db.insert('timeClockSettings', { key: SETTINGS_KEY, ...payload })
    }

    if (args.automaticLunchEndEnabled) {
      const employees = await ctx.db.query('timeClockEmployees').withIndex('by_active', (q) => q.eq('active', true)).collect()
      for (const employee of employees) {
        const latest = await latestEmployeeEvent(ctx, employee._id)
        if (!latest || latest.eventType !== 'lunch_start') continue
        const dueAt = latest.occurredAt + minutes * 60 * 1000
        await ctx.scheduler.runAfter(
          Math.max(0, dueAt - Date.now()),
          internal.timeClock.automaticLunchEnd,
          { lunchStartEventId: latest._id, automaticLunchMinutes: minutes }
        )
      }
    }
  }
})

export const createEmployee = mutation({
  args: { name: v.string(), enrollmentCodeHash: v.string(), enrollmentCodeExpiresAt: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const name = args.name.trim()
    if (name.length < 2 || name.length > 80) throw new Error('Enter the employee’s full name.')
    if (args.enrollmentCodeHash.length !== 64 || args.enrollmentCodeExpiresAt <= Date.now()) {
      throw new Error('Invalid enrollment code.')
    }
    const now = Date.now()
    return ctx.db.insert('timeClockEmployees', {
      name,
      active: true,
      enrollmentCodeHash: args.enrollmentCodeHash,
      enrollmentCodeExpiresAt: args.enrollmentCodeExpiresAt,
      createdAt: now,
      updatedAt: now
    })
  }
})

export const issueEnrollmentCode = mutation({
  args: { employeeId: v.id('timeClockEmployees'), enrollmentCodeHash: v.string(), enrollmentCodeExpiresAt: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    if (args.enrollmentCodeHash.length !== 64 || args.enrollmentCodeExpiresAt <= Date.now()) {
      throw new Error('Invalid enrollment code.')
    }
    await ctx.db.patch(args.employeeId, {
      active: true,
      enrollmentCodeHash: args.enrollmentCodeHash,
      enrollmentCodeExpiresAt: args.enrollmentCodeExpiresAt,
      updatedAt: Date.now()
    })
  }
})

export const setEmployeeActive = mutation({
  args: { employeeId: v.id('timeClockEmployees'), active: v.boolean() },
  handler: async (ctx, { employeeId, active }) => {
    await requireAdmin(ctx)
    await ctx.db.patch(employeeId, { active, updatedAt: Date.now() })
    if (!active) {
      const sessions = await ctx.db
        .query('timeClockSessions')
        .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
        .collect()
      for (const session of sessions) await ctx.db.patch(session._id, { active: false })
    }
  }
})

export const deleteEmployee = mutation({
  args: { employeeId: v.id('timeClockEmployees') },
  handler: async (ctx, { employeeId }) => {
    await requireAdmin(ctx)
    const employee = await ctx.db.get(employeeId)
    if (!employee) throw new Error('That employee no longer exists.')

    const [sessions, events] = await Promise.all([
      ctx.db
        .query('timeClockSessions')
        .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
        .collect(),
      ctx.db
        .query('timeClockEvents')
        .withIndex('by_employee_time', (q) => q.eq('employeeId', employeeId))
        .collect()
    ])

    for (const event of events) await ctx.db.delete(event._id)
    for (const session of sessions) await ctx.db.delete(session._id)
    await ctx.db.delete(employeeId)

    return {
      employeeName: employee.name,
      deletedSessions: sessions.length,
      deletedEvents: events.length
    }
  }
})

export const seedDefaultLocation = internalMutation({
  args: { name: v.string(), tagCode: v.string() },
  handler: async (ctx, args) => {
    const tagCode = cleanCode(args.tagCode)
    if (tagCode.length < 16) throw new Error('Tag code must be at least 16 characters.')
    const existing = await ctx.db
      .query('timeClockLocations')
      .withIndex('by_tag_code', (q) => q.eq('tagCode', tagCode))
      .unique()
    if (existing) return existing._id
    const now = Date.now()
    return ctx.db.insert('timeClockLocations', {
      name: args.name.trim() || 'Car Craft — West Hartford',
      tagCode,
      active: true,
      createdAt: now,
      updatedAt: now
    })
  }
})
