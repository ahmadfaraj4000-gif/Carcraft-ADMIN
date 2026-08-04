import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { downloadPayrollPdf } from '../payrollPdf'

const CLOCK_ORIGIN = 'https://carcraftautobodytowing.com/clock.html'

const eventLabels = {
  clock_in: 'Clock in',
  lunch_start: 'Start lunch',
  lunch_end: 'End lunch',
  clock_out: 'Clock out'
}

const stateLabels = {
  off_shift: 'Off shift',
  working: 'Clocked in',
  on_lunch: 'On lunch'
}

function MiniIcon({ children }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>
}

const clockIcon = (
  <MiniIcon>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </MiniIcon>
)

function makeEnrollmentCode() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return String(100000 + (values[0] % 900000))
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function formatTime(timestamp) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function formatEasternDateTimeInput(timestamp) {
  const parts = partsFor(timestamp)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
}

function parseEasternDateTimeInput(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return NaN
  const target = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0)
  )
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsFor(guess)
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    )
    guess += target - represented
  }
  return guess
}

function managerActionsFor(clockState) {
  if (clockState === 'off_shift') return ['clock_in']
  if (clockState === 'on_lunch') return ['lunch_end', 'clock_out']
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

function partsFor(timestamp) {
  return Object.fromEntries(easternDateParts.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
}

function easternMidnightUtc(year, month, day) {
  const target = Date.UTC(year, month - 1, day)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsFor(guess)
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    guess += target - represented
  }
  return guess
}

function getEasternWeekBounds(timestamp) {
  const parts = partsFor(timestamp)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
  const daysSincePayrollAnchor = weekdayIndex === 6 ? 7 : weekdayIndex === 0 ? 8 : weekdayIndex + 1
  date.setUTCDate(date.getUTCDate() - daysSincePayrollAnchor)
  const startAt = easternMidnightUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  const dayStarts = Array.from({ length: 6 }, (_, index) => {
    const day = new Date(date)
    day.setUTCDate(day.getUTCDate() + index + 2)
    return easternMidnightUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate())
  })
  return { startAt, endAt: dayStarts[5], dayStarts }
}

function shiftEasternWeeks(timestamp, weekOffset) {
  if (!weekOffset) return timestamp
  const parts = partsFor(timestamp)
  const shiftedDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + weekOffset * 7))
  return easternMidnightUtc(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth() + 1, shiftedDate.getUTCDate())
}

function formatHours(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000))
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

function formatWeekRange(dayStarts) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
  return `${formatter.format(new Date(dayStarts[0]))}–${formatter.format(new Date(dayStarts[5] - 1))}`
}

function formatDayHeading(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric'
  }).format(new Date(timestamp))
}

function easternDateKey(timestamp) {
  const parts = partsFor(timestamp)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatCalendarHours(milliseconds) {
  if (milliseconds < 60000) return '—'
  const totalMinutes = Math.floor(milliseconds / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatEasternTimeInput(timestamp) {
  const parts = partsFor(timestamp)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function timestampForEasternDayTime(dayStartAt, time) {
  const parts = partsFor(dayStartAt)
  return parseEasternDateTimeInput(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${time}:00`)
}

function workedMillisecondsForTimeline(events) {
  let workedMilliseconds = 0
  let workingSince = null
  const sortedEvents = [...events].filter((event) => Number.isFinite(event.occurredAt)).sort((left, right) => left.occurredAt - right.occurredAt)
  for (const event of sortedEvents) {
    if (event.eventType === 'clock_in' || event.eventType === 'lunch_end') {
      if (workingSince === null) workingSince = event.occurredAt
    } else if (workingSince !== null) {
      workedMilliseconds += Math.max(0, event.occurredAt - workingSince)
      workingSince = null
    }
  }
  return workedMilliseconds
}

function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device does not support location services.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    })
  })
}

function locationPermissionMessage(error) {
  if (error?.code === 1) return 'Location permission was denied. Allow location access for this site in your browser settings and try again.'
  if (error?.code === 2) return 'Your device could not determine its location. Move near a window or outside and try again.'
  if (error?.code === 3) return 'Location timed out. Check that Location Services are enabled and try again.'
  return error?.message || 'The shop location could not be captured.'
}

export default function Payroll() {
  const dashboard = useQuery(api.timeClock.adminDashboard)
  const [payrollView, setPayrollView] = useState('calendar')
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0)
  const selectedWeekReference = useMemo(() => shiftEasternWeeks(clockNow, selectedWeekOffset), [clockNow, selectedWeekOffset])
  const weekBounds = useMemo(() => getEasternWeekBounds(selectedWeekReference), [selectedWeekReference])
  const weeklySummary = useQuery(api.timeClock.adminWeeklySummary, {
    ...weekBounds,
    asOf: selectedWeekOffset === 0 ? Math.floor(clockNow / 60000) * 60000 : weekBounds.endAt
  })
  const createEmployee = useMutation(api.timeClock.createEmployee)
  const issueEnrollmentCode = useMutation(api.timeClock.issueEnrollmentCode)
  const setEmployeeActive = useMutation(api.timeClock.setEmployeeActive)
  const deleteEmployee = useMutation(api.timeClock.deleteEmployee)
  const adminRecordEvent = useMutation(api.timeClock.adminRecordEvent)
  const adminReplaceWorkday = useMutation(api.timeClock.adminReplaceWorkday)
  const updateLunchSettings = useMutation(api.timeClock.updateLunchSettings)
  const updateGeofenceSettings = useMutation(api.timeClock.updateGeofenceSettings)
  const [employeeName, setEmployeeName] = useState('')
  const [issuedCodes, setIssuedCodes] = useState({})
  const [busyEmployee, setBusyEmployee] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [automaticLunchEnabled, setAutomaticLunchEnabled] = useState(false)
  const [automaticLunchMinutes, setAutomaticLunchMinutes] = useState(60)
  const [savingLunchSettings, setSavingLunchSettings] = useState(false)
  const [employeeToDelete, setEmployeeToDelete] = useState(null)
  const [deletingEmployee, setDeletingEmployee] = useState(false)
  const [managerAction, setManagerAction] = useState(null)
  const [managerOccurredAt, setManagerOccurredAt] = useState('')
  const [managerNote, setManagerNote] = useState('')
  const [savingManagerAction, setSavingManagerAction] = useState(false)
  const [editingWorkday, setEditingWorkday] = useState(null)
  const [workdayRecords, setWorkdayRecords] = useState([])
  const [correctionReason, setCorrectionReason] = useState('')
  const [savingCorrection, setSavingCorrection] = useState(false)
  const [downloadingSchedule, setDownloadingSchedule] = useState(false)
  const [geofenceEnabled, setGeofenceEnabled] = useState(false)
  const [geofenceAddress, setGeofenceAddress] = useState('8 South St, West Hartford, CT 06110')
  const [geofenceLatitude, setGeofenceLatitude] = useState(null)
  const [geofenceLongitude, setGeofenceLongitude] = useState(null)
  const [geofenceRadiusFeet, setGeofenceRadiusFeet] = useState(350)
  const [geofenceMaxAccuracyFeet, setGeofenceMaxAccuracyFeet] = useState(200)
  const [geofencePointAccuracyFeet, setGeofencePointAccuracyFeet] = useState(null)
  const [geofenceRequiredActions, setGeofenceRequiredActions] = useState(['clock_in'])
  const [capturingShopLocation, setCapturingShopLocation] = useState(false)
  const [savingGeofence, setSavingGeofence] = useState(false)

  const employees = dashboard?.employees || []
  const weeklyEvents = weeklySummary?.events || []
  const location = dashboard?.locations.find((row) => row.active)
  const clockUrl = location ? `${CLOCK_ORIGIN}?tag=${encodeURIComponent(location.tagCode)}` : ''
  const stats = useMemo(() => ({
    working: employees.filter((employee) => employee.active && employee.clockState === 'working').length,
    lunch: employees.filter((employee) => employee.active && employee.clockState === 'on_lunch').length,
    active: employees.filter((employee) => employee.active).length,
    entries: weeklyEvents.length
  }), [employees, weeklyEvents])
  const weeklyEmployees = weeklySummary?.employees || []
  const weeklyTotal = weeklyEmployees.reduce((total, employee) => total + employee.workedMilliseconds, 0)
  const dailyTotals = weekBounds.dayStarts.slice(0, 5).map((_, dayIndex) => weeklyEmployees.reduce((total, employee) => total + (employee.dailyMilliseconds?.[dayIndex] || 0), 0))
  const todayKey = easternDateKey(clockNow)
  const editingWorkdayHours = useMemo(() => {
    if (!editingWorkday) return 0
    return workedMillisecondsForTimeline(workdayRecords.map((record) => ({
      eventType: record.eventType,
      occurredAt: timestampForEasternDayTime(editingWorkday.dayStartAt, record.time)
    })))
  }, [editingWorkday, workdayRecords])

  useEffect(() => {
    if (!dashboard?.settings) return
    setAutomaticLunchEnabled(dashboard.settings.automaticLunchEndEnabled)
    setAutomaticLunchMinutes(dashboard.settings.automaticLunchMinutes)
  }, [dashboard?.settings?.automaticLunchEndEnabled, dashboard?.settings?.automaticLunchMinutes])

  useEffect(() => {
    if (!dashboard?.settings) return
    setGeofenceEnabled(dashboard.settings.geofenceEnabled)
    setGeofenceAddress(dashboard.settings.geofenceAddress)
    setGeofenceLatitude(dashboard.settings.geofenceLatitude ?? null)
    setGeofenceLongitude(dashboard.settings.geofenceLongitude ?? null)
    setGeofenceRadiusFeet(dashboard.settings.geofenceRadiusFeet)
    setGeofenceMaxAccuracyFeet(dashboard.settings.geofenceMaxAccuracyFeet)
    setGeofencePointAccuracyFeet(dashboard.settings.geofencePointAccuracyFeet)
    setGeofenceRequiredActions(dashboard.settings.geofenceRequiredActions)
  }, [dashboard?.settings])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function create(event) {
    event.preventDefault()
    const name = employeeName.trim()
    if (!name) return
    setError('')
    setNotice('')
    setBusyEmployee('new')
    const code = makeEnrollmentCode()
    try {
      const id = await createEmployee({
        name,
        enrollmentCodeHash: await hashValue(code),
        enrollmentCodeExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      })
      setIssuedCodes((current) => ({ ...current, [id]: code }))
      setEmployeeName('')
      setNotice(`${name} was added. Give them the enrollment code shown below.`)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'The employee could not be added.')
    } finally {
      setBusyEmployee('')
    }
  }

  async function regenerate(employee) {
    setError('')
    setNotice('')
    setBusyEmployee(employee._id)
    const code = makeEnrollmentCode()
    try {
      await issueEnrollmentCode({
        employeeId: employee._id,
        enrollmentCodeHash: await hashValue(code),
        enrollmentCodeExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      })
      setIssuedCodes((current) => ({ ...current, [employee._id]: code }))
      setNotice(`New enrollment code created for ${employee.name}.`)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'A new code could not be created.')
    } finally {
      setBusyEmployee('')
    }
  }

  async function toggleEmployee(employee) {
    setError('')
    setNotice('')
    setBusyEmployee(employee._id)
    try {
      await setEmployeeActive({ employeeId: employee._id, active: !employee.active })
      setNotice(`${employee.name} is now ${employee.active ? 'inactive' : 'active'}.`)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'The employee status could not be changed.')
    } finally {
      setBusyEmployee('')
    }
  }

  function openManagerAction(employee, eventType) {
    setError('')
    setNotice('')
    setManagerAction({ employee, eventType })
    setManagerOccurredAt(formatEasternDateTimeInput(Date.now()))
    setManagerNote('')
  }

  async function confirmManagerAction(event) {
    event.preventDefault()
    if (!managerAction) return
    const occurredAt = parseEasternDateTimeInput(managerOccurredAt)
    if (!Number.isFinite(occurredAt)) {
      setError('Enter a valid Eastern Time for this clock action.')
      return
    }

    setError('')
    setNotice('')
    setSavingManagerAction(true)
    try {
      const result = await adminRecordEvent({
        employeeId: managerAction.employee._id,
        eventType: managerAction.eventType,
        occurredAt,
        note: managerNote.trim() || undefined
      })
      setNotice(`${result.employeeName}: ${eventLabels[result.eventType]} recorded for ${formatTime(result.occurredAt)}.`)
      setManagerAction(null)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'The manager clock action could not be recorded.')
    } finally {
      setSavingManagerAction(false)
    }
  }

  function openWorkdayEditor(employee, dayIndex) {
    const dayStartAt = weekBounds.dayStarts[dayIndex]
    const dayEndAt = weekBounds.dayStarts[dayIndex + 1]
    const records = weeklyEvents
      .filter((event) => String(event.employeeId) === String(employee.employeeId) && event.occurredAt >= dayStartAt && event.occurredAt < dayEndAt)
      .sort((left, right) => left.occurredAt - right.occurredAt)
      .map((event) => ({ key: String(event._id), eventType: event.eventType, time: formatEasternTimeInput(event.occurredAt) }))
    setError('')
    setNotice('')
    setEditingWorkday({ employee, dayIndex, dayStartAt, dayEndAt })
    setWorkdayRecords(records)
    setCorrectionReason('')
  }

  function updateWorkdayRecord(key, field, value) {
    setWorkdayRecords((current) => current.map((record) => record.key === key ? { ...record, [field]: value } : record))
  }

  function addWorkdayRecord() {
    const sorted = [...workdayRecords].sort((left, right) => left.time.localeCompare(right.time))
    const latest = sorted[sorted.length - 1]
    const nextType = !latest || latest.eventType === 'clock_out'
      ? 'clock_in'
      : latest.eventType === 'lunch_start'
        ? 'lunch_end'
        : 'clock_out'
    const nextTime = latest
      ? (() => {
          const [hour, minute] = latest.time.split(':').map(Number)
          const totalMinutes = Math.min(23 * 60 + 59, hour * 60 + minute + (latest.eventType === 'lunch_start' ? 30 : 60))
          return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
        })()
      : '09:00'
    setWorkdayRecords((current) => [...current, { key: `new-${Date.now()}-${current.length}`, eventType: nextType, time: nextTime }])
  }

  async function saveWorkdayCorrection(event) {
    event.preventDefault()
    if (!editingWorkday) return
    const reason = correctionReason.trim()
    if (!reason) {
      setError('Enter a reason for the payroll correction.')
      return
    }

    setError('')
    setNotice('')
    setSavingCorrection(true)
    try {
      const result = await adminReplaceWorkday({
        employeeId: editingWorkday.employee.employeeId,
        dayStartAt: editingWorkday.dayStartAt,
        dayEndAt: editingWorkday.dayEndAt,
        events: workdayRecords.map((record) => ({
          eventType: record.eventType,
          occurredAt: timestampForEasternDayTime(editingWorkday.dayStartAt, record.time)
        })),
        reason
      })
      setNotice(`${result.employeeName}'s ${formatDayHeading(editingWorkday.dayStartAt)} payroll hours were corrected.`)
      setEditingWorkday(null)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'The payroll correction could not be saved.')
    } finally {
      setSavingCorrection(false)
    }
  }

  function downloadSchedule() {
    if (!weeklySummary) return
    setError('')
    setDownloadingSchedule(true)
    try {
      downloadPayrollPdf({
        dayStarts: weekBounds.dayStarts,
        employees: weeklyEmployees,
        dailyTotals,
        weeklyTotal,
        generatedAt: Date.now()
      })
    } catch (downloadError) {
      setError(downloadError?.message || 'The payroll schedule could not be downloaded.')
    } finally {
      setDownloadingSchedule(false)
    }
  }

  async function confirmDeleteEmployee() {
    if (!employeeToDelete) return
    setError('')
    setNotice('')
    setDeletingEmployee(true)
    try {
      const result = await deleteEmployee({ employeeId: employeeToDelete._id })
      setIssuedCodes((current) => {
        const next = { ...current }
        delete next[employeeToDelete._id]
        return next
      })
      setNotice(`${result.employeeName} and all associated time-clock data were permanently deleted.`)
      setEmployeeToDelete(null)
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'The employee could not be deleted.')
    } finally {
      setDeletingEmployee(false)
    }
  }

  async function copyClockUrl() {
    if (!clockUrl) return
    await navigator.clipboard.writeText(clockUrl)
    setNotice('Clock URL copied. This is the exact URL to write to each NFC tag.')
  }

  async function saveLunchSettings(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setSavingLunchSettings(true)
    try {
      await updateLunchSettings({
        automaticLunchEndEnabled: automaticLunchEnabled,
        automaticLunchMinutes: Number(automaticLunchMinutes)
      })
      setNotice(automaticLunchEnabled
        ? `Automatic lunch end is enabled after ${automaticLunchMinutes} minutes.`
        : 'Automatic lunch end is disabled. Employees must end lunch themselves.')
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'Lunch settings could not be saved.')
    } finally {
      setSavingLunchSettings(false)
    }
  }

  async function captureShopLocation() {
    setError('')
    setNotice('')
    setCapturingShopLocation(true)
    try {
      const position = await requestBrowserLocation()
      setGeofenceLatitude(position.coords.latitude)
      setGeofenceLongitude(position.coords.longitude)
      setGeofencePointAccuracyFeet(Math.round(position.coords.accuracy * 3.28084))
      setNotice('Shop location captured from this device. Review the radius, then save the location policy.')
    } catch (locationError) {
      setError(locationPermissionMessage(locationError))
    } finally {
      setCapturingShopLocation(false)
    }
  }

  function toggleGeofenceActions(actions, enabled) {
    setGeofenceRequiredActions((current) => {
      const next = new Set(current)
      for (const action of actions) enabled ? next.add(action) : next.delete(action)
      return Array.from(next)
    })
  }

  async function saveGeofenceSettings(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setSavingGeofence(true)
    try {
      await updateGeofenceSettings({
        enabled: geofenceEnabled,
        address: geofenceAddress,
        latitude: geofenceLatitude ?? undefined,
        longitude: geofenceLongitude ?? undefined,
        radiusFeet: Number(geofenceRadiusFeet),
        maxAccuracyFeet: Number(geofenceMaxAccuracyFeet),
        pointAccuracyFeet: geofencePointAccuracyFeet ?? undefined,
        requiredActions: geofenceRequiredActions
      })
      setNotice(geofenceEnabled
        ? `Location verification is enabled within ${geofenceRadiusFeet} feet of Car Craft.`
        : 'Location verification is disabled.')
    } catch (requestError) {
      setError(requestError?.data || requestError?.message || 'Location settings could not be saved.')
    } finally {
      setSavingGeofence(false)
    }
  }

  function exportEvents() {
    const rows = [
      ['Employee', 'Action', 'Time (Eastern)', 'Location', 'Source'],
      ...weeklyEvents.map((event) => [
        event.employeeName,
        eventLabels[event.eventType],
        new Date(event.occurredAt).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        event.locationName,
        event.source
      ])
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `car-craft-time-clock-${formatWeekRange(weekBounds.dayStarts).replaceAll(' ', '-').replace('–', '-to-')}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  if (dashboard === undefined) {
    return <section className="module payroll-module"><div className="loading-card">Loading employee time clock…</div></section>
  }

  return (
    <section className="module payroll-module">
      <div className="module-intro">
        <div>
          <p className="eyebrow">NFC time clock</p>
          <h2>Employee timecards</h2>
          <p>Review weekly timecards or manage employee clock configuration.</p>
        </div>
        <div className="payroll-view-actions">
          <div className="payroll-view-tabs" role="tablist" aria-label="Payroll sections">
            <button className={payrollView === 'calendar' ? 'active' : ''} type="button" role="tab" aria-selected={payrollView === 'calendar'} onClick={() => setPayrollView('calendar')}>Calendar & Activity</button>
            <button className={payrollView === 'configuration' ? 'active' : ''} type="button" role="tab" aria-selected={payrollView === 'configuration'} onClick={() => setPayrollView('configuration')}>Configuration</button>
          </div>
          <span className="integration-badge integration-badge-live">Live</span>
        </div>
      </div>

      {notice ? <div className="admin-notice success">{notice}</div> : null}
      {error ? <div className="admin-notice error">{error}</div> : null}

      {payrollView === 'calendar' ? <>
      <div className="payroll-section payroll-overview-section">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Overview</p><h2>Today at a glance</h2></div>
        </div>
        <div className="stats-grid compact payroll-stats">
        <article className="stat-card"><span>Clocked in now</span><strong>{stats.working}</strong><small>Currently working</small></article>
        <article className="stat-card"><span>On lunch</span><strong>{stats.lunch}</strong><small>Lunch in progress</small></article>
        <article className="stat-card"><span>Active employees</span><strong>{stats.active}</strong><small>Allowed to use the clock</small></article>
        <article className="stat-card"><span>Selected week entries</span><strong>{stats.entries}</strong><small>{formatWeekRange(weekBounds.dayStarts)}</small></article>
        </div>
      </div>

      <div className="payroll-section manager-clock-section">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Manager controls</p><h2>Adjust current clock status</h2><p>Record a missed clock-in, lunch action, or clock-out. Every adjustment is labeled as an admin record in the activity log.</p></div>
        </div>
        <div className="employee-clock-grid">
          {employees.filter((employee) => employee.active).map((employee) => (
            <article className="employee-clock-card" key={employee._id}>
              <div className="manager-clock-heading">
                <div><h3>{employee.name}</h3><small>{employee.lastEventAt ? `Last action ${formatTime(employee.lastEventAt)}` : 'No clock activity yet'}</small></div>
                <span className={`status-pill clock-${employee.clockState}`}>{stateLabels[employee.clockState]}</span>
              </div>
              <div className="manager-clock-actions">
                {managerActionsFor(employee.clockState).map((action) => (
                  <button
                    className={`ghost-btn small ${action === 'clock_out' ? 'manager-clock-out-btn' : ''}`}
                    type="button"
                    key={action}
                    onClick={() => openManagerAction(employee, action)}
                  >
                    {eventLabels[action]}
                  </button>
                ))}
              </div>
            </article>
          ))}
          {!employees.some((employee) => employee.active) ? <div className="empty-command-card">Add or reactivate an employee to use manager clock controls.</div> : null}
        </div>
      </div>

      <div className="payroll-section weekly-hours-section">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Weekly timesheet</p><h2>{formatWeekRange(weekBounds.dayStarts)}</h2><p>Daily paid hours for every employee. Lunch breaks are excluded.</p></div>
          <div className="weekly-header-actions">
            <div className="week-navigation" aria-label="Choose payroll week">
              <button className="ghost-btn small" type="button" onClick={() => setSelectedWeekOffset((current) => current - 1)}>← Previous</button>
              <button className="ghost-btn small" type="button" disabled={selectedWeekOffset === 0} onClick={() => setSelectedWeekOffset(0)}>Current Period</button>
              <button className="ghost-btn small" type="button" disabled={selectedWeekOffset === 0} onClick={() => setSelectedWeekOffset((current) => Math.min(0, current + 1))}>Next →</button>
            </div>
            <button className="primary-btn payroll-download-btn" type="button" disabled={weeklySummary === undefined || !weeklyEmployees.some((employee) => employee.workedMilliseconds > 0) || downloadingSchedule} onClick={downloadSchedule}>
              {downloadingSchedule ? 'Preparing PDF…' : 'Download Schedule'}
            </button>
            <span className="weekly-reset-note">Saturday and Sunday show the completed Monday–Friday payroll period.</span>
          </div>
        </div>
        <div className="weekly-calendar-wrap">
          <table className="weekly-calendar-table">
            <thead>
              <tr>
                <th className="weekly-employee-column">Employee</th>
                {weekBounds.dayStarts.slice(0, 5).map((dayStart) => {
                  const isToday = easternDateKey(dayStart) === todayKey
                  return <th className={isToday ? 'weekly-today-column' : ''} key={dayStart}><strong>{formatDayHeading(dayStart)}</strong>{isToday ? <small>Today</small> : null}</th>
                })}
                <th className="weekly-total-column">Week total</th>
              </tr>
            </thead>
            <tbody>
              {weeklySummary === undefined ? <tr><td className="weekly-calendar-loading" colSpan="7">Calculating daily hours…</td></tr> : null}
              {weeklyEmployees.map((employee) => (
                <tr className={employee.active ? '' : 'weekly-employee-inactive'} key={employee.employeeId}>
                  <th className="weekly-employee-column" scope="row"><strong>{employee.employeeName}</strong><small>{employee.currentlyWorking ? 'Clocked in now' : employee.active ? 'Not clocked in' : 'Inactive'}</small></th>
                  {weekBounds.dayStarts.slice(0, 5).map((dayStart, dayIndex) => {
                    const canEdit = weekBounds.dayStarts[dayIndex + 1] <= clockNow
                    return (
                      <td className={easternDateKey(dayStart) === todayKey ? 'weekly-today-column' : ''} key={dayStart}>
                        {canEdit ? (
                          <button className="weekly-hours-edit-btn" type="button" onClick={() => openWorkdayEditor(employee, dayIndex)}>
                            <strong>{formatCalendarHours(employee.dailyMilliseconds?.[dayIndex] || 0)}</strong>
                            <small>Edit</small>
                          </button>
                        ) : <strong>{formatCalendarHours(employee.dailyMilliseconds?.[dayIndex] || 0)}</strong>}
                      </td>
                    )
                  })}
                  <td className="weekly-total-column"><strong>{formatHours(employee.workedMilliseconds)}</strong></td>
                </tr>
              ))}
              {weeklySummary && !weeklyEmployees.length ? <tr><td className="weekly-calendar-loading" colSpan="7">Add an employee to begin weekly tracking.</td></tr> : null}
            </tbody>
            {weeklySummary && weeklyEmployees.length ? (
              <tfoot><tr>
                <th className="weekly-employee-column" scope="row">Team total</th>
                {dailyTotals.map((total, dayIndex) => <td className={easternDateKey(weekBounds.dayStarts[dayIndex]) === todayKey ? 'weekly-today-column' : ''} key={weekBounds.dayStarts[dayIndex]}><strong>{formatCalendarHours(total)}</strong></td>)}
                <td className="weekly-total-column"><strong>{formatHours(weeklyTotal)}</strong></td>
              </tr></tfoot>
            ) : null}
          </table>
        </div>
        <p className="weekly-calendar-note">Hours update every minute while someone is clocked in. Each Monday-Friday period closes at midnight Saturday and remains available for corrections and payroll downloads.</p>
      </div>
      </> : null}

      {payrollView === 'configuration' ? <>
      <div className="payroll-section configuration-section-first">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Setup & policy</p><h2>How the clock operates</h2><p>Manage the NFC destination and lunch rules in one place.</p></div>
        </div>
        <div className="payroll-settings-grid">
          <article className="setup-card clock-url-card">
            <div>
              <p className="eyebrow">Clock location</p>
              <h3>{location?.name || 'Clock location not configured'}</h3>
              <p>Program every wall tag with this URL. Tags open the clock but never store employee information.</p>
            </div>
            {clockUrl ? <code className="clock-url">{clockUrl}</code> : <div className="empty-command-card">Run the clock-location setup before programming tags.</div>}
            <button className="primary-btn" type="button" disabled={!clockUrl} onClick={copyClockUrl}>{clockIcon} Copy NFC URL</button>
          </article>

          <article className="setup-card lunch-policy-card">
            <div>
              <p className="eyebrow">Lunch policy</p>
              <h3>Automatic lunch end</h3>
              <p>Optionally return employees to clocked-in status after a fixed break.</p>
            </div>
            <form className="lunch-policy-form" onSubmit={saveLunchSettings}>
              <label className="lunch-toggle">
                <input type="checkbox" checked={automaticLunchEnabled} onChange={(event) => setAutomaticLunchEnabled(event.target.checked)} />
                <span>Enable automatic lunch end</span>
              </label>
              <label className="lunch-duration">
                <span>Lunch duration</span>
                <div><input type="number" min="15" max="180" step="1" disabled={!automaticLunchEnabled} value={automaticLunchMinutes} onChange={(event) => setAutomaticLunchMinutes(event.target.value)} /><strong>minutes</strong></div>
              </label>
              <p className="control-note">Employees can still end lunch early. When disabled, they must tap End Lunch themselves.</p>
              <button className="primary-btn" type="submit" disabled={savingLunchSettings || (automaticLunchEnabled && (Number(automaticLunchMinutes) < 15 || Number(automaticLunchMinutes) > 180))}>{savingLunchSettings ? 'Saving…' : 'Save Lunch Policy'}</button>
            </form>
          </article>

          <article className="setup-card notification-policy-card">
            <div className="notification-card-heading">
              <div>
                <p className="eyebrow">Pushover alerts</p>
                <h3>Manager time-clock notifications</h3>
                <p>The configured manager receives the employee name and Eastern Time for every clock-in, lunch action, and clock-out.</p>
              </div>
              <span className={`integration-badge ${dashboard.settings.pushoverConfigured ? 'integration-badge-live' : ''}`}>{dashboard.settings.pushoverConfigured ? 'Connected' : 'Needs setup'}</span>
            </div>
            <div className="notification-policy-list">
              <div><strong>Instant activity alerts</strong><span>Employee and administrator clock actions</span></div>
              <div><strong>Missing clock-out reminder</strong><span>Weekdays at {dashboard.settings.missingClockOutReminderTime}</span></div>
              <div><strong>Day-off protection</strong><span>Only employees who clocked in that day are checked</span></div>
            </div>
            {!dashboard.settings.pushoverConfigured ? <p className="control-note notification-warning">Add PUSHOVER_API_TOKEN and PUSHOVER_USER_KEY to the Convex deployment to activate delivery.</p> : null}
          </article>

          <article className="setup-card geofence-policy-card">
            <div className="geofence-card-heading">
              <div>
                <p className="eyebrow">Location verification</p>
                <h3>Require employees to be on site</h3>
                <p>The phone’s location is checked by the server before protected actions are recorded. Exact employee coordinates are not saved.</p>
              </div>
              <span className={`integration-badge ${geofenceEnabled ? 'integration-badge-live' : ''}`}>{geofenceEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <form className="geofence-policy-form" onSubmit={saveGeofenceSettings}>
              <label className="lunch-toggle">
                <input type="checkbox" checked={geofenceEnabled} onChange={(event) => setGeofenceEnabled(event.target.checked)} />
                <span>Enable on-site location verification</span>
              </label>

              <div className="geofence-config-grid">
                <div className="geofence-location-panel">
                  <label>Shop address<input value={geofenceAddress} maxLength="160" onChange={(event) => setGeofenceAddress(event.target.value)} /></label>
                  <div className={`shop-point-status ${geofenceLatitude !== null && geofenceLongitude !== null ? 'ready' : ''}`}>
                    <strong>{geofenceLatitude !== null && geofenceLongitude !== null ? 'Shop point saved' : 'Shop point required'}</strong>
                    <span>{geofenceLatitude !== null && geofenceLongitude !== null
                      ? `Center point is ready${geofencePointAccuracyFeet ? ` · captured within ${geofencePointAccuracyFeet} ft` : ''}.`
                      : 'Stand at Car Craft and capture this device’s current location.'}</span>
                  </div>
                  <button className="ghost-btn" type="button" disabled={capturingShopLocation} onClick={captureShopLocation}>{capturingShopLocation ? 'Finding Location…' : 'Set Shop Location From This Device'}</button>
                </div>

                <div className="geofence-rules-panel">
                  <div className="geofence-number-grid">
                    <label>Allowed radius<input type="number" min="100" max="1000" step="25" value={geofenceRadiusFeet} onChange={(event) => setGeofenceRadiusFeet(event.target.value)} /><span>feet from the saved shop point</span></label>
                    <label>Maximum GPS uncertainty<input type="number" min="50" max="500" step="25" value={geofenceMaxAccuracyFeet} onChange={(event) => setGeofenceMaxAccuracyFeet(event.target.value)} /><span>reject less-accurate readings</span></label>
                  </div>
                  <fieldset className="geofence-actions">
                    <legend>Require location for</legend>
                    <label><input type="checkbox" checked={geofenceRequiredActions.includes('clock_in')} onChange={(event) => toggleGeofenceActions(['clock_in'], event.target.checked)} /> Clock In</label>
                    <label><input type="checkbox" checked={geofenceRequiredActions.includes('lunch_start') && geofenceRequiredActions.includes('lunch_end')} onChange={(event) => toggleGeofenceActions(['lunch_start', 'lunch_end'], event.target.checked)} /> Lunch actions</label>
                    <label><input type="checkbox" checked={geofenceRequiredActions.includes('clock_out')} onChange={(event) => toggleGeofenceActions(['clock_out'], event.target.checked)} /> Clock Out</label>
                  </fieldset>
                </div>
              </div>

              <p className="control-note geofence-privacy-note">Recommended: Clock In only, 350-foot radius, and 200-foot maximum uncertainty. Employees must grant browser location permission when prompted.</p>
              <button className="primary-btn" type="submit" disabled={savingGeofence || (geofenceEnabled && (geofenceLatitude === null || geofenceLongitude === null || geofenceRequiredActions.length === 0))}>{savingGeofence ? 'Saving…' : 'Save Location Policy'}</button>
            </form>
          </article>
        </div>
      </div>

      <div className="payroll-section">
        <div className="payroll-section-header payroll-employee-header">
          <div><p className="eyebrow">Employees</p><h2>Access & enrollment</h2><p>Add staff, issue phone codes, or remove old accounts and records.</p></div>
        </div>
        <article className="setup-card employee-create-panel">
          <div><h3>Add an employee</h3><p>Create a one-time phone enrollment code that expires in seven days.</p></div>
          <form className="employee-create-form employee-create-inline" onSubmit={create}>
            <label>Employee full name<input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Example: Alex Rivera" maxLength="80" /></label>
            <button className="primary-btn" disabled={busyEmployee === 'new' || !employeeName.trim()} type="submit">{busyEmployee === 'new' ? 'Adding…' : 'Add Employee'}</button>
          </form>
        </article>

        <div className="table-wrap employee-management-wrap">
          <table className="employee-management-table">
            <thead><tr><th>Employee</th><th>Current status</th><th>Last activity</th><th>Enrollment</th><th>Actions</th></tr></thead>
            <tbody>
              {employees.map((employee) => (
                <tr className={employee.active ? '' : 'employee-row-inactive'} key={employee._id}>
                  <td><div className="employee-name-cell"><strong>{employee.name}</strong><small>{employee.active ? 'Access enabled' : 'Access disabled'}</small></div></td>
                  <td><span className={`status-pill clock-${employee.clockState}`}>{employee.active ? stateLabels[employee.clockState] : 'Inactive'}</span></td>
                  <td>{employee.lastEventAt ? formatTime(employee.lastEventAt) : <span className="muted">No entries yet</span>}</td>
                  <td>
                    {issuedCodes[employee._id] ? (
                      <div className="employee-code-cell"><strong>{issuedCodes[employee._id]}</strong><small>Expires in 7 days</small></div>
                    ) : employee.enrollmentPending ? (
                      <span className="status-pill enrollment-pending-pill">Code active</span>
                    ) : <span className="muted">Phone connected</span>}
                  </td>
                  <td><div className="employee-actions">
                    <button className="ghost-btn small" type="button" disabled={busyEmployee === employee._id} onClick={() => regenerate(employee)}>New Code</button>
                    <button className="ghost-btn small" type="button" disabled={busyEmployee === employee._id} onClick={() => toggleEmployee(employee)}>{employee.active ? 'Deactivate' : 'Reactivate'}</button>
                    <button className="delete-btn small" type="button" disabled={busyEmployee === employee._id} onClick={() => setEmployeeToDelete(employee)}>Delete</button>
                  </div></td>
                </tr>
              ))}
              {!employees.length ? <tr><td colSpan="5" className="empty-cell"><div className="table-empty-state"><span className="table-empty-icon">+</span><strong>No employees yet</strong><span>Add the first employee above to create an enrollment code.</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      </> : null}

      {payrollView === 'calendar' ? <div className="payroll-section">
        <div className="payroll-section-header payroll-activity-header">
          <div><p className="eyebrow">Activity</p><h2>{formatWeekRange(weekBounds.dayStarts)} clock events</h2><p>Clock, lunch, and clock-out records for the selected week.</p></div>
          <button className="ghost-btn" type="button" disabled={!weeklyEvents.length} onClick={exportEvents}>Export This Week</button>
        </div>
        <div className="table-wrap">
          <table>
          <thead><tr><th>Employee</th><th>Action</th><th>Time (Eastern)</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>
            {weeklyEvents.map((event) => (
              <tr key={event._id}>
                <td><strong>{event.employeeName}</strong></td>
                <td>
                  {eventLabels[event.eventType]}
                  {event.locationVerified ? <span className="verified-location-note">On-site verified · {Math.round(event.locationDistanceMeters * 3.28084)} ft from shop</span> : null}
                  {event.note ? <span>{event.note}</span> : null}
                </td>
                <td>{formatTime(event.occurredAt)}</td>
                <td>{event.locationName}</td>
                <td><span className="status-pill">{event.source.toUpperCase()}</span></td>
              </tr>
            ))}
            {weeklySummary === undefined ? <tr><td colSpan="5" className="empty-cell"><div className="table-empty-state"><span className="table-empty-icon">{clockIcon}</span><strong>Loading this week</strong><span>Retrieving the selected week’s activity.</span></div></td></tr> : null}
            {weeklySummary && !weeklyEvents.length ? <tr><td colSpan="5" className="empty-cell"><div className="table-empty-state"><span className="table-empty-icon">{clockIcon}</span><strong>No activity this week</strong><span>Choose another week or wait for employees to use the clock.</span></div></td></tr> : null}
          </tbody>
          </table>
        </div>
      </div> : null}

      {managerAction ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingManagerAction) setManagerAction(null) }}>
          <section className="modal-card manager-clock-modal" role="dialog" aria-modal="true" aria-labelledby="manager-clock-title">
            <div className="modal-header">
              <div><p className="eyebrow">Manager adjustment</p><h2 id="manager-clock-title">{eventLabels[managerAction.eventType]} {managerAction.employee.name}?</h2></div>
              <span className={`status-pill clock-${managerAction.employee.clockState}`}>{stateLabels[managerAction.employee.clockState]}</span>
            </div>
            {error ? <div className="admin-notice error">{error}</div> : null}
            <form className="manager-clock-form" onSubmit={confirmManagerAction}>
              <label>
                <span>Effective time (Eastern)</span>
                <input type="datetime-local" step="1" required value={managerOccurredAt} onChange={(event) => setManagerOccurredAt(event.target.value)} />
              </label>
              <label>
                <span>Manager note <small>Optional</small></span>
                <textarea value={managerNote} maxLength="240" rows="3" placeholder="Example: Employee forgot to clock out before leaving." onChange={(event) => setManagerNote(event.target.value)} />
              </label>
              <p className="control-note">This creates a permanent activity entry marked ADMIN and sends the manager’s Pushover alert.</p>
              <div className="modal-actions">
                <button className="ghost-btn" type="button" disabled={savingManagerAction} onClick={() => setManagerAction(null)}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={savingManagerAction}>{savingManagerAction ? 'Recording…' : `Confirm ${eventLabels[managerAction.eventType]}`}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingWorkday ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCorrection) setEditingWorkday(null) }}>
          <section className="modal-card payroll-correction-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-correction-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Payroll correction</p>
                <h2 id="payroll-correction-title">{editingWorkday.employee.employeeName} · {formatDayHeading(editingWorkday.dayStartAt)}</h2>
                <p>Edit the clock records below. Paid time recalculates automatically.</p>
              </div>
              <span className="correction-hours-total">{formatHours(editingWorkdayHours)}</span>
            </div>
            {error ? <div className="admin-notice error">{error}</div> : null}
            <form className="payroll-correction-form" onSubmit={saveWorkdayCorrection}>
              <div className="correction-records">
                {workdayRecords.map((record) => (
                  <div className="correction-record-row" key={record.key}>
                    <label><span>Action</span><select value={record.eventType} onChange={(event) => updateWorkdayRecord(record.key, 'eventType', event.target.value)}>
                      {Object.entries(eventLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select></label>
                    <label><span>Eastern time</span><input type="time" step="60" required value={record.time} onChange={(event) => updateWorkdayRecord(record.key, 'time', event.target.value)} /></label>
                    <button className="delete-btn small correction-remove-btn" type="button" onClick={() => setWorkdayRecords((current) => current.filter((item) => item.key !== record.key))}>Remove</button>
                  </div>
                ))}
                {!workdayRecords.length ? <div className="empty-command-card">No paid hours will be recorded for this employee on this day.</div> : null}
              </div>
              <button className="ghost-btn small correction-add-btn" type="button" onClick={addWorkdayRecord}>+ Add clock record</button>
              <label><span>Reason for correction</span><textarea maxLength="240" required value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Example: Corrected missed clock-out using the manager's written record." /></label>
              <p className="form-help">The original and corrected clock records are retained in the payroll audit log.</p>
              <div className="modal-actions">
                <button className="ghost-btn" type="button" disabled={savingCorrection} onClick={() => setEditingWorkday(null)}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={savingCorrection}>{savingCorrection ? 'Saving…' : 'Save Correction'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {employeeToDelete ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingEmployee) setEmployeeToDelete(null) }}>
          <section className="modal-card delete-confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-employee-title">
            <div className="modal-header"><div><p className="eyebrow">Permanent deletion</p><h2 id="delete-employee-title">Delete {employeeToDelete.name}?</h2></div></div>
            <div className="delete-confirm-body">
              <strong>This cannot be undone.</strong>
              <p>This permanently removes the employee, their enrollment code, every remembered phone session, and all clock, lunch, and clock-out records.</p>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" type="button" disabled={deletingEmployee} onClick={() => setEmployeeToDelete(null)}>Cancel</button>
              <button className="delete-btn danger-fill" type="button" disabled={deletingEmployee} onClick={confirmDeleteEmployee}>{deletingEmployee ? 'Deleting…' : 'Delete Employee & Records'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
