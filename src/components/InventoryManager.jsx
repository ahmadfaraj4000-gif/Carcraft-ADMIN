import { useEffect, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import fallbackVehicleImage from '../assets/images/branding/carcraft-storefront.png'

const emptyVehicle = {
  year: '',
  make: '',
  model: '',
  price: '',
  mileage: '',
  color: '',
  bodyType: '',
  transmission: '',
  vin: '',
  titleStatus: 'Clean Title',
  status: 'available',
  description: '',
  featured: false,
  sortOrder: 100,
  photos: []
}

export default function InventoryManager({ vehicles = [], search = '', stats }) {
  const saveVehicle = useMutation(api.inventory.save)
  const archiveVehicle = useMutation(api.inventory.archive)
  const deleteVehicle = useMutation(api.inventory.remove)
  const deleteVehicles = useMutation(api.inventory.removeMany)
  const getUploadUrl = useMutation(api.inventory.generateUploadUrl)
  const [form, setForm] = useState(emptyVehicle)
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return vehicles
    return vehicles.filter((car) => [
      car.year, car.make, car.model, car.price, car.status, car.titleStatus, car.color
    ].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [vehicles, search])

  const allVisibleSelected = rows.length > 0 && rows.every((car) => selectedIds.has(car._id))

  useEffect(() => {
    setSelectedIds((current) => {
      const validIds = new Set(vehicles.map((car) => car._id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [vehicles])

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function uploadPhotos() {
    const uploaded = []
    for (const [index, file] of files.entries()) {
      const url = await getUploadUrl()
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      const { storageId } = await res.json()
      uploaded.push({ storageId, name: file.name, order: index })
    }
    return uploaded
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    const uploaded = await uploadPhotos()
    await saveVehicle({
      id: form.id,
      year: form.year,
      make: form.make,
      model: form.model,
      price: form.price,
      mileage: form.mileage,
      color: form.color,
      bodyType: form.bodyType,
      transmission: form.transmission,
      vin: form.vin,
      titleStatus: form.titleStatus,
      status: form.status,
      description: form.description,
      featured: form.featured,
      sortOrder: Number(form.sortOrder) || 100,
      photos: uploaded.length ? uploaded : (form.photos || []).map(({ storageId, name, order }) => ({ storageId, name, order }))
    })
    setForm(emptyVehicle)
    setFiles([])
    setSaving(false)
  }

  async function updateVehicleStatus(car, status) {
    await saveVehicle({
      id: car._id,
      year: car.year,
      make: car.make,
      model: car.model,
      price: car.price || '',
      mileage: car.mileage || '',
      color: car.color || '',
      bodyType: car.bodyType || '',
      transmission: car.transmission || '',
      vin: car.vin || '',
      titleStatus: car.titleStatus,
      status,
      description: car.description || '',
      featured: car.featured,
      sortOrder: car.sortOrder,
      photos: (car.photos || []).map(({ storageId, name, order }) => ({ storageId, name, order }))
    })
  }

  function toggleVehicleSelection(id) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        rows.forEach((car) => next.delete(car._id))
      } else {
        rows.forEach((car) => next.add(car._id))
      }
      return next
    })
  }

  function requestDeleteVehicle(car) {
    const title = `${car.year} ${car.make} ${car.model}`.trim()
    setDeleteDialog({
      type: 'single',
      title: title || 'this vehicle',
      ids: [car._id],
      count: 1
    })
  }

  function requestDeleteSelected() {
    const ids = [...selectedIds]
    if (!ids.length) return
    setDeleteDialog({
      type: 'bulk',
      title: `${ids.length} selected vehicle${ids.length === 1 ? '' : 's'}`,
      ids,
      count: ids.length
    })
  }

  async function confirmPermanentDelete() {
    if (!deleteDialog) return
    setDeleting(true)
    try {
      if (deleteDialog.type === 'single') {
        await deleteVehicle({ id: deleteDialog.ids[0] })
      } else {
        await deleteVehicles({ ids: deleteDialog.ids })
      }
      setSelectedIds((current) => {
        const next = new Set(current)
        deleteDialog.ids.forEach((id) => next.delete(id))
        return next
      })
      setDeleteDialog(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="inventory-module">
      <section className="stats-grid compact">
        <article className="stat-card"><span>Total Active</span><strong>{stats.activeVehicles}</strong></article>
        <article className="stat-card"><span>Featured</span><strong>{stats.featuredVehicles}</strong></article>
        <article className="stat-card"><span>Sold</span><strong>{stats.soldVehicles}</strong></article>
        <article className="stat-card"><span>Coming Soon</span><strong>{stats.comingSoonVehicles}</strong></article>
      </section>

      <form className="panel-form" onSubmit={submit}>
        <p className="eyebrow">{form.id ? 'Edit Vehicle' : 'Add Vehicle'}</p>
        <div className="form-grid">
          {['year', 'make', 'model', 'price', 'mileage', 'color', 'bodyType', 'transmission', 'vin', 'titleStatus', 'sortOrder'].map((key) => (
            <label key={key}>{key.replace(/([A-Z])/g, ' $1')}<input value={form[key] || ''} onChange={(e) => set(key, e.target.value)} required={['year', 'make', 'model'].includes(key)} /></label>
          ))}
          <label>Status<select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="available">Available</option><option value="sold">Sold</option><option value="coming_soon">Coming Soon</option><option value="archived">Archived</option></select></label>
          <label className="checkbox-line"><input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} /> Featured</label>
        </div>
        <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short vehicle description" />
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button className="primary-btn" disabled={saving}>{saving ? 'Saving...' : 'Save Vehicle'}</button>
      </form>

      <div className="inventory-bulk-toolbar">
        <label className="checkbox-line select-all-line">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            disabled={!rows.length || deleting}
            onChange={toggleSelectAllVisible}
          />
          Select all visible
        </label>
        <div className="bulk-actions">
          <span className="muted">{selectedIds.size} selected</span>
          <button
            className="delete-btn small"
            type="button"
            disabled={!selectedIds.size || deleting}
            onClick={requestDeleteSelected}
          >
            {deleting ? 'Deleting...' : selectedIds.size === rows.length && rows.length ? 'Delete All Selected' : 'Delete Selected'}
          </button>
        </div>
      </div>

      <div className="inventory-admin-grid">
        {rows.map((car) => (
          <article className={`inventory-admin-card${selectedIds.has(car._id) ? ' selected' : ''}`} key={car._id}>
            <label className="vehicle-select">
              <input
                type="checkbox"
                checked={selectedIds.has(car._id)}
                disabled={deleting}
                onChange={() => toggleVehicleSelection(car._id)}
              />
              <span>Select vehicle</span>
            </label>
            <img src={car.photos?.[0]?.url || fallbackVehicleImage} alt={`${car.year} ${car.make} ${car.model}`} />
            <div>
              <div className="command-topline"><h3>{car.year} {car.make} {car.model}</h3><span className={`status-pill status-${car.status}`}>{car.status.replaceAll('_', ' ')}</span></div>
              <p className="muted">{car.price || 'Call for price'} · {car.mileage || 'Mileage TBD'} · {car.color || 'Color TBD'}</p>
              <p>{car.description}</p>
              <div className="quick-actions">
                <button className="ghost-btn small" onClick={() => setForm({
                  id: car._id,
                  year: car.year,
                  make: car.make,
                  model: car.model,
                  price: car.price || '',
                  mileage: car.mileage || '',
                  color: car.color || '',
                  bodyType: car.bodyType || '',
                  transmission: car.transmission || '',
                  vin: car.vin || '',
                  titleStatus: car.titleStatus,
                  status: car.status,
                  description: car.description || '',
                  featured: car.featured,
                  sortOrder: car.sortOrder,
                  photos: car.photos || []
                })}>Edit</button>
                {car.status !== 'sold' ? (
                  <button className="ghost-btn small" onClick={() => updateVehicleStatus(car, 'sold')}>Mark Sold</button>
                ) : null}
                {car.status !== 'available' ? (
                  <button className="ghost-btn small" onClick={() => updateVehicleStatus(car, 'available')}>Available</button>
                ) : null}
                {car.status !== 'coming_soon' ? (
                  <button className="ghost-btn small" onClick={() => updateVehicleStatus(car, 'coming_soon')}>Coming Soon</button>
                ) : null}
                <button className="delete-btn small" onClick={() => archiveVehicle({ id: car._id })}>Archive</button>
                <button className="delete-btn small" disabled={deleting} onClick={() => requestDeleteVehicle(car)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {deleteDialog ? (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteDialog(null)}>
          <div className="modal-card delete-confirm-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Permanent Delete</p>
                <h2>Remove inventory record?</h2>
              </div>
              <button className="ghost-btn" type="button" disabled={deleting} onClick={() => setDeleteDialog(null)}>Close</button>
            </div>
            <div className="delete-confirm-body">
              <strong>{deleteDialog.title}</strong>
              <p>This will permanently remove {deleteDialog.count === 1 ? 'this car' : 'these cars'} from the admin portal and the CarCraft Convex database. This cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" type="button" disabled={deleting} onClick={() => setDeleteDialog(null)}>Keep Inventory</button>
              <button className="delete-btn danger-fill" type="button" disabled={deleting} onClick={confirmPermanentDelete}>
                {deleting ? 'Deleting...' : deleteDialog.count === 1 ? 'Delete Car' : `Delete ${deleteDialog.count} Cars`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
