import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const statusOptions = [
  'new',
  'contacted',
  'booked',
  'follow_up_needed',
  'lost',
  'archived'
]

function formatStatus(status) {
  return (status || 'new').replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function normalizeBookingTime(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/)
  if (!match) return raw

  let hour = Number(match[1])
  const minute = match[2] || '00'
  const meridiem = match[3]

  if (meridiem === 'PM' && hour !== 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0

  return `${String(hour).padStart(2, '0')}:${minute}`
}

async function isSlotAlreadyBooked(date, time) {
  const normalizedTime = normalizeBookingTime(time)

  const { data, error } = await supabase
    .from('bookings')
    .select('id, appointment_time, status')
    .eq('appointment_date', date)

  if (error) throw error

  return (data || []).some((booking) => (
    booking.status !== 'cancelled' &&
    booking.status !== 'archived' &&
    normalizeBookingTime(booking.appointment_time) === normalizedTime
  ))
}

function getAiField(lead, key, fallback = '—') {
  const ai = lead.ai_result || {}
  return ai[key] || fallback
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  return [value]
}

function formatBoolean(value) {
  return value ? 'Yes' : 'No'
}

function formatPercent(value) {
  const number = Number(value || 0)
  if (!number) return '—'
  return `${Math.round(number * 100)}%`
}

function phoneLink(phone) {
  if (!phone) return null
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

function smsLink(phone) {
  if (!phone) return null
  return `sms:${phone.replace(/[^\d+]/g, '')}`
}

function getEstimatePhotoPath(url) {
  const marker = '/storage/v1/object/public/estimate-lead-photos/'
  if (!url || !url.includes(marker)) return null
  return decodeURIComponent(url.split(marker)[1] || '').split('?')[0]
}

export default function EstimateLeads({ leads = [], onSaved, onConverted }) {
  const [selectedLead, setSelectedLead] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('new')
  const [adminNotes, setAdminNotes] = useState('')
  const [converting, setConverting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const stats = useMemo(() => {
    return {
      total: leads.length,
      newLeads: leads.filter((lead) => (lead.status || 'new') === 'new').length,
      booked: leads.filter((lead) => lead.status === 'booked').length,
      followUp: leads.filter((lead) => lead.status === 'follow_up_needed').length
    }
  }, [leads])

  function openLead(lead) {
    setSelectedLead(lead)
    setStatus(lead.status || 'new')
    setAdminNotes(lead.admin_notes || '')
    setError('')
  }

  async function saveLead() {
    if (!selectedLead) return

    setSaving(true)
    setError('')

    const { error } = await supabase
      .from('estimate_leads')
      .update({
        status,
        admin_notes: adminNotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedLead.id)

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    setSaving(false)
    await onSaved?.()
    setSelectedLead(null)
  }

  async function deleteLead() {
    if (!selectedLead) return

    const confirmed = window.confirm(
      'Delete this estimate lead permanently? This cannot be undone.'
    )

    if (!confirmed) return

    setDeleting(true)
    setError('')

    const { error } = await supabase
      .from('estimate_leads')
      .delete()
      .eq('id', selectedLead.id)

    if (error) {
      setError(error.message)
      setDeleting(false)
      return
    }

    setDeleting(false)
    await onSaved?.()
    setSelectedLead(null)
  }

  async function quickStatus(lead, nextStatus) {
    const { error } = await supabase
      .from('estimate_leads')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', lead.id)

    if (error) {
      setError(error.message)
      return
    }

    await onSaved?.()
  }

  async function convertToAppointment(lead = selectedLead) {
    if (!lead) return

    setConverting(true)
    setError('')

    const aiSummary = getAiField(lead, 'repair_summary', '')
    const pricingFactors = normalizeArray(getAiField(lead, 'pricing_factors', []))
    const inspectionFlags = normalizeArray(getAiField(lead, 'inspection_flags', []))
    const recommendedNextStep = getAiField(lead, 'recommended_next_step', '')
    const appointmentNotes = [
      'Converted from AI Photo Estimate lead.',
      lead.description ? `Customer description: ${lead.description}` : '',
      aiSummary ? `AI summary: ${aiSummary}` : '',
      lead.estimate_range ? `Rough range: ${lead.estimate_range}` : '',
      lead.vin ? `VIN: ${lead.vin}` : '',
      lead.damage_area || lead.damage_type || lead.severity
        ? `Damage details: ${[lead.damage_area, lead.damage_type, lead.severity].filter(Boolean).join(' | ')}`
        : '',
      pricingFactors.length ? `Pricing factors: ${pricingFactors.join(' | ')}` : '',
      inspectionFlags.length ? `Inspection flags: ${inspectionFlags.join(' | ')}` : '',
      recommendedNextStep ? `Recommended next step: ${recommendedNextStep}` : '',
      lead.photo_urls?.length ? `Photo URLs: ${normalizeArray(lead.photo_urls).join(' | ')}` : ''
    ].filter(Boolean).join('\n\n')

    const appointmentDate = todayISO()
    const appointmentTime = '09:00'

    try {
      const alreadyBooked = await isSlotAlreadyBooked(appointmentDate, appointmentTime)
      if (alreadyBooked) {
        setError('9:00 AM is already booked today. Create the appointment manually for another available time.')
        setConverting(false)
        return
      }
    } catch (err) {
      setError(err.message)
      setConverting(false)
      return
    }

    const { error: bookingError } = await supabase
      .from('bookings')
      .insert([
        {
          name: lead.name || 'Estimate Lead',
          phone: lead.phone || '',
          email: lead.email || '',
          vehicle: lead.vehicle || '',
          service: `AI Photo Estimate - ${lead.damage_area || lead.damage_type || 'Collision Review'}`,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          notes: appointmentNotes,
          status: 'new',
          created_source: 'estimate_lead'
        }
      ])

    if (bookingError) {
      setError(bookingError.message)
      setConverting(false)
      return
    }

    const photoPaths = normalizeArray(lead.photo_urls)
      .map(getEstimatePhotoPath)
      .filter(Boolean)

    if (photoPaths.length) {
      const { error: photoError } = await supabase.storage
        .from('estimate-lead-photos')
        .remove(photoPaths)

      if (photoError) {
        console.warn('Converted estimate lead, but photo cleanup failed:', photoError)
      }
    }

    const { error: leadError } = await supabase
      .from('estimate_leads')
      .delete()
      .eq('id', lead.id)

    if (leadError) {
      setError(leadError.message)
      setConverting(false)
      return
    }

    setConverting(false)
    await onConverted?.()
    if (!onConverted) await onSaved?.()
    setSelectedLead(null)
  }

  return (
    <section className="estimate-leads-module">
      <section className="stats-grid stats-grid-owner">
        <article className="stat-card urgent">
          <span>New Estimate Leads</span>
          <strong>{stats.newLeads}</strong>
        </article>

        <article className="stat-card blue">
          <span>Total Leads</span>
          <strong>{stats.total}</strong>
        </article>

        <article className="stat-card success">
          <span>Booked</span>
          <strong>{stats.booked}</strong>
        </article>

        <article className="stat-card warning">
          <span>Follow Up</span>
          <strong>{stats.followUp}</strong>
        </article>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {leads.length === 0 ? (
        <div className="empty-command-card">
          <h3>No estimate leads yet.</h3>
          <p>New photo estimate submissions will show here once the homepage form is connected.</p>
        </div>
      ) : (
        <div className="command-list">
          {leads.map((lead) => {
            const photos = normalizeArray(lead.photo_urls)
            const parts = normalizeArray(getAiField(lead, 'detected_parts', []))
            const damageTypes = normalizeArray(getAiField(lead, 'damage_types', []))

            return (
              <article key={lead.id} className={`command-card status-border-${lead.status || 'new'}`}>
                <div className="command-main">
                  <div className="command-date">
                    <strong>{formatDate(lead.created_at).split(',')[0]}</strong>
                    <span>{formatDate(lead.created_at).split(',')[1] || 'New lead'}</span>
                  </div>

                  <div className="command-info">
                    <div className="command-topline">
                      <h3>{lead.name || 'Unnamed Lead'}</h3>
                      <span className={`status-pill status-${lead.status || 'new'}`}>
                        {formatStatus(lead.status)}
                      </span>
                      <span className="urgency-pill">
                        {lead.estimate_range || getAiField(lead, 'estimate_range', 'Inspection required')}
                      </span>
                    </div>

                    <div className="command-subline">
                      <span>{lead.vehicle || 'Vehicle not listed'}</span>
                      <span>•</span>
                      <span>{lead.damage_area || 'Damage area not listed'}</span>
                      <span>•</span>
                      <span>{lead.damage_type || 'Damage type not listed'}</span>
                    </div>

                    <div className="command-subline muted">
                      <span>{lead.phone || 'No phone'}</span>
                      <span>•</span>
                      <span>{lead.email || 'No email'}</span>
                      <span>•</span>
                      <span>{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
                    </div>

                    <div className="shop-tracking-row">
                      <span className="days-badge warning">
                        Severity: {lead.severity || getAiField(lead, 'severity', '—')}
                      </span>
                      <span className="days-badge">
                        AI: {getAiField(lead, 'backend', 'local')}
                      </span>
                      {parts.length ? <span className="tracking-detail">Parts: {parts.join(', ')}</span> : null}
                      {damageTypes.length ? <span className="tracking-detail">Type: {damageTypes.join(', ')}</span> : null}
                    </div>

                    {photos.length ? (
                      <div className="estimate-card-photos" aria-label={`${photos.length} uploaded damage photos`}>
                        {photos.slice(0, 4).map((url, index) => (
                          <button
                            type="button"
                            className="estimate-card-photo"
                            onClick={() => openLead(lead)}
                            key={url}
                            aria-label={`Open damage photo ${index + 1}`}
                          >
                            <img src={url} alt={`Damage thumbnail ${index + 1}`} />
                          </button>
                        ))}
                        {photos.length > 4 ? (
                          <button type="button" className="estimate-card-photo more" onClick={() => openLead(lead)}>
                            +{photos.length - 4}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="quick-actions">
                  {lead.phone ? (
                    <>
                      <a className="ghost-btn small" href={phoneLink(lead.phone)}>Call</a>
                      <a className="ghost-btn small" href={smsLink(lead.phone)}>Text</a>
                    </>
                  ) : null}

                  <button className="ghost-btn small" onClick={() => openLead(lead)}>
                    Open
                  </button>

                  {lead.status !== 'contacted' ? (
                    <button className="ghost-btn small" onClick={() => quickStatus(lead, 'contacted')}>
                      Contacted
                    </button>
                  ) : null}

                  {lead.status !== 'booked' ? (
                    <button className="primary-btn small" onClick={() => quickStatus(lead, 'booked')}>
                      Booked
                    </button>
                  ) : null}

                  <button className="success-btn small" onClick={() => convertToAppointment(lead)} disabled={converting}>
                    Convert
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selectedLead ? (
        <div className="modal-backdrop" onClick={() => setSelectedLead(null)}>
          <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Estimate Lead</p>
                <h3>{selectedLead.name || 'Estimate Lead'}</h3>
                <p className="muted modal-subtitle">
                  {selectedLead.vehicle || 'Vehicle not listed'} · {selectedLead.estimate_range || getAiField(selectedLead, 'estimate_range', 'Inspection required')}
                </p>
              </div>

              <button className="ghost-btn" onClick={() => setSelectedLead(null)}>
                Close
              </button>
            </div>

            <div className="detail-grid">
              <div><strong>Phone:</strong> {selectedLead.phone || '—'}</div>
              <div><strong>Email:</strong> {selectedLead.email || '—'}</div>
              <div><strong>ZIP:</strong> {selectedLead.zip || '—'}</div>
              <div><strong>Vehicle:</strong> {selectedLead.vehicle || '—'}</div>
              <div><strong>Insurance:</strong> {selectedLead.insurance_type || '—'}</div>
              <div><strong>Status:</strong> {formatStatus(selectedLead.status)}</div>
              <div><strong>Damage Area:</strong> {selectedLead.damage_area || '—'}</div>
              <div><strong>Damage Type:</strong> {selectedLead.damage_type || '—'}</div>
              <div><strong>Severity:</strong> {selectedLead.severity || getAiField(selectedLead, 'severity', '—')}</div>
              <div><strong>Estimate Range:</strong> {selectedLead.estimate_range || getAiField(selectedLead, 'estimate_range', '—')}</div>
              <div><strong>Submitted:</strong> {formatDate(selectedLead.created_at)}</div>
              <div><strong>Updated:</strong> {formatDate(selectedLead.updated_at)}</div>
            </div>

            <div className="estimate-ai-panel">
              <div>
                <p className="eyebrow">AI Review</p>
                <h4>Preliminary Damage Summary</h4>
              </div>

              <p className="muted">
                {getAiField(selectedLead, 'repair_summary', selectedLead.description || 'No description provided.')}
              </p>

              <div className="history-chip-row">
                {normalizeArray(getAiField(selectedLead, 'detected_parts', [])).map((part) => (
                  <span className="history-chip" key={part}>{part}</span>
                ))}
                {normalizeArray(getAiField(selectedLead, 'damage_types', [])).map((type) => (
                  <span className="history-chip" key={type}>{type}</span>
                ))}
              </div>
            </div>

            <div className="estimate-ai-panel">
              <div>
                <p className="eyebrow">Estimate Breakdown</p>
                <h4>Pricing Factors & Flags</h4>
              </div>

              <div className="estimate-breakdown-grid">
                <div><strong>Backend:</strong> {getAiField(selectedLead, 'backend', '—')}</div>
                <div><strong>YOLO Used:</strong> {formatBoolean(Boolean(getAiField(selectedLead, 'yolo_used', false)))}</div>
                <div><strong>Photo Count:</strong> {getAiField(selectedLead, 'photo_count', normalizeArray(selectedLead.photo_urls).length)}</div>
                <div><strong>Confidence:</strong> {formatPercent(getAiField(selectedLead, 'confidence', 0))}</div>
                <div><strong>Estimate Low:</strong> {getAiField(selectedLead, 'estimate_low', '—')}</div>
                <div><strong>Estimate High:</strong> {getAiField(selectedLead, 'estimate_high', '—')}</div>
              </div>

              <div className="estimate-factor-list">
                <strong>Pricing factors</strong>
                {normalizeArray(getAiField(selectedLead, 'pricing_factors', [])).length ? (
                  normalizeArray(getAiField(selectedLead, 'pricing_factors', [])).map((factor) => (
                    <span key={factor}>{factor}</span>
                  ))
                ) : (
                  <span>No pricing factors saved.</span>
                )}
              </div>

              <div className="estimate-factor-list warning">
                <strong>Inspection flags</strong>
                {normalizeArray(getAiField(selectedLead, 'inspection_flags', [])).length ? (
                  normalizeArray(getAiField(selectedLead, 'inspection_flags', [])).map((flag) => (
                    <span key={flag}>{flag}</span>
                  ))
                ) : (
                  <span>Final estimate requires in-person inspection.</span>
                )}
              </div>

              <p className="muted">
                {getAiField(selectedLead, 'recommended_next_step', 'Book an in-person inspection with CR8 Autos.')}
              </p>
            </div>

            {normalizeArray(selectedLead.photo_urls).length ? (
              <div className="estimate-ai-panel">
                <div>
                  <p className="eyebrow">Damage Photos</p>
                  <h4>Uploaded Images</h4>
                </div>

                <div className="estimate-photo-grid">
                  {normalizeArray(selectedLead.photo_urls).map((url) => (
                    <a href={url} target="_blank" rel="noreferrer" key={url}>
                      <img src={url} alt="Vehicle damage upload" />
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div className="placeholder-card">
                <p className="muted">No photos were saved with this lead.</p>
              </div>
            )}

            <div className="estimate-ai-panel">
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>{formatStatus(option)}</option>
                ))}
              </select>

              <label>Admin Notes</label>
              <textarea
                rows="5"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add internal notes, follow-up details, booked appointment info, etc."
              />
            </div>

            {error ? <div className="error-box">{error}</div> : null}

            <div className="modal-actions">
              <button className="delete-btn" onClick={deleteLead} disabled={deleting || saving || converting}>
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>

              <button className="ghost-btn" onClick={() => setSelectedLead(null)}>
                Cancel
              </button>

              <button className="success-btn" onClick={() => convertToAppointment(selectedLead)} disabled={converting}>
                {converting ? 'Converting...' : 'Convert to Appointment'}
              </button>

              <button onClick={saveLead} disabled={saving}>
                {saving ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
