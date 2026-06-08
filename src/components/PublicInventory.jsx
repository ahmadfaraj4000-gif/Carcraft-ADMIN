import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import fallbackVehicleImage from '../assets/images/branding/carcraft-storefront.png'

export default function PublicInventory() {
  const [showSold, setShowSold] = useState(false)
  const vehicles = useQuery(api.inventory.publicList, { showSold }) || []

  return (
    <section className="public-inventory-app">
      <div className="public-inventory-toolbar">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Current Vehicles For Sale</h2>
          <p>Browse available Car Craft vehicles. Call for the latest pricing, financing details, and availability.</p>
        </div>
        <label className="checkbox-line"><input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} /> Show sold vehicles</label>
      </div>

      <div className="inventory-grid dynamic">
        {vehicles.map((car) => (
          <article className={`inventory-card ${car.featured ? 'featured' : ''}`} key={car._id}>
            <div className="inventory-media">
              <img src={car.photos?.[0]?.url || fallbackVehicleImage} alt={`${car.year} ${car.make} ${car.model}`} />
              <div className="inventory-price">{car.price || 'Call for Price'}</div>
            </div>
            <div className="inventory-copy">
              <h3>{car.year} {car.make} {car.model}</h3>
              <p>{car.description || 'Contact Car Craft for details about this vehicle.'}</p>
              <div className="inventory-specs">
                <div className="inventory-spec">{car.mileage || 'Mileage TBD'}</div>
                <div className="inventory-spec">{car.color || 'Color TBD'}</div>
                <div className="inventory-spec">{car.titleStatus}</div>
                <div className="inventory-spec">{car.status.replaceAll('_', ' ')}</div>
              </div>
              <div className="card-actions">
                <a className="btn btn-primary" href="tel:8609531966">Call Now</a>
              </div>
            </div>
          </article>
        ))}
        {!vehicles.length ? <div className="empty-command-card">No active inventory is published right now. Call 860-953-1966 for availability.</div> : null}
      </div>
    </section>
  )
}
