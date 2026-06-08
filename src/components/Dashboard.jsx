const cards = [
  ['newLeads', 'New estimate leads'],
  ['followUps', 'Follow-ups needed'],
  ['bookedAppointments', 'Booked appointments'],
  ['carsInShop', 'Cars in shop'],
  ['completedThisWeek', 'Completed this week'],
  ['activeVehicles', 'Active inventory vehicles'],
  ['soldVehicles', 'Sold vehicles'],
  ['featuredVehicles', 'Featured vehicles']
]

export default function Dashboard({ stats, setActiveTab }) {
  return (
    <>
      <section className="stats-grid">
        {cards.map(([key, label]) => (
          <article className="stat-card" key={key}>
            <span>{label}</span>
            <strong>{stats[key] || 0}</strong>
          </article>
        ))}
      </section>
      <section className="quick-grid">
        <button onClick={() => setActiveTab('leads')}>Review Leads</button>
        <button onClick={() => setActiveTab('appointments')}>Manage Appointments</button>
        <button onClick={() => setActiveTab('inventory')}>Update Inventory</button>
      </section>
    </>
  )
}
