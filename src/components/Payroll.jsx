import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

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
  date.setUTCDate(date.getUTCDate() - ((weekdayIndex + 1) % 7))
  const startAt = easternMidnightUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  const dayStarts = Array.from({ length: 6 }, (_, index) => {
    const day = new Date(date)
    day.setUTCDate(day.getUTCDate() + index + 2)
    return easternMidnightUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate())
  })
  return { startAt, endAt: dayStarts[5], dayStarts }
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
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric' }).format(new Date(timestamp))
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

export default function Payroll() {
  const dashboard = useQuery(api.timeClock.adminDashboard)
  const [payrollView, setPayrollView] = useState('calendar')
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0)
  const selectedWeekReference = useMemo(() => clockNow + selectedWeekOffset * 7 * 24 * 60 * 60 * 1000, [clockNow, selectedWeekOffset])
  const weekBounds = useMemo(() => getEasternWeekBounds(selectedWeekReference), [selectedWeekReference])
  const weeklySummary = useQuery(api.timeClock.adminWeeklySummary, {
    ...weekBounds,
    asOf: selectedWeekOffset === 0 ? Math.floor(clockNow / 60000) * 60000 : weekBounds.endAt
  })
  const createEmployee = useMutation(api.timeClock.createEmployee)
  const issueEnrollmentCode = useMutation(api.timeClock.issueEnrollmentCode)
  const setEmployeeActive = useMutation(api.timeClock.setEmployeeActive)
  const deleteEmployee = useMutation(api.timeClock.deleteEmployee)
  const updateLunchSettings = useMutation(api.timeClock.updateLunchSettings)
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

  useEffect(() => {
    if (!dashboard?.settings) return
    setAutomaticLunchEnabled(dashboard.settings.automaticLunchEndEnabled)
    setAutomaticLunchMinutes(dashboard.settings.automaticLunchMinutes)
  }, [dashboard?.settings?.automaticLunchEndEnabled, dashboard?.settings?.automaticLunchMinutes])

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
        <div className="payroll-section-header"><div><p className="eyebrow">Overview</p><h2>Today at a glance</h2></div></div>
        <div className="stats-grid compact payroll-stats">
          <article className="stat-card"><span>Clocked in now</span><strong>{stats.working}</strong><small>Currently working</small></article>
          <article className="stat-card"><span>On lunch</span><strong>{stats.lunch}</strong><small>Lunch in progress</small></article>
          <article className="stat-card"><span>Active employees</span><strong>{stats.active}</strong><small>Allowed to use the clock</small></article>
        <article className="stat-card"><span>Selected week entries</span><strong>{stats.entries}</strong><small>{formatWeekRange(weekBounds.dayStarts)}</small></article>
        </div>
      </div>

      <div className="payroll-section weekly-hours-section">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Weekly timesheet</p><h2>{formatWeekRange(weekBounds.dayStarts)}</h2><p>Daily paid hours for every employee. Lunch breaks are excluded.</p></div>
          <div className="week-navigation" aria-label="Choose payroll week">
            <button className="ghost-btn small" type="button" onClick={() => setSelectedWeekOffset((current) => current - 1)}>← Previous</button>
            <button className="ghost-btn small" type="button" disabled={selectedWeekOffset === 0} onClick={() => setSelectedWeekOffset(0)}>This Week</button>
            <button className="ghost-btn small" type="button" disabled={selectedWeekOffset === 0} onClick={() => setSelectedWeekOffset((current) => Math.min(0, current + 1))}>Next →</button>
            <span className="weekly-reset-note">Resets Saturday at 12:00 a.m. ET</span>
          </div>
        </div>
        <div className="weekly-calendar-wrap">
          <table className="weekly-calendar-table">
            <thead><tr>
              <th className="weekly-employee-column">Employee</th>
              {weekBounds.dayStarts.slice(0, 5).map((dayStart) => {
                const isToday = easternDateKey(dayStart) === todayKey
                return <th className={isToday ? 'weekly-today-column' : ''} key={dayStart}><strong>{formatDayHeading(dayStart)}</strong>{isToday ? <small>Today</small> : null}</th>
              })}
              <th className="weekly-total-column">Week total</th>
            </tr></thead>
            <tbody>
              {weeklySummary === undefined ? <tr><td className="weekly-calendar-loading" colSpan="7">Calculating daily hours…</td></tr> : null}
              {weeklyEmployees.map((employee) => (
                <tr className={employee.active ? '' : 'weekly-employee-inactive'} key={employee.employeeId}>
                  <th className="weekly-employee-column" scope="row"><strong>{employee.employeeName}</strong><small>{employee.currentlyWorking ? 'Clocked in now' : employee.active ? 'Not clocked in' : 'Inactive'}</small></th>
                  {weekBounds.dayStarts.slice(0, 5).map((dayStart, dayIndex) => <td className={easternDateKey(dayStart) === todayKey ? 'weekly-today-column' : ''} key={dayStart}><strong>{formatCalendarHours(employee.dailyMilliseconds?.[dayIndex] || 0)}</strong></td>)}
                  <td className="weekly-total-column"><strong>{formatHours(employee.workedMilliseconds)}</strong></td>
                </tr>
              ))}
              {weeklySummary && !weeklyEmployees.length ? <tr><td className="weekly-calendar-loading" colSpan="7">Add an employee to begin weekly tracking.</td></tr> : null}
            </tbody>
            {weeklySummary && weeklyEmployees.length ? <tfoot><tr>
              <th className="weekly-employee-column" scope="row">Team total</th>
              {dailyTotals.map((total, dayIndex) => <td className={easternDateKey(weekBounds.dayStarts[dayIndex]) === todayKey ? 'weekly-today-column' : ''} key={weekBounds.dayStarts[dayIndex]}><strong>{formatCalendarHours(total)}</strong></td>)}
              <td className="weekly-total-column"><strong>{formatHours(weeklyTotal)}</strong></td>
            </tr></tfoot> : null}
          </table>
        </div>
        <p className="weekly-calendar-note">Hours update every minute while someone is clocked in. The display starts fresh each Saturday; detailed activity remains saved below.</p>
      </div>
      </> : null}

      {payrollView === 'configuration' ? <>
      <div className="payroll-section configuration-section-first">
        <div className="payroll-section-header"><div><p className="eyebrow">Setup & policy</p><h2>How the clock operates</h2><p>Manage the NFC destination and lunch rules in one place.</p></div></div>
        <div className="payroll-settings-grid">
          <article className="setup-card clock-url-card">
            <div><p className="eyebrow">Clock location</p><h3>{location?.name || 'Clock location not configured'}</h3><p>Program every wall tag with this URL. Tags open the clock but never store employee information.</p></div>
            {clockUrl ? <code className="clock-url">{clockUrl}</code> : <div className="empty-command-card">Run the clock-location setup before programming tags.</div>}
            <button className="primary-btn" type="button" disabled={!clockUrl} onClick={copyClockUrl}>{clockIcon} Copy NFC URL</button>
          </article>
          <article className="setup-card lunch-policy-card">
            <div><p className="eyebrow">Lunch policy</p><h3>Automatic lunch end</h3><p>Optionally return employees to clocked-in status after a fixed break.</p></div>
            <form className="lunch-policy-form" onSubmit={saveLunchSettings}>
              <label className="lunch-toggle"><input type="checkbox" checked={automaticLunchEnabled} onChange={(event) => setAutomaticLunchEnabled(event.target.checked)} /><span>Enable automatic lunch end</span></label>
              <label className="lunch-duration"><span>Lunch duration</span><div><input type="number" min="15" max="180" step="1" disabled={!automaticLunchEnabled} value={automaticLunchMinutes} onChange={(event) => setAutomaticLunchMinutes(event.target.value)} /><strong>minutes</strong></div></label>
              <p className="control-note">Employees can still end lunch early. When disabled, they must tap End Lunch themselves.</p>
              <button className="primary-btn" type="submit" disabled={savingLunchSettings || (automaticLunchEnabled && (Number(automaticLunchMinutes) < 15 || Number(automaticLunchMinutes) > 180))}>{savingLunchSettings ? 'Saving…' : 'Save Lunch Policy'}</button>
            </form>
          </article>
        </div>
      </div>

      <div className="payroll-section">
        <div className="payroll-section-header"><div><p className="eyebrow">Employees</p><h2>Access & enrollment</h2><p>Add staff, issue phone codes, or remove old accounts and records.</p></div></div>
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
                  <td>{issuedCodes[employee._id] ? <div className="employee-code-cell"><strong>{issuedCodes[employee._id]}</strong><small>Expires in 7 days</small></div> : employee.enrollmentPending ? <span className="status-pill enrollment-pending-pill">Code active</span> : <span className="muted">Phone connected</span>}</td>
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
                <td>{eventLabels[event.eventType]}{event.note ? <span>{event.note}</span> : null}</td>
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
