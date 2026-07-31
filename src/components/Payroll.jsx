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
  date.setUTCDate(date.getUTCDate() + 7)
  const endAt = easternMidnightUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  return { startAt, endAt }
}

function formatHours(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000))
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

function formatWeekRange(startAt, endAt) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt - 1))}`
}

export default function Payroll() {
  const dashboard = useQuery(api.timeClock.adminDashboard)
  const [weeklyNow, setWeeklyNow] = useState(() => Date.now())
  const weekBounds = useMemo(() => getEasternWeekBounds(weeklyNow), [weeklyNow])
  const weeklySummary = useQuery(api.timeClock.adminWeeklySummary, {
    ...weekBounds,
    asOf: Math.floor(weeklyNow / 60000) * 60000
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
  const events = dashboard?.events || []
  const location = dashboard?.locations.find((row) => row.active)
  const clockUrl = location ? `${CLOCK_ORIGIN}?tag=${encodeURIComponent(location.tagCode)}` : ''
  const stats = useMemo(() => ({
    working: employees.filter((employee) => employee.active && employee.clockState === 'working').length,
    lunch: employees.filter((employee) => employee.active && employee.clockState === 'on_lunch').length,
    active: employees.filter((employee) => employee.active).length,
    entries: events.length
  }), [employees, events])
  const weeklyEmployees = weeklySummary?.employees || []
  const weeklyTotal = weeklyEmployees.reduce((total, employee) => total + employee.workedMilliseconds, 0)
  const weeklyScale = Math.max(40 * 60 * 60 * 1000, ...weeklyEmployees.map((employee) => employee.workedMilliseconds))

  useEffect(() => {
    if (!dashboard?.settings) return
    setAutomaticLunchEnabled(dashboard.settings.automaticLunchEndEnabled)
    setAutomaticLunchMinutes(dashboard.settings.automaticLunchMinutes)
  }, [dashboard?.settings?.automaticLunchEndEnabled, dashboard?.settings?.automaticLunchMinutes])

  useEffect(() => {
    const timer = window.setInterval(() => setWeeklyNow(Date.now()), 60000)
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
      ...events.map((event) => [
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
    link.download = `car-craft-time-clock-${new Date().toISOString().slice(0, 10)}.csv`
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
          <p>Manage employee phone enrollment and review every clock, lunch, and clock-out event.</p>
        </div>
        <span className="integration-badge integration-badge-live">Live</span>
      </div>

      {notice ? <div className="admin-notice success">{notice}</div> : null}
      {error ? <div className="admin-notice error">{error}</div> : null}

      <div className="payroll-section payroll-overview-section">
        <div className="payroll-section-header"><div><p className="eyebrow">Overview</p><h2>Today at a glance</h2></div></div>
        <div className="stats-grid compact payroll-stats">
          <article className="stat-card"><span>Clocked in now</span><strong>{stats.working}</strong><small>Currently working</small></article>
          <article className="stat-card"><span>On lunch</span><strong>{stats.lunch}</strong><small>Lunch in progress</small></article>
          <article className="stat-card"><span>Active employees</span><strong>{stats.active}</strong><small>Allowed to use the clock</small></article>
          <article className="stat-card"><span>Recent entries</span><strong>{stats.entries}</strong><small>Latest 250 events</small></article>
        </div>
      </div>

      <div className="payroll-section weekly-hours-section">
        <div className="payroll-section-header">
          <div><p className="eyebrow">Weekly hours</p><h2>{formatWeekRange(weekBounds.startAt, weekBounds.endAt)}</h2><p>Paid time for the current workweek. Lunch breaks are excluded.</p></div>
          <span className="weekly-reset-note">Resets Saturday at 12:00 a.m. ET</span>
        </div>
        <div className="weekly-hours-card">
          <div className="weekly-hours-total">
            <span>Team total</span>
            <strong>{weeklySummary ? formatHours(weeklyTotal) : '—'}</strong>
            <small>Updated every minute</small>
          </div>
          <div className="weekly-hours-chart" aria-label="Employee hours this week">
            {weeklySummary === undefined ? <div className="weekly-hours-loading">Calculating this week’s hours…</div> : null}
            {weeklyEmployees.map((employee) => (
              <div className={`weekly-hours-row ${employee.active ? '' : 'inactive'}`} key={employee.employeeId}>
                <div className="weekly-hours-identity">
                  <strong>{employee.employeeName}</strong>
                  <small>{employee.currentlyWorking ? 'Clocked in now' : employee.active ? 'Not clocked in' : 'Inactive'}</small>
                </div>
                <div className="weekly-hours-meter" aria-hidden="true">
                  <span style={{ '--weekly-width': `${Math.min(100, (employee.workedMilliseconds / weeklyScale) * 100)}%` }} />
                </div>
                <strong className="weekly-hours-value">{formatHours(employee.workedMilliseconds)}</strong>
              </div>
            ))}
            {weeklySummary && !weeklyEmployees.length ? <div className="weekly-hours-loading">Add an employee to begin weekly tracking.</div> : null}
          </div>
          <div className="weekly-hours-scale"><span>0 hours</span><span>40-hour scale</span></div>
        </div>
      </div>

      <div className="payroll-section">
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

      <div className="payroll-section">
        <div className="payroll-section-header payroll-activity-header">
          <div><p className="eyebrow">Activity</p><h2>Recent clock events</h2><p>Server-timestamped clock, lunch, and clock-out records.</p></div>
          <button className="ghost-btn" type="button" disabled={!events.length} onClick={exportEvents}>Export CSV</button>
        </div>
        <div className="table-wrap">
          <table>
          <thead><tr><th>Employee</th><th>Action</th><th>Time (Eastern)</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event._id}>
                <td><strong>{event.employeeName}</strong></td>
                <td>{eventLabels[event.eventType]}{event.note ? <span>{event.note}</span> : null}</td>
                <td>{formatTime(event.occurredAt)}</td>
                <td>{event.locationName}</td>
                <td><span className="status-pill">{event.source.toUpperCase()}</span></td>
              </tr>
            ))}
            {!events.length ? <tr><td colSpan="5" className="empty-cell"><div className="table-empty-state"><span className="table-empty-icon">{clockIcon}</span><strong>No clock activity yet</strong><span>Entries appear here as employees use the NFC clock.</span></div></td></tr> : null}
          </tbody>
          </table>
        </div>
      </div>

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
