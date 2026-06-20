import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

const statuses = ['new', 'contacted', 'booked', 'follow_up_needed', 'lost', 'archived']

function fmt(value) {
  return value ? new Date(value).toLocaleString() : '-'
}

function statusLabel(value) {
  return String(value || 'new').replaceAll('_', ' ')
}

export default function EstimateLeads({ leads = [], search = '' }) {
  const updateStatus = useMutation(api.estimateLeads.updateStatus)
  const addNote = useMutation(api.estimateLeads.addNote)
  const archiveLead = useMutation(api.estimateLeads.archiveLead)
  const deleteLead = useMutation(api.estimateLeads.deleteLead)
  const convertLead = useMutation(api.appointments.convertLead)
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('09:00')

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return leads
    return leads.filter((lead) => [
      lead.name, lead.phone, lead.email, lead.vehicle, lead.status, lead.damageArea, lead.damageType
    ].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [leads, search])

  async function saveNote() {
    if (!note.trim() || !selected) return
    await addNote({ id: selected._id, body: note })
    setNote('')
  }

  async function convert() {
    await convertLead({ leadId: selected._id, appointmentDate: date, appointmentTime: time })
    setSelected(null)
  }

  return (
    <section className="module">
      <div className="command-list">
        {rows.map((lead) => (
          <article className={`command-card status-border-${lead.status}`} key={lead._id}>
            <div>
              <div className="command-topline">
                <h3>{lead.name}</h3>
                <span className={`status-pill status-${lead.status}`}>{statusLabel(lead.status)}</span>
                {lead.rentalVehicleInterest ? <span className="status-pill status-follow_up_needed">Rental help</span> : null}
                {lead.towAssistanceInterest ? <span className="status-pill status-follow_up_needed">Tow needed</span> : null}
              </div>
              <p className="muted">{lead.phone} · {lead.email} · {lead.vehicle || 'Vehicle not listed'}</p>
              <p>{lead.damageArea} · {lead.damageType} · Severity: {lead.severity}</p>
              <div className="photo-row">
                {(lead.photos || []).slice(0, 4).map((photo) => <img key={photo.storageId} src={photo.url} alt={photo.name || 'Vehicle damage'} />)}
              </div>
            </div>
            <div className="quick-actions">
              <button className="ghost-btn small" onClick={() => setSelected(lead)}>Open</button>
              <button className="ghost-btn small" onClick={() => updateStatus({ id: lead._id, status: 'contacted' })}>Contacted</button>
              <button className="primary-btn small" onClick={() => updateStatus({ id: lead._id, status: 'booked' })}>Booked</button>
            </div>
          </article>
        ))}
        {!rows.length ? <div className="empty-command-card">No estimate leads found.</div> : null}
      </div>

      {selected ? (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-card wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><p className="eyebrow">Estimate Lead</p><h2>{selected.name}</h2></div>
              <button className="ghost-btn" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="detail-grid">
              <div><strong>Phone</strong><span>{selected.phone}</span></div>
              <div><strong>Email</strong><span>{selected.email}</span></div>
              <div><strong>Preferred Contact</strong><span>{selected.preferredContactMethod}</span></div>
              <div><strong>Vehicle</strong><span>{selected.vehicle}</span></div>
              <div><strong>VIN</strong><span>{selected.vin || '-'}</span></div>
              <div><strong>Mileage</strong><span>{selected.mileage || '-'}</span></div>
              <div><strong>Damage</strong><span>{selected.damageArea} · {selected.damageType}</span></div>
              <div><strong>Submitted</strong><span>{fmt(selected.createdAt)}</span></div>
              <div><strong>Rental Help</strong><span>{selected.rentalVehicleInterest ? 'Requested' : 'Not requested'}</span></div>
              <div><strong>Tow Assistance</strong><span>{selected.towAssistanceInterest ? 'Needs a tow' : 'Not requested'}</span></div>
            </div>
            <p className="note-box">{selected.description}</p>
            <div className="photo-grid">{(selected.photos || []).map((photo) => <img key={photo.storageId} src={photo.url} alt={photo.name || 'Damage photo'} />)}</div>
            <div className="form-grid">
              <label>Status<select value={selected.status} onChange={(e) => updateStatus({ id: selected._id, status: e.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
              <label>Appointment Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label>Appointment Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            </div>
            <div className="notes-list">{(selected.notes || []).map((item) => <p key={item.createdAt}>{item.body}</p>)}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add admin note..." />
            <div className="modal-actions">
              <button className="ghost-btn" onClick={saveNote}>Add Note</button>
              <button className="primary-btn" onClick={convert}>Convert to Appointment</button>
              <button className="ghost-btn" onClick={() => archiveLead({ id: selected._id })}>Archive</button>
              <button className="delete-btn" onClick={() => deleteLead({ id: selected._id }).then(() => setSelected(null))}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
