import { getAuthUserId } from '@convex-dev/auth/server'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'

const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const DEFAULT_LUNCH_MINUTES = 60
const DEFAULT_GEOFENCE_ADDRESS = '8 South St, West Hartford, CT 06110'
const DEFAULT_GEOFENCE_RADIUS_METERS = 350 / 3.28084
const DEFAULT_GEOFENCE_MAX_ACCURACY_METERS = 200 / 3.28084
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

function adminValidActions(state: ReturnType<typeof stateAfter>): ClockEvent[] {
  if (state === 'off_shift') return ['clock_in']
  if (state === 'on_lunch') return ['lunch_end', 'clock_out']
  return ['lunch_start', 'clock_out']
}

const easternDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23'
})

function partsForEasternTime(timestamp: number) {
  return Object.fromEntries(easternDateParts.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
}

function easternMidnightUtc(year: number, month: number, day: number) {
  const target = Date.UTC(year, month - 1, day)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsForEasternTime(guess)
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    guess += target - represented
  }
  return guess
}

function easternDayBounds(timestamp: number) {
  const parts = partsForEasternTime(timestamp)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    dateKey: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    startAt: easternMidnightUtc(year, month, day),
    endAt: easternMidnightUtc(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate())
  }
}

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const earthRadiusMeters = 6371000
  const latitudeDelta = radians(latitudeB - latitudeA)
  const longitudeDelta = radians(longitudeB - longitudeA)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
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
  return {
    ...settings,
    automaticLunchEndEnabled: settings?.automaticLunchEndEnabled ?? false,
    automaticLunchMinutes: settings?.automaticLunchMinutes ?? DEFAULT_LUNCH_MINUTES,
    geofenceEnabled: settings?.geofenceEnabled ?? false,
    geofenceAddress: settings?.geofenceAddress ?? DEFAULT_GEOFENCE_ADDRESS,
    geofenceLatitude: settings?.geofenceLatitude,
    geofenceLongitude: settings?.geofenceLongitude,
    geofenceRadiusMeters: settings?.geofenceRadiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS,
    geofenceMaxAccuracyMeters: settings?.geofenceMaxAccuracyMeters ?? DEFAULT_GEOFENCE_MAX_ACCURACY_METERS,
    geofencePointAccuracyMeters: settings?.geofencePointAccuracyMeters,
    geofenceRequiredActions: settings?.geofenceRequiredActions ?? ['clock_in'],
    lastMissingClockOutReminderDate: settings?.lastMissingClockOutReminderDate
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
      locationRequiredActions: settings.geofenceEnabled ? settings.geofenceRequiredActions : [],
      locationRadiusFeet: Math.round(settings.geofenceRadiusMeters * 3.28084),
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
    eventType,
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    accuracyMeters: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const [location, identity] = await Promise.all([
      locationForTag(ctx, args.tagCode),
      sessionForToken(ctx, args.sessionToken)
    ])
    if (!location) throw new ConvexError('This clock tag is not active.')
    if (!identity) throw new ConvexError('This phone is no longer enrolled. Ask a manager for a new code.')

    const [latest, settings] = await Promise.all([
      latestEmployeeEvent(ctx, identity.employee._id),
      getSettings(ctx)
    ])
    const clockState = stateAfter(latest?.eventType)
    if (!validActions(clockState).includes(args.eventType)) {
      throw new ConvexError('That action is not available for your current clock status.')
    }

    let locationDistance = null
    let locationAccuracy = null
    if (settings.geofenceEnabled && settings.geofenceRequiredActions.includes(args.eventType)) {
      if (typeof settings.geofenceLatitude !== 'number' || typeof settings.geofenceLongitude !== 'number') {
        throw new ConvexError('The shop location is not configured. Ask a manager for help.')
      }
      if (
        typeof args.latitude !== 'number' || args.latitude < -90 || args.latitude > 90 ||
        typeof args.longitude !== 'number' || args.longitude < -180 || args.longitude > 180 ||
        typeof args.accuracyMeters !== 'number' || args.accuracyMeters < 0
      ) {
        throw new ConvexError('Location is required for this action. Allow location access and try again.')
      }
      if (args.accuracyMeters > settings.geofenceMaxAccuracyMeters) {
        throw new ConvexError('Your phone could not get an accurate enough location. Move near a window or outside and try again.')
      }
      locationDistance = distanceMeters(args.latitude, args.longitude, settings.geofenceLatitude, settings.geofenceLongitude)
      locationAccuracy = args.accuracyMeters
      if (locationDistance > settings.geofenceRadiusMeters) {
        throw new ConvexError(`You must be within ${Math.round(settings.geofenceRadiusMeters * 3.28084)} feet of Car Craft to complete this action.`)
      }
    }

    const now = Date.now()
    const eventId = await ctx.db.insert('timeClockEvents', {
      employeeId: identity.employee._id,
      eventType: args.eventType,
      occurredAt: now,
      locationId: location._id,
      sessionId: identity.session._id,
      source: 'nfc',
      locationVerified: locationDistance !== null ? true : undefined,
      locationDistanceMeters: locationDistance ?? undefined,
      locationAccuracyMeters: locationAccuracy ?? undefined,
      createdAt: now
    })
    await ctx.db.patch(identity.session._id, { lastSeenAt: now })
    await ctx.scheduler.runAfter(0, internal.notifications.sendTimeClockEvent, {
      employeeName: identity.employee.name,
      eventType: args.eventType,
      occurredAt: now,
      source: 'nfc'
    })
    let automaticLunchEndAt = null
    if (args.eventType === 'lunch_start') {
      if (settings.automaticLunchEndEnabled) {
        automaticLunchEndAt = now + settings.automaticLunchMinutes * 60 * 1000
        await ctx.scheduler.runAfter(
          settings.automaticLunchMinutes * 60 * 1000,
          internal.timeClock.automaticLunchEnd,
          { lunchStartEventId: eventId, automaticLunchMinutes: settings.automaticLunchMinutes }
        )
      }
    }
    return {
      eventId,
      employeeName: identity.employee.name,
      eventType: args.eventType,
      occurredAt: now,
      automaticLunchEndAt,
      locationVerified: locationDistance !== null,
      locationDistanceFeet: locationDistance !== null ? Math.round(locationDistance * 3.28084) : null
    }
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
    const employee = await ctx.db.get(lunchStart.employeeId)
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
    if (employee) {
      await ctx.scheduler.runAfter(0, internal.notifications.sendTimeClockEvent, {
        employeeName: employee.name,
        eventType: 'lunch_end',
        occurredAt: now,
        source: 'admin',
        note: `Lunch ended automatically after ${args.automaticLunchMinutes} minutes.`
      })
    }
  }
})

export const adminRecordEvent = mutation({
  args: {
    employeeId: v.id('timeClockEmployees'),
    eventType,
    occurredAt: v.number(),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const adminUserId = await requireAdmin(ctx)
    const [employee, locations, settings, latest] = await Promise.all([
      ctx.db.get(args.employeeId),
      ctx.db.query('timeClockLocations').collect(),
      getSettings(ctx),
      latestEmployeeEvent(ctx, args.employeeId)
    ])
    if (!employee) throw new Error('That employee no longer exists.')
    if (!employee.active) throw new Error('Reactivate this employee before recording a clock action.')
    const location = locations.find((row) => row.active)
    if (!location) throw new Error('No active clock location is configured.')

    const currentState = stateAfter(latest?.eventType)
    if (!adminValidActions(currentState).includes(args.eventType)) {
      throw new Error(`That action is not available while ${employee.name} is ${currentState.replace('_', ' ')}.`)
    }

    const now = Date.now()
    const occurredAt = Math.round(args.occurredAt)
    if (!Number.isFinite(occurredAt) || occurredAt > now + 5 * 60 * 1000) throw new Error('The effective time cannot be in the future.')
    if (occurredAt < now - 90 * 24 * 60 * 60 * 1000) throw new Error('Manager clock adjustments must be within the last 90 days.')
    if (latest && occurredAt <= latest.occurredAt) throw new Error('The effective time must be after this employee’s last recorded action.')

    const note = args.note?.trim()
    if (note && note.length > 240) throw new Error('The manager note must be 240 characters or fewer.')
    const eventNote = note || 'Recorded by an administrator.'
    const eventId = await ctx.db.insert('timeClockEvents', {
      employeeId: employee._id,
      eventType: args.eventType,
      occurredAt,
      locationId: location._id,
      adminUserId,
      source: 'admin',
      note: eventNote,
      createdAt: now
    })

    await ctx.scheduler.runAfter(0, internal.notifications.sendTimeClockEvent, {
      employeeName: employee.name,
      eventType: args.eventType,
      occurredAt,
      source: 'admin',
      note: note || undefined
    })

    let automaticLunchEndAt = null
    if (args.eventType === 'lunch_start' && settings.automaticLunchEndEnabled) {
      automaticLunchEndAt = occurredAt + settings.automaticLunchMinutes * 60 * 1000
      await ctx.scheduler.runAfter(Math.max(0, automaticLunchEndAt - now), internal.timeClock.automaticLunchEnd, {
        lunchStartEventId: eventId,
        automaticLunchMinutes: settings.automaticLunchMinutes
      })
    }

    return { eventId, employeeName: employee.name, eventType: args.eventType, occurredAt, clockState: stateAfter(args.eventType), automaticLunchEndAt }
  }
})

export const notifyMissingClockOuts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const day = easternDayBounds(now)
    if (day.hour !== 17 || day.weekday === 'Sat' || day.weekday === 'Sun') {
      return { sent: false, reason: 'outside_reminder_time' as const }
    }

    const settings = await getSettings(ctx)
    if (settings.lastMissingClockOutReminderDate === day.dateKey) return { sent: false, reason: 'already_checked' as const }

    const [employees, events] = await Promise.all([
      ctx.db.query('timeClockEmployees').collect(),
      ctx.db.query('timeClockEvents').withIndex('by_time', (q) => q.gte('occurredAt', day.startAt).lt('occurredAt', day.endAt)).order('asc').collect()
    ])
    const latestByEmployee = new Map<string, any>()
    const clockedInToday = new Set<string>()
    for (const event of events) {
      const employeeId = String(event.employeeId)
      latestByEmployee.set(employeeId, event)
      if (event.eventType === 'clock_in') clockedInToday.add(employeeId)
    }

    const employeeNames = employees
      .filter((employee) => {
        const employeeId = String(employee._id)
        const latest = latestByEmployee.get(employeeId)
        return clockedInToday.has(employeeId) && latest && stateAfter(latest.eventType) !== 'off_shift'
      })
      .map((employee) => employee.name)
      .sort((a, b) => a.localeCompare(b))

    const reminderPayload = { lastMissingClockOutReminderDate: day.dateKey, updatedAt: now }
    if (settings._id) {
      await ctx.db.patch(settings._id, reminderPayload)
    } else {
      await ctx.db.insert('timeClockSettings', {
        key: SETTINGS_KEY,
        automaticLunchEndEnabled: false,
        automaticLunchMinutes: DEFAULT_LUNCH_MINUTES,
        ...reminderPayload
      })
    }

    if (!employeeNames.length) return { sent: false, reason: 'everyone_clocked_out' as const }
    await ctx.scheduler.runAfter(0, internal.notifications.sendMissingClockOutReminder, { employeeNames, checkedAt: now })
    return { sent: true, employeeCount: employeeNames.length }
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
        automaticLunchMinutes: settings.automaticLunchMinutes,
        geofenceEnabled: settings.geofenceEnabled,
        geofenceAddress: settings.geofenceAddress,
        geofenceLatitude: settings.geofenceLatitude,
        geofenceLongitude: settings.geofenceLongitude,
        geofenceRadiusFeet: Math.round(settings.geofenceRadiusMeters * 3.28084),
        geofenceMaxAccuracyFeet: Math.round(settings.geofenceMaxAccuracyMeters * 3.28084),
        geofencePointAccuracyFeet: typeof settings.geofencePointAccuracyMeters === 'number'
          ? Math.round(settings.geofencePointAccuracyMeters * 3.28084)
          : null,
        geofenceRequiredActions: settings.geofenceRequiredActions,
        pushoverConfigured: Boolean(process.env.PUSHOVER_API_TOKEN && process.env.PUSHOVER_USER_KEY),
        missingClockOutReminderTime: '5:00 PM ET'
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
    asOf: v.number(),
    dayStarts: v.optional(v.array(v.number()))
  },
  handler: async (ctx, { startAt, endAt, asOf, dayStarts }) => {
    await requireAdmin(ctx)
    const weekLength = endAt - startAt
    if (weekLength < 6 * 24 * 60 * 60 * 1000 || weekLength > 8 * 24 * 60 * 60 * 1000) {
      throw new Error('Invalid weekly reporting range.')
    }
    const reportingDays = dayStarts || Array.from({ length: 6 }, (_, index) => startAt + (index + 2) * 24 * 60 * 60 * 1000)
    if (reportingDays.length !== 6 || reportingDays.some((day, index) => index > 0 && day <= reportingDays[index - 1])) {
      throw new Error('Invalid daily reporting boundaries.')
    }
    if (reportingDays[0] < startAt || reportingDays[5] > endAt) {
      throw new Error('Daily reporting boundaries must be inside the workweek.')
    }

    const [employees, locations, activityEvents] = await Promise.all([
      ctx.db.query('timeClockEmployees').order('asc').collect(),
      ctx.db.query('timeClockLocations').order('asc').collect(),
      ctx.db
        .query('timeClockEvents')
        .withIndex('by_time', (q) => q.gte('occurredAt', reportingDays[0]).lt('occurredAt', reportingDays[5]))
        .order('desc')
        .collect()
    ])
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
      const dailyMilliseconds = [0, 0, 0, 0, 0]

      function addWorkingInterval(intervalStart: number, intervalEnd: number) {
        for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
          const overlapStart = Math.max(intervalStart, reportingDays[dayIndex])
          const overlapEnd = Math.min(intervalEnd, reportingDays[dayIndex + 1])
          if (overlapEnd > overlapStart) dailyMilliseconds[dayIndex] += overlapEnd - overlapStart
        }
      }

      for (const event of events) {
        if (event.occurredAt > cutoff) break
        if (event.eventType === 'clock_in' || event.eventType === 'lunch_end') {
          if (!working) {
            working = true
            workingSince = Math.max(startAt, event.occurredAt)
          }
        } else if (working && workingSince !== null) {
          addWorkingInterval(workingSince, event.occurredAt)
          working = false
          workingSince = null
        }
      }

      if (working && workingSince !== null && cutoff > workingSince) {
        addWorkingInterval(workingSince, cutoff)
      }

      return {
        employeeId: employee._id,
        employeeName: employee.name,
        active: employee.active,
        workedMilliseconds: dailyMilliseconds.reduce((total, milliseconds) => total + milliseconds, 0),
        dailyMilliseconds,
        currentlyWorking: working && cutoff < endAt
      }
    }))

    const employeeById = new Map(employees.map((employee) => [String(employee._id), employee]))
    const locationById = new Map(locations.map((location) => [String(location._id), location]))
    const events = activityEvents
      .filter((event) => event.occurredAt <= cutoff)
      .map((event) => ({
        ...event,
        employeeName: employeeById.get(String(event.employeeId))?.name || 'Unknown employee',
        locationName: locationById.get(String(event.locationId))?.name || 'Unknown location'
      }))

    return { startAt, endAt, asOf: cutoff, dayStarts: reportingDays, employees: rows, events }
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

export const updateGeofenceSettings = mutation({
  args: {
    enabled: v.boolean(),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    radiusFeet: v.number(),
    maxAccuracyFeet: v.number(),
    pointAccuracyFeet: v.optional(v.number()),
    requiredActions: v.array(eventType)
  },
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx)
    const radiusFeet = Math.round(args.radiusFeet)
    const maxAccuracyFeet = Math.round(args.maxAccuracyFeet)
    const address = args.address.trim()
    const requiredActions = [...new Set(args.requiredActions)]

    if (!address || address.length > 160) throw new Error('Enter a valid shop address.')
    if (radiusFeet < 100 || radiusFeet > 1000) throw new Error('The allowed radius must be between 100 and 1,000 feet.')
    if (maxAccuracyFeet < 50 || maxAccuracyFeet > 500) throw new Error('GPS accuracy must be between 50 and 500 feet.')
    if (args.enabled && requiredActions.length === 0) throw new Error('Choose at least one action that requires location.')
    if (args.enabled && (
      typeof args.latitude !== 'number' || args.latitude < -90 || args.latitude > 90 ||
      typeof args.longitude !== 'number' || args.longitude < -180 || args.longitude > 180
    )) throw new Error('Set the shop location before enabling location verification.')

    const existing = await ctx.db.query('timeClockSettings').withIndex('by_key', (q) => q.eq('key', SETTINGS_KEY)).unique()
    const payload = {
      geofenceEnabled: args.enabled,
      geofenceAddress: address,
      geofenceLatitude: args.latitude,
      geofenceLongitude: args.longitude,
      geofenceRadiusMeters: radiusFeet / 3.28084,
      geofenceMaxAccuracyMeters: maxAccuracyFeet / 3.28084,
      geofencePointAccuracyMeters: typeof args.pointAccuracyFeet === 'number' ? args.pointAccuracyFeet / 3.28084 : undefined,
      geofenceRequiredActions: requiredActions,
      updatedAt: Date.now(),
      updatedBy: userId
    }
    if (existing) await ctx.db.patch(existing._id, payload)
    else await ctx.db.insert('timeClockSettings', { key: SETTINGS_KEY, automaticLunchEndEnabled: false, automaticLunchMinutes: DEFAULT_LUNCH_MINUTES, ...payload })
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
