import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

const statuses = ['new_request', 'confirmed', 'car_in_shop', 'waiting_on_parts', 'completed', 'cancelled']

function label(value) {
  return String(value || '').replaceAll('_', ' ')
}

export default function Appointments({ appointments = [], search = '' }) {
  const saveAppointment = useMutation(api.appointments.create)
  const updateAppointment = useMutation(api.appointments.update)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', vehicle: '', serviceRequested: '', appointmentDate: '', appointmentTime: '09:00', note: '' })

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return appointments
    return appointments.filter((appt) => [
      appt.name, appt.phone, appt.email, appt.vehicle, appt.serviceRequested, appt.status, appt.appointmentDate
    ].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [appointments, search])

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    await saveAppointment(form)
    setForm({ name: '', phone: '', email: '', vehicle: '', serviceRequested: '', appointmentDate: '', appointmentTime: '09:00', note: '' })
  }

  return (
    <section className="split-module">
      <form className="panel-form" onSubmit={submit}>
        <p className="eyebrow">New Appointment</p>
        <h2>Create appointment</h2>
        <div className="form-grid">
          {['name', 'phone', 'email', 'vehicle', 'serviceRequested'].map((key) => (
            <label key={key}>{label(key)}<input value={form[key]} onChange={(e) => updateForm(key, e.target.value)} required={['name', 'phone', 'serviceRequested'].includes(key)} /></label>
          ))}
          <label>Date<input type="date" value={form.appointmentDate} onChange={(e) => updateForm('appointmentDate', e.target.value)} required /></label>
          <label>Time<input type="time" value={form.appointmentTime} onChange={(e) => updateForm('appointmentTime', e.target.value)} required /></label>
        </div>
        <textarea value={form.note} onChange={(e) => updateForm('note', e.target.value)} placeholder="Appointment notes" />
        <button className="primary-btn">Save Appointment</button>
      </form>

      <div className="command-list">
        {rows.map((appt) => (
          <article className="command-card" key={appt._id}>
            <div>
              <div className="command-topline">
                <h3>{appt.name}</h3>
                <span className={`status-pill status-${appt.status}`}>{label(appt.status)}</span>
              </div>
              <p className="muted">{appt.appointmentDate} at {appt.appointmentTime} · {appt.phone}</p>
              <p>{appt.vehicle || 'Vehicle not listed'} · {appt.serviceRequested}</p>
              {appt.rentalVehicleInterest ? <p className="muted">Rental vehicle requested through RentMect coordination.</p> : null}
            </div>
            <div className="quick-actions">
              <select value={appt.status} onChange={(e) => updateAppointment({ id: appt._id, status: e.target.value })}>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
              <button className="ghost-btn small" onClick={() => setEditing(appt)}>Notes</button>
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><h2>{editing.name}</h2><button className="ghost-btn" onClick={() => setEditing(null)}>Close</button></div>
            {editing.rentalVehicleInterest ? <div className="note-box">Customer is interested in a rental vehicle. They were told they can book at rentmect.com and Car Craft can help coordinate having it brought to the shop.</div> : null}
            <div className="notes-list">{editing.notes?.map((note) => <p key={note.createdAt}>{note.body}</p>)}</div>
            <textarea placeholder="Add status or repair note" onBlur={(e) => e.target.value && updateAppointment({ id: editing._id, note: e.target.value })} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
