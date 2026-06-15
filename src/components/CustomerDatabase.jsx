import { useMemo } from 'react'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

function customerIdentityKey(customer) {
  const name = String(customer.name || '').trim().toLowerCase()
  const phone = String(customer.phone || '').trim().toLowerCase()
  const email = String(customer.email || '').trim().toLowerCase()
  const address = String(customer.address || '').trim().toLowerCase()

  if (phone || email) return [name, phone, email].filter(Boolean).join('|')
  return [name, address].filter(Boolean).join('|')
}

function vehicleKey(vehicle) {
  return [vehicle.vehicle, vehicle.vin, vehicle.plate]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join('|')
}

function formatVehicle(vehicle) {
  return vehicle.vehicle || [vehicle.vehicle_year, vehicle.vehicle_make, vehicle.vehicle_model].filter(Boolean).join(' ') || 'Unnamed vehicle'
}

function groupCustomers(customers) {
  const groups = new Map()

  customers.forEach((customer) => {
    const key = customerIdentityKey(customer)
    if (!key) return

    const existing = groups.get(key) || {
      ...customer,
      id: key,
      vehicles: [],
      sources: new Set(),
      masterRecords: []
    }

    existing.masterRecords.push(customer)
    if (customer.source) existing.sources.add(customer.source)

    if ((!existing.address && customer.address) || new Date(customer.updatedAt || 0) > new Date(existing.updatedAt || 0)) {
      existing.name = customer.name || existing.name
      existing.phone = customer.phone || existing.phone
      existing.email = customer.email || existing.email
      existing.address = customer.address || existing.address
      existing.updatedAt = customer.updatedAt || existing.updatedAt
    }

    const vehicle = {
      vehicle: customer.vehicle || '',
      vehicle_year: customer.vehicle_year || '',
      vehicle_make: customer.vehicle_make || '',
      vehicle_model: customer.vehicle_model || '',
      vin: customer.vin || '',
      plate: customer.plate || ''
    }

    const keyForVehicle = vehicleKey(vehicle)
    if (keyForVehicle && !existing.vehicles.some((savedVehicle) => vehicleKey(savedVehicle) === keyForVehicle)) {
      existing.vehicles.push(vehicle)
    }

    groups.set(key, existing)
  })

  return [...groups.values()].map((customer) => ({
    ...customer,
    source: [...customer.sources].join(', ') || customer.source || 'invoice',
    vehicles: customer.vehicles.sort((a, b) => formatVehicle(a).localeCompare(formatVehicle(b)))
  }))
}

export default function CustomerDatabase({ customers = [], onDelete }) {
  const masterCustomers = useMemo(() => groupCustomers(customers), [customers])

  return (
    <section className="customer-database">
      <div className="customer-database-header">
        <div>
          <p className="eyebrow">Customer Database</p>
          <h2>Master customers</h2>
          <p className="muted">Vehicles from invoices, appointments, and estimate leads are attached under one customer profile.</p>
        </div>

        <strong>{masterCustomers.length}</strong>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Vehicle</th>
              <th>Source</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {masterCustomers.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan="6">
                  No customers found yet.
                </td>
              </tr>
            ) : (
              masterCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="cell-title">{customer.name || '—'}</div>
                    <div className="cell-sub">{customer.address || 'No address saved'}</div>
                  </td>
                  <td>
                    <div className="cell-title">{customer.phone || '—'}</div>
                    <div className="cell-sub">{customer.email || '—'}</div>
                  </td>
                  <td>
                    <div className="cell-title">{customer.vehicles.length} vehicle{customer.vehicles.length === 1 ? '' : 's'}</div>
                    <div className="customer-vehicle-list">
                      {customer.vehicles.length === 0 ? (
                        <span className="cell-sub">No vehicles saved</span>
                      ) : (
                        customer.vehicles.map((vehicle) => (
                          <div className="customer-vehicle-chip" key={vehicleKey(vehicle)}>
                            <strong>{formatVehicle(vehicle)}</strong>
                            <span>{[vehicle.vin ? `VIN ${vehicle.vin}` : '', vehicle.plate ? `Plate ${vehicle.plate}` : ''].filter(Boolean).join(' · ') || 'No vehicle IDs saved'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="status-pill status-confirmed">{customer.source || 'invoice'}</span>
                  </td>
                  <td>{formatDate(customer.updatedAt || customer.created_at)}</td>
                  <td>
                    <button className="delete-btn small" onClick={() => onDelete?.(customer)}>
                      Delete Master
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
