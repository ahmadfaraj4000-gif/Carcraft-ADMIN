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
import logoUrl from './assets/images/branding/carcraft-logo.png'

function Icon({ children }) {
  return (
    <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  )
}

const icons = {
  dashboard: (
    <Icon>
      <path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </Icon>
  ),
  leads: (
    <Icon>
      <path d="M5 4h14v16H5V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  appointments: (
    <Icon>
      <path d="M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  customers: (
    <Icon>
      <path d="M16 19a4 4 0 0 0-8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 19a3 3 0 0 0-3-3M4 19a3 3 0 0 1 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  inventory: (
    <Icon>
      <path d="M5 16h14l-1.5-5.5A3 3 0 0 0 14.6 8H9.4a3 3 0 0 0-2.9 2.5L5 16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 16v2M17 16v2M8 18h8M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  calendar: (
    <Icon>
      <path d="M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h2M13 14h3M8 17h2M13 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  ),
  menu: (
    <Icon>
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  )
}

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
  const [navCollapsed, setNavCollapsed] = useState(false)

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
    <div className={`app-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <aside className={`sidebar ${navCollapsed ? 'collapsed' : ''}`}>
        <div className="brand-block">
          <img className="brand-logo" src={logoUrl} alt="Car Craft Autobody" />
        </div>
        <button className="nav-toggle" type="button" onClick={() => setNavCollapsed((current) => !current)} aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}>
          {icons.menu}
          <span>{navCollapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        <nav className="side-nav" aria-label="Admin navigation">
          {navItems.map(([key, label]) => (
            <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)} title={label} aria-label={label}>
              {icons[key]}
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="profile-box">
          <span className="role-pill">Admin</span>
          <button className="ghost-btn logout-btn" onClick={() => signOut()} title="Logout" aria-label="Logout">
            {icons.logout}
            <span>Logout</span>
          </button>
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
