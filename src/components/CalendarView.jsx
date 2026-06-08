import { useMemo } from 'react'

export default function CalendarView({ appointments = [] }) {
  const grouped = useMemo(() => {
    return appointments.reduce((acc, appt) => {
      acc[appt.appointmentDate] ||= []
      acc[appt.appointmentDate].push(appt)
      return acc
    }, {})
  }, [appointments])

  return (
    <section className="calendar-shell">
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
        <article className="calendar-day" key={date}>
          <h3>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {rows.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime)).map((appt) => (
            <div className="calendar-event" key={appt._id}>
              <strong>{appt.appointmentTime} · {appt.name}</strong>
              <span>{appt.vehicle || 'Vehicle'} · {appt.serviceRequested}</span>
            </div>
          ))}
        </article>
      ))}
      {!appointments.length ? <div className="empty-command-card">No appointments on the calendar yet.</div> : null}
    </section>
  )
}
