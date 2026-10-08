import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import App from './App'
import './styles.css'
import './secureTransport.js'

const convexUrl = import.meta.env.VITE_CONVEX_URL || 'https://configure-convex-url.convex.cloud'
let transportError = ''
try {
  globalThis.CarCraftTransport.requireSecurePage()
  globalThis.CarCraftTransport.requireHttpsUrl(convexUrl)
} catch (error) { transportError = error.message }
const convex = transportError ? null : new ConvexReactClient(convexUrl)

function Router() {
  if (!import.meta.env.VITE_CONVEX_URL) {
    return (
      <div className="loading-screen">
        <div className="auth-card">
          <p className="eyebrow">Configuration Needed</p>
          <h1>Set VITE_CONVEX_URL</h1>
          <p className="muted">Add the admin deployment URL to `.env.local`.</p>
        </div>
      </div>
    )
  }

  return <App />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {transportError ? <main className="loading-screen" role="alert">{transportError}</main> : <ConvexAuthProvider client={convex}>
      <Router />
    </ConvexAuthProvider>}
  </React.StrictMode>
)
