import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AppointmentList from './components/AppointmentList'
import CalendarView from './components/CalendarView'
import AppointmentModal from './components/AppointmentModal'
import NewAppointmentModal from './components/NewAppointmentModal'
import InvoiceGenerator from './components/InvoiceGenerator'
import EstimateLeads from './components/EstimateLeads'
import CustomerDatabase from './components/CustomerDatabase'

const CUSTOMER_KEY = 'cr8CustomerDatabase'
const DELETED_CUSTOMER_KEY = 'cr8DeletedCustomers'

function formatRole(role) {
  return (role || 'viewer').replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatStatus(status) {
  return (status || 'new').replaceAll('_', ' ')
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function isThisWeek(dateValue) {
  if (!dateValue) return false

  const d = new Date(`${dateValue}T00:00:00`)
  const now = new Date()

  const start = new Date(now)
  start.setDate(now.getDate() - now.getDay())
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 7)

  return d >= start && d < end
}

function getDaysInShop(dropoffDate, pickupDate) {
  if (!dropoffDate) return null

  const start = new Date(`${dropoffDate}T00:00:00`)
  const end = pickupDate
    ? new Date(`${pickupDate}T00:00:00`)
    : new Date()

  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  const diff = end - start
  return Math.max(0, Math.floor(diff / 86400000))
}

function loadSavedCustomers() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function loadDeletedCustomerKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(DELETED_CUSTOMER_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function customerKey(customer) {
  return [
    customer.name,
    customer.phone,
    customer.email,
    customer.vehicle,
    customer.vin
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
}

function normalizeCustomer(customer) {
  return {
    id: customer.id || customerKey(customer) || crypto.randomUUID(),
    name: customer.name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    address: customer.address || '',
    vehicle: customer.vehicle || '',
    vehicle_year: customer.vehicle_year || '',
    vehicle_make: customer.vehicle_make || '',
    vehicle_model: customer.vehicle_model || '',
    vin: customer.vin || '',
    mileage: customer.mileage || '',
    plate: customer.plate || '',
    source: customer.source || 'invoice',
    notes: customer.notes || '',
    updatedAt: customer.updatedAt || customer.updated_at || customer.created_at || new Date().toISOString(),
    isSupabaseCustomer: Boolean(customer.isSupabaseCustomer)
  }
}

function dedupeCustomers(customers) {
  const seen = new Map()

  customers.map(normalizeCustomer).forEach((customer) => {
    const key = customerKey(customer)
    if (!key) return

    const existing = seen.get(key)
    if (!existing || new Date(customer.updatedAt) > new Date(existing.updatedAt)) {
      seen.set(key, customer)
    }
  })

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bookings, setBookings] = useState([])
  const [applications, setApplications] = useState([])
  const [estimateLeads, setEstimateLeads] = useState([])
  const [supabaseCustomers, setSupabaseCustomers] = useState([])
  const [savedCustomers, setSavedCustomers] = useState(loadSavedCustomers)
  const [deletedCustomerKeys, setDeletedCustomerKeys] = useState(loadDeletedCustomerKeys)
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [activeTab, setActiveTab] = useState('appointments')
  const [appointmentView, setAppointmentView] = useState('new_requests')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function bootstrap() {
      if (!session?.user) {
        setProfile(null)
        setBookings([])
        setApplications([])
        setEstimateLeads([])
        setSupabaseCustomers([])
        setLoading(false)
        return
      }

      setLoading(true)

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (profileError) {
        setError(profileError.message)
      } else {
        setProfile(profileData)
      }

      await Promise.all([loadBookings(), loadApplications(), loadEstimateLeads(), loadCustomers()])
      setLoading(false)
    }

    bootstrap()
  }, [session])

  useEffect(() => {
    if (!session?.user || !savedCustomers.length) return

    async function migrateLocalCustomers() {
      const existingKeys = new Set(supabaseCustomers.map(customerKey))
      const customersToMigrate = savedCustomers
        .map((customer) => normalizeCustomer({ ...customer, source: customer.source || 'invoice' }))
        .filter((customer) => customerKey(customer) && !existingKeys.has(customerKey(customer)))

      if (!customersToMigrate.length) return

      const { error } = await supabase
        .from('customers')
        .insert(customersToMigrate.map(customerToRow))

      if (error) {
        setError(error.message)
        return
      }

      localStorage.removeItem(CUSTOMER_KEY)
      setSavedCustomers([])
      await loadCustomers()
    }

    migrateLocalCustomers()
  }, [session, supabaseCustomers, savedCustomers])

  async function loadBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })

    if (error) {
      setError(error.message)
      return
    }

    setBookings(data || [])
  }

  async function loadApplications() {
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      return
    }

    setApplications(data || [])
  }


  async function loadEstimateLeads() {
    const { data, error } = await supabase
      .from('estimate_leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      return
    }

    setEstimateLeads(data || [])
  }

  async function loadCustomers() {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      setError(error.message)
      return
    }

    setSupabaseCustomers((data || []).map((customer) => normalizeCustomer({
      ...customer,
      isSupabaseCustomer: true
    })))
  }

  async function handleEstimateConverted() {
    await Promise.all([loadBookings(), loadEstimateLeads()])
    setActiveTab('appointments')
    setAppointmentView('new_requests')
  }

  async function updateBookingStatus(id, status) {
    const updates = { status }

    if (status === 'car_in_shop') {
      updates.dropoff_date = todayISO()
      updates.pickup_date = null
    }

    if (status === 'completed') {
      updates.pickup_date = todayISO()
    }

    const { error } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', id)

    if (error) {
      setError(error.message)
      return
    }

    await loadBookings()
  }

  async function markDroppedOff(id) {
    const { error } = await supabase
      .from('bookings')
      .update({
        dropoff_date: todayISO(),
        pickup_date: null,
        status: 'car_in_shop'
      })
      .eq('id', id)

    if (error) {
      setError(error.message)
      return
    }

    await loadBookings()
  }

  async function markPickedUp(id) {
    const { error } = await supabase
      .from('bookings')
      .update({
        pickup_date: todayISO(),
        status: 'completed'
      })
      .eq('id', id)

    if (error) {
      setError(error.message)
      return
    }

    await loadBookings()
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  function customerToRow(customer) {
    return {
      name: customer.name || '',
      phone: customer.phone || null,
      email: customer.email || null,
      address: customer.address || null,
      vehicle: customer.vehicle || null,
      vehicle_year: customer.vehicle_year || null,
      vehicle_make: customer.vehicle_make || null,
      vehicle_model: customer.vehicle_model || null,
      vin: customer.vin || null,
      mileage: customer.mileage || null,
      plate: customer.plate || null,
      source: customer.source || 'invoice',
      notes: customer.notes || null
    }
  }

  async function saveCustomer(customer) {
    const normalized = normalizeCustomer({ ...customer, source: customer.source || 'invoice' })

    if (!normalized.name && !normalized.phone && !normalized.email) return

    const existing = supabaseCustomers.find((savedCustomer) => customerKey(savedCustomer) === customerKey(normalized))
    const row = customerToRow(normalized)

    const { error } = existing?.isSupabaseCustomer
      ? await supabase.from('customers').update(row).eq('id', existing.id)
      : await supabase.from('customers').insert([row])

    if (error) {
      setError(error.message)
      return
    }

    setDeletedCustomerKeys((keys) => {
      const nextKeys = keys.filter((key) => key !== customerKey(normalized))
      localStorage.setItem(DELETED_CUSTOMER_KEY, JSON.stringify(nextKeys))
      return nextKeys
    })

    await loadCustomers()
  }

  async function deleteCustomer(customer) {
    const records = Array.isArray(customer.masterRecords) && customer.masterRecords.length > 0
      ? customer.masterRecords
      : [customer]

    const keys = records.map(customerKey).filter(Boolean)
    if (!keys.length) return

    const confirmed = window.confirm(`Delete ${customer.name || customer.phone || 'this customer'} and its attached vehicles from the customer database?`)
    if (!confirmed) return

    const supabaseIds = records
      .filter((record) => record.isSupabaseCustomer)
      .map((record) => record.id)
      .filter(Boolean)

    if (supabaseIds.length > 0) {
      const { error } = await supabase
        .from('customers')
        .delete()
        .in('id', supabaseIds)

      if (error) {
        setError(error.message)
        return
      }

      await loadCustomers()
    }

    setSavedCustomers((current) => {
      const next = current.filter((savedCustomer) => !keys.includes(customerKey(savedCustomer)))
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(next))
      return next
    })

    setDeletedCustomerKeys((current) => {
      const next = Array.from(new Set([...current, ...keys]))
      localStorage.setItem(DELETED_CUSTOMER_KEY, JSON.stringify(next))
      return next
    })
  }

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'archived'),
    [bookings]
  )

  const filteredBookings = useMemo(() => {
    const term = search.trim().toLowerCase()
    let rows = activeBookings

    if (appointmentView === 'new_requests') {
      rows = activeBookings.filter((b) =>
        ['new', 'contacted', 'confirmed'].includes(b.status || 'new')
      )
    }

    if (appointmentView === 'in_shop') {
      rows = activeBookings.filter((b) => b.status === 'car_in_shop')
    }

    if (appointmentView === 'needs_attention') {
      rows = activeBookings.filter((b) => {
        const days = getDaysInShop(b.dropoff_date, b.pickup_date)
        return (
          b.status === 'waiting_on_parts' ||
          b.status === 'follow_up_needed' ||
          (days !== null && days >= 3 && !b.pickup_date)
        )
      })
    }

    if (appointmentView === 'completed_archived') {
      rows = bookings.filter((b) =>
        b.status === 'completed' || b.status === 'archived'
      )
    }

    if (!term) return rows

    return rows.filter((booking) =>
      [
        booking.name,
        booking.phone,
        booking.vehicle,
        booking.service,
        booking.appointment_date,
        booking.appointment_time,
        booking.dropoff_date,
        booking.pickup_date,
        booking.status
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [bookings, activeBookings, appointmentView, search])

  const filteredApplications = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return applications

    return applications.filter((app) =>
      [
        app.name,
        app.phone,
        app.email,
        app.job_type,
        app.experience,
        app.certifications,
        app.start_date,
        app.message,
        app.status
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [applications, search])


  const filteredEstimateLeads = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return estimateLeads

    return estimateLeads.filter((lead) =>
      [
        lead.name,
        lead.phone,
        lead.email,
        lead.zip,
        lead.vehicle,
        lead.insurance_type,
        lead.damage_area,
        lead.damage_type,
        lead.severity,
        lead.description,
        lead.estimate_range,
        lead.status
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [estimateLeads, search])

  const customers = useMemo(() => {
    const bookingCustomers = bookings.map((booking) => ({
      id: `booking-${booking.id}`,
      name: booking.name || '',
      phone: booking.phone || '',
      email: booking.email || '',
      vehicle: booking.vehicle || '',
      source: 'appointment',
      updatedAt: booking.updated_at || booking.created_at || booking.appointment_date
    }))

    const leadCustomers = estimateLeads.map((lead) => ({
      id: `lead-${lead.id}`,
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
      address: lead.zip ? `ZIP ${lead.zip}` : '',
      vehicle: lead.vehicle || '',
      vehicle_year: lead.vehicle_year || '',
      vehicle_make: lead.vehicle_make || '',
      vehicle_model: lead.vehicle_model || '',
      vin: lead.vin || '',
      source: 'estimate lead',
      updatedAt: lead.updated_at || lead.created_at
    }))

    return dedupeCustomers([...supabaseCustomers, ...savedCustomers, ...bookingCustomers, ...leadCustomers])
      .filter((customer) => !deletedCustomerKeys.includes(customerKey(customer)))
  }, [bookings, estimateLeads, supabaseCustomers, savedCustomers, deletedCustomerKeys])

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers

    return customers.filter((customer) => {
      const searchable = [
        customer.name,
        customer.phone,
        customer.email,
        customer.address,
        customer.vehicle,
        customer.vin,
        customer.plate
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchable.includes(term)
    })
  }, [customers, search])

  const stats = useMemo(() => {
    return {
      newRequests: activeBookings.filter((b) =>
        ['new', 'contacted', 'confirmed'].includes(b.status || 'new')
      ).length,
      inShop: activeBookings.filter((b) => b.status === 'car_in_shop').length,
      needsAttention: activeBookings.filter((b) => {
        const days = getDaysInShop(b.dropoff_date, b.pickup_date)
        return (
          b.status === 'waiting_on_parts' ||
          b.status === 'follow_up_needed' ||
          (days !== null && days >= 3 && !b.pickup_date)
        )
      }).length,
      completedThisWeek: bookings.filter((b) =>
        b.status === 'completed' && isThisWeek(b.pickup_date || b.appointment_date)
      ).length
    }
  }, [bookings, activeBookings])

  if (loading) {
    return <div className="loading-screen">Loading CR8 Admin Portal...</div>
  }

  if (!session) {
    return <Login />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">CR8 AUTOS</p>
          <h2>Shop Command</h2>
          <p className="muted">Owner operations dashboard</p>
        </div>

        <nav className="side-nav">
          <button className={activeTab === 'appointments' ? 'active' : ''} onClick={() => setActiveTab('appointments')}>
            Appointments
          </button>
          <button className={activeTab === 'calendar' ? 'active' : ''} onClick={() => setActiveTab('calendar')}>
            Calendar
          </button>
          <button className={activeTab === 'applications' ? 'active' : ''} onClick={() => setActiveTab('applications')}>
            Applications
          </button>
          <button className={activeTab === 'invoices' ? 'active' : ''} onClick={() => setActiveTab('invoices')}>
            Invoices
          </button>
          <button className={activeTab === 'customers' ? 'active' : ''} onClick={() => setActiveTab('customers')}>
            Customers
          </button>
          <button className={activeTab === 'leads' ? 'active' : ''} onClick={() => setActiveTab('leads')}>
            Estimate Leads
          </button>
        </nav>

        <div className="profile-box">
          <div className="profile-line"><strong>{profile?.full_name || session.user.email}</strong></div>
          <div className="profile-line">{session.user.email}</div>
          <div className="profile-line role-pill">{formatRole(profile?.role)}</div>
          <button className="ghost-btn" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>
              {activeTab === 'appointments' && 'Shop Command Center'}
              {activeTab === 'calendar' && 'Calendar'}
              {activeTab === 'applications' && 'Applications'}
              {activeTab === 'invoices' && 'Invoices'}
              {activeTab === 'customers' && 'Customers'}
              {activeTab === 'leads' && 'Estimate Leads'}
            </h1>
          </div>

          {activeTab !== 'invoices' ? (
            <div className="header-actions">
              <input
                className="search-input"
                placeholder={
                  activeTab === 'applications'
                    ? 'Search applications...'
                    : activeTab === 'customers'
                      ? 'Search customers...'
                    : activeTab === 'leads'
                      ? 'Search estimate leads...'
                      : 'Search customer, vehicle, phone, status...'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {['appointments', 'calendar'].includes(activeTab) ? (
                <button className="primary-btn header-btn" onClick={() => setShowNewModal(true)}>
                  + New Appointment
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {error ? <div className="error-box">{error}</div> : null}

        {activeTab === 'appointments' ? (
          <>
            <section className="stats-grid stats-grid-owner">
              <article className="stat-card urgent">
                <span>New Requests</span>
                <strong>{stats.newRequests}</strong>
              </article>

              <article className="stat-card blue">
                <span>Cars In Shop</span>
                <strong>{stats.inShop}</strong>
              </article>

              <article className="stat-card warning">
                <span>Needs Attention</span>
                <strong>{stats.needsAttention}</strong>
              </article>

              <article className="stat-card success">
                <span>Completed This Week</span>
                <strong>{stats.completedThisWeek}</strong>
              </article>
            </section>

            <section className="view-tabs">
              <button className={appointmentView === 'new_requests' ? 'active' : ''} onClick={() => setAppointmentView('new_requests')}>
                New Requests
              </button>
              <button className={appointmentView === 'in_shop' ? 'active' : ''} onClick={() => setAppointmentView('in_shop')}>
                In Shop
              </button>
              <button className={appointmentView === 'needs_attention' ? 'active' : ''} onClick={() => setAppointmentView('needs_attention')}>
                Waiting / Follow Up
              </button>
              <button className={appointmentView === 'completed_archived' ? 'active' : ''} onClick={() => setAppointmentView('completed_archived')}>
                Completed / Archived
              </button>
            </section>

            <AppointmentList
              bookings={filteredBookings}
              onSelect={setSelectedBooking}
              onStatusChange={updateBookingStatus}
              onDroppedOff={markDroppedOff}
              onPickedUp={markPickedUp}
            />
          </>
        ) : null}

        {activeTab === 'calendar' ? (
          <CalendarView bookings={activeBookings} onSelect={setSelectedBooking} />
        ) : null}

        {activeTab === 'applications' ? (
          <>
            <section className="stats-grid">
              <article className="stat-card">
                <span>Total Applications</span>
                <strong>{applications.length}</strong>
              </article>

              <article className="stat-card">
                <span>New Applications</span>
                <strong>{applications.filter((a) => a.status === 'new').length}</strong>
              </article>

              <article className="stat-card">
                <span>Showing</span>
                <strong>{filteredApplications.length}</strong>
              </article>
            </section>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Job</th>
                    <th>Contact</th>
                    <th>Experience</th>
                    <th>Start</th>
                    <th>Message</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.length === 0 ? (
                    <tr>
                      <td className="empty-cell" colSpan="7">
                        No applications found.
                      </td>
                    </tr>
                  ) : (
                    filteredApplications.map((app) => (
                      <tr
                        key={app.id}
                        onClick={() => setSelectedApplication(app)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div className="cell-title">{app.name || '—'}</div>
                          <div className="cell-sub">
                            <span className={`status-pill status-${app.status || 'new'}`}>
                              {app.status || 'new'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-title">{app.job_type || '—'}</div>
                          <div className="cell-sub">{app.certifications || 'No certifications listed'}</div>
                        </td>
                        <td>
                          <div className="cell-title">{app.phone || '—'}</div>
                          <div className="cell-sub">{app.email || '—'}</div>
                        </td>
                        <td>{app.experience || '—'}</td>
                        <td>{app.start_date || '—'}</td>
                        <td>{app.message || '—'}</td>
                        <td>{formatDate(app.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {activeTab === 'invoices' ? (
          <InvoiceGenerator customers={customers} onCustomerSaved={saveCustomer} />
        ) : null}

        {activeTab === 'customers' ? (
          <CustomerDatabase customers={filteredCustomers} onDelete={deleteCustomer} />
        ) : null}

        {activeTab === 'leads' ? (
          <EstimateLeads
            leads={filteredEstimateLeads}
            onSaved={loadEstimateLeads}
            onConverted={handleEstimateConverted}
          />
        ) : null}

      </main>

      <AppointmentModal
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onSaved={loadBookings}
      />

      <NewAppointmentModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSaved={loadBookings}
      />

      {selectedApplication ? (
        <div className="modal-backdrop" onClick={() => setSelectedApplication(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Job Application</p>
                <h3>{selectedApplication.name}</h3>
              </div>

              <button className="ghost-btn" onClick={() => setSelectedApplication(null)}>
                Close
              </button>
            </div>

            <div className="detail-grid">
              <div>
                <label>Name</label>
                <strong>{selectedApplication.name || '—'}</strong>
              </div>

              <div>
                <label>Phone</label>
                <strong>{selectedApplication.phone || '—'}</strong>
              </div>

              <div>
                <label>Email</label>
                <strong>{selectedApplication.email || '—'}</strong>
              </div>

              <div>
                <label>Job Type</label>
                <strong>{selectedApplication.job_type || '—'}</strong>
              </div>

              <div>
                <label>Experience</label>
                <strong>{selectedApplication.experience || '—'}</strong>
              </div>

              <div>
                <label>Certifications</label>
                <strong>{selectedApplication.certifications || '—'}</strong>
              </div>

              <div>
                <label>Start Date</label>
                <strong>{selectedApplication.start_date || '—'}</strong>
              </div>

              <div>
                <label>Submitted</label>
                <strong>{formatDate(selectedApplication.created_at)}</strong>
              </div>
            </div>

            <div className="placeholder-card">
              <label>Applicant Message</label>
              <p>{selectedApplication.message || 'No message provided.'}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
