import { useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'

export default function Login() {
  const { signIn } = useAuthActions()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signIn('password', { email, password, flow: 'signIn' })
    } catch (err) {
      setError(err.message || 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Car Craft Autobody</p>
        <h1>Admin Portal</h1>
        <p className="muted">Sign in with Convex Auth to manage estimates, appointments, customers, and inventory.</p>
        {error ? <div className="error-box">{error}</div> : null}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button disabled={loading}>{loading ? 'Working...' : 'Login'}</button>
      </form>
    </section>
  )
}
