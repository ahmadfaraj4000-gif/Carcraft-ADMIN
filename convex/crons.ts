import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Run hourly so the function can select 4:45 PM in America/New_York across DST changes.
crons.hourly(
  'weekday 4:45pm missing clock-out reminders',
  { minuteUTC: 45 },
  internal.timeClock.notifyMissingClockOuts
)

crons.interval('Deliver estimate emails', { minutes: 5 }, internal.estimateEmails.drain)

export default crons
