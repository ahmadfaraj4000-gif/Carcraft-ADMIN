import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Run hourly so the function can select 5:00 PM in America/New_York across DST changes.
crons.hourly(
  'weekday 5pm missing clock-out reminders',
  { minuteUTC: 0 },
  internal.timeClock.notifyMissingClockOuts
)

export default crons
