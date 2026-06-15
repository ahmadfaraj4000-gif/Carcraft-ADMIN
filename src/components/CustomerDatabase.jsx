import { useMemo } from 'react'

function date(value) {
  return value ? new Date(value).toLocaleDateString() : '-'
}

export default function CustomerDatabase({ customers = [], search = '', onDelete }) {
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) => [
      customer.name, customer.phone, customer.email, customer.vehicle, customer.source
    ].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [customers, search])

  return (
    <section className="customer-database">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Customer</th><th>Contact</th><th>Vehicle</th><th>Source</th><th>History</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {rows.map((customer) => (
              <tr key={customer._id}>
                <td><strong>{customer.name}</strong><span>{customer.address || 'No address saved'}</span></td>
                <td><strong>{customer.phone || '-'}</strong><span>{customer.email || '-'}</span></td>
                <td><strong>{customer.vehicle || '-'}</strong><span>{customer.vin ? `VIN ${customer.vin}` : 'No VIN saved'}</span></td>
                <td><span className="status-pill status-confirmed">{customer.source}</span></td>
                <td>{customer.leadIds.length} leads · {customer.appointmentIds.length} appointments</td>
                <td>{date(customer.updatedAt)}</td>
                <td><button className="delete-btn small" onClick={() => onDelete(customer._id)}>Delete</button></td>
              </tr>
            ))}
            {!rows.length ? <tr><td className="empty-cell" colSpan="7">No customers found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
