import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import PaymentPage from './PaymentPage'
import './payments.css'
import '../secureTransport.js'

const url = import.meta.env.VITE_CONVEX_URL
let problem = ''
try {
  globalThis.CarCraftTransport.requireSecurePage()
  globalThis.CarCraftTransport.requireHttpsUrl(url)
} catch { problem = 'Online payment is currently unavailable. Please call Car Craft at 860-953-1966.' }
const client = problem ? null : new ConvexReactClient(url)
class PaymentBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="invoice-card" role="alert">The invoice could not be loaded. Please call Car Craft at <a href="tel:+18609531966">860-953-1966</a>.</main> : this.props.children }
}
createRoot(document.getElementById('root')).render(<React.StrictMode><PaymentBoundary>{problem ? <main className="invoice-card" role="alert">{problem}</main> : <ConvexProvider client={client}><PaymentPage /></ConvexProvider>}</PaymentBoundary></React.StrictMode>)
