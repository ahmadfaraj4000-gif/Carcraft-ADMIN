import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

const initial = {
  name: '',
  phone: '',
  email: '',
  vehicleYear: '',
  vehicleMake: '',
  vehicleModel: '',
  vin: '',
  mileage: '',
  damageArea: '',
  damageType: '',
  severity: 'moderate',
  description: '',
  preferredContactMethod: 'phone'
}

export default function PublicEstimateForm() {
  const createLead = useMutation(api.estimateLeads.create)
  const getUploadUrl = useMutation(api.estimateLeads.generateUploadUrl)
  const [form, setForm] = useState(initial)
  const [files, setFiles] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function uploadPhotos() {
    const photos = []
    for (const [index, file] of files.entries()) {
      const url = await getUploadUrl()
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      const { storageId } = await res.json()
      photos.push({ storageId, name: file.name, order: index })
    }
    return photos
  }

  async function submit(event) {
    event.preventDefault()
    setStatus('saving')
    setError('')
    try {
      const photos = await uploadPhotos()
      await createLead({ ...form, photos })
      setForm(initial)
      setFiles([])
      setStatus('success')
    } catch (err) {
      setError(err.message || 'Unable to submit your estimate request.')
      setStatus('idle')
    }
  }

  return (
    <main className="public-page">
      <section className="public-hero">
        <a className="public-logo" href="index.html">Car Craft Autobody</a>
        <p className="eyebrow">Photo Estimate</p>
        <h1>Submit Your Vehicle Damage Photos</h1>
        <p>Upload clear photos and vehicle details. Car Craft will review your request and contact you with the next step.</p>
      </section>

      <form className="estimate-form" onSubmit={submit}>
        {status === 'success' ? <div className="success-box">Thanks. Car Craft Autobody received your estimate request and will review your photos before contacting you.</div> : null}
        {error ? <div className="error-box">{error}</div> : null}

        <div className="form-section">
          <h2>Contact Info</h2>
          <div className="form-grid">
            <label>Name<input value={form.name} onChange={(e) => update('name', e.target.value)} required /></label>
            <label>Phone<input value={form.phone} onChange={(e) => update('phone', e.target.value)} required /></label>
            <label>Email<input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></label>
            <label>Preferred Contact<select value={form.preferredContactMethod} onChange={(e) => update('preferredContactMethod', e.target.value)}><option>phone</option><option>text</option><option>email</option></select></label>
          </div>
        </div>

        <div className="form-section">
          <h2>Vehicle Info</h2>
          <div className="form-grid">
            <label>Year<input value={form.vehicleYear} onChange={(e) => update('vehicleYear', e.target.value)} required /></label>
            <label>Make<input value={form.vehicleMake} onChange={(e) => update('vehicleMake', e.target.value)} required /></label>
            <label>Model<input value={form.vehicleModel} onChange={(e) => update('vehicleModel', e.target.value)} required /></label>
            <label>VIN optional<input value={form.vin} onChange={(e) => update('vin', e.target.value)} /></label>
            <label>Mileage optional<input value={form.mileage} onChange={(e) => update('mileage', e.target.value)} /></label>
          </div>
        </div>

        <div className="form-section">
          <h2>Damage Details</h2>
          <div className="form-grid">
            <label>Damage Area<input value={form.damageArea} onChange={(e) => update('damageArea', e.target.value)} placeholder="Front bumper, rear quarter, door..." required /></label>
            <label>Damage Type<input value={form.damageType} onChange={(e) => update('damageType', e.target.value)} placeholder="Dent, scratch, collision, rust..." required /></label>
            <label>Severity<select value={form.severity} onChange={(e) => update('severity', e.target.value)}><option>minor</option><option>moderate</option><option>major</option><option>not sure</option></select></label>
          </div>
          <textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Tell us what happened and what you want repaired." required />
        </div>

        <div className="form-section">
          <h2>Photos</h2>
          <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} required />
          <div className="photo-row">{files.map((file) => <img key={file.name} src={URL.createObjectURL(file)} alt={file.name} />)}</div>
        </div>

        <button className="primary-btn" disabled={status === 'saving'}>{status === 'saving' ? 'Submitting...' : 'Submit Estimate Request'}</button>
      </form>
    </main>
  )
}
