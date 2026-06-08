import { useMemo, useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import EstimateLeads from './components/EstimateLeads'
import Appointments from './components/Appointments'
import CustomerDatabase from './components/CustomerDatabase'
import InventoryManager from './components/InventoryManager'
import CalendarView from './components/CalendarView'

const navItems = [
  ['dashboard', 'Dashboard'],
  ['leads', 'Estimate Leads'],
  ['appointments', 'Appointments'],
  ['customers', 'Customers'],
  ['inventory', 'Inventory'],
  ['calendar', 'Calendar']
]

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { signOut } = useAuthActions()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [search, setSearch] = useState('')

  const leads = useQuery(api.estimateLeads.list) || []
  const appointments = useQuery(api.appointments.list) || []
  const customers = useQuery(api.customers.list) || []
  const inventory = useQuery(api.inventory.list) || []
  const deleteCustomer = useMutation(api.customers.remove)

  const title = navItems.find(([key]) => key === activeTab)?.[1] || 'Dashboard'
  const stats = useMemo(() => ({
    newLeads: leads.filter((lead) => lead.status === 'new').length,
    followUps: leads.filter((lead) => lead.status === 'follow_up_needed').length,
    bookedAppointments: appointments.filter((appt) => ['new_request', 'confirmed'].includes(appt.status)).length,
    carsInShop: appointments.filter((appt) => ['car_in_shop', 'waiting_on_parts'].includes(appt.status)).length,
    completedThisWeek: appointments.filter((appt) => {
      if (appt.status !== 'completed') return false
      const d = new Date(appt.updatedAt)
      const now = new Date()
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      return d >= start
    }).length,
    activeVehicles: inventory.filter((car) => car.status === 'available').length,
    soldVehicles: inventory.filter((car) => car.status === 'sold').length,
    featuredVehicles: inventory.filter((car) => car.featured).length,
    comingSoonVehicles: inventory.filter((car) => car.status === 'coming_soon').length
  }), [appointments, inventory, leads])

  if (isLoading) return <div className="loading-screen">Loading Car Craft command center...</div>
  if (!isAuthenticated) return <Login />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span>Car Craft</span>
          <strong>Autobody Admin</strong>
        </div>
        <nav className="side-nav">
          {navItems.map(([key, label]) => (
            <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="profile-box">
          <span className="role-pill">Admin</span>
          <button className="ghost-btn" onClick={() => signOut()}>Logout</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div>
            <p className="eyebrow">Car Craft Autobody</p>
            <h1>{title}</h1>
          </div>
          {activeTab !== 'dashboard' ? (
            <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, vehicle, status..." />
          ) : null}
        </header>

        {activeTab === 'dashboard' ? <Dashboard stats={stats} setActiveTab={setActiveTab} /> : null}
        {activeTab === 'leads' ? <EstimateLeads leads={leads} search={search} /> : null}
        {activeTab === 'appointments' ? <Appointments appointments={appointments} search={search} /> : null}
        {activeTab === 'customers' ? <CustomerDatabase customers={customers} search={search} onDelete={(id) => deleteCustomer({ id })} /> : null}
        {activeTab === 'inventory' ? <InventoryManager vehicles={inventory} search={search} stats={stats} /> : null}
        {activeTab === 'calendar' ? <CalendarView appointments={appointments} /> : null}
      </main>
    </div>
  )
}
