import { useMemo, useState } from 'react'
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

export default function Payroll() {
  const dashboard = useQuery(api.timeClock.adminDashboard)
  const createEmployee = useMutation(api.timeClock.createEmployee)
  const issueEnrollmentCode = useMutation(api.timeClock.issueEnrollmentCode)
  const setEmployeeActive = useMutation(api.timeClock.setEmployeeActive)
  const [employeeName, setEmployeeName] = useState('')
  const [issuedCodes, setIssuedCodes] = useState({})
  const [busyEmployee, setBusyEmployee] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

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

  async function copyClockUrl() {
    if (!clockUrl) return
    await navigator.clipboard.writeText(clockUrl)
    setNotice('Clock URL copied. This is the exact URL to write to each NFC tag.')
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

      <div className="stats-grid compact">
        <article className="stat-card"><span>Clocked in now</span><strong>{stats.working}</strong><small>Currently working</small></article>
        <article className="stat-card"><span>On lunch</span><strong>{stats.lunch}</strong><small>Lunch in progress</small></article>
        <article className="stat-card"><span>Active employees</span><strong>{stats.active}</strong><small>Allowed to use the clock</small></article>
        <article className="stat-card"><span>Recent entries</span><strong>{stats.entries}</strong><small>Latest 250 events</small></article>
      </div>

      <div className="payroll-layout payroll-live-layout">
        <article className="setup-card clock-url-card">
          <div>
            <p className="eyebrow">NFC tag URL</p>
            <h3>{location?.name || 'Clock location not configured'}</h3>
            <p>Program every wall tag with this exact URL. The tag only opens the clock—it never stores employee information.</p>
          </div>
          {clockUrl ? <code className="clock-url">{clockUrl}</code> : <div className="empty-command-card">Run the clock-location setup before programming tags.</div>}
          <button className="primary-btn" type="button" disabled={!clockUrl} onClick={copyClockUrl}>{clockIcon} Copy NFC URL</button>
        </article>

        <article className="setup-card">
          <div>
            <p className="eyebrow">Add employee</p>
            <h3>Create an enrollment code</h3>
            <p>The one-time code expires in seven days and is removed as soon as the employee connects a phone.</p>
          </div>
          <form className="employee-create-form" onSubmit={create}>
            <label>Employee full name<input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Example: Alex Rivera" maxLength="80" /></label>
            <button className="primary-btn" disabled={busyEmployee === 'new' || !employeeName.trim()} type="submit">{busyEmployee === 'new' ? 'Adding…' : 'Add Employee'}</button>
          </form>
        </article>
      </div>

      <div className="section-heading"><div><h2>Employees</h2><p>Enrollment codes are visible only when created in this browser session.</p></div></div>
      <div className="employee-clock-grid">
        {employees.map((employee) => (
          <article className={`employee-clock-card ${employee.active ? '' : 'inactive'}`} key={employee._id}>
            <div className="command-topline">
              <div><h3>{employee.name}</h3><span className={`status-pill clock-${employee.clockState}`}>{employee.active ? stateLabels[employee.clockState] : 'Inactive'}</span></div>
              <small>{employee.lastEventAt ? `Last: ${formatTime(employee.lastEventAt)}` : 'No entries yet'}</small>
            </div>
            {issuedCodes[employee._id] ? (
              <div className="enrollment-code"><span>One-time enrollment code</span><strong>{issuedCodes[employee._id]}</strong><small>Expires in 7 days</small></div>
            ) : employee.enrollmentPending ? (
              <div className="pending-code-note">An enrollment code is active. Regenerate it if the employee needs a new one.</div>
            ) : null}
            <div className="quick-actions">
              <button className="ghost-btn small" type="button" disabled={busyEmployee === employee._id} onClick={() => regenerate(employee)}>New Code</button>
              <button className="ghost-btn small" type="button" disabled={busyEmployee === employee._id} onClick={() => toggleEmployee(employee)}>{employee.active ? 'Deactivate' : 'Reactivate'}</button>
            </div>
          </article>
        ))}
        {!employees.length ? <div className="empty-command-card">No employees yet. Add the first employee above.</div> : null}
      </div>

      <div className="section-heading">
        <div><h2>Recent clock activity</h2><p>Original entries are append-only and use server timestamps.</p></div>
        <button className="ghost-btn" type="button" disabled={!events.length} onClick={exportEvents}>Export CSV</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Action</th><th>Time (Eastern)</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event._id}>
                <td><strong>{event.employeeName}</strong></td>
                <td>{eventLabels[event.eventType]}</td>
                <td>{formatTime(event.occurredAt)}</td>
                <td>{event.locationName}</td>
                <td><span className="status-pill">{event.source.toUpperCase()}</span></td>
              </tr>
            ))}
            {!events.length ? <tr><td colSpan="5" className="empty-cell"><div className="table-empty-state"><span className="table-empty-icon">{clockIcon}</span><strong>No clock activity yet</strong><span>Entries appear here as employees use the NFC clock.</span></div></td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
