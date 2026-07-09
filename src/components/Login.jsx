import { useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import logoUrl from '../assets/images/branding/carcraft-logo.png'

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
        <img className="auth-logo" src={logoUrl} alt="Car Craft Autobody" />
        <p className="eyebrow">Admin Portal</p>
        <h1>Sign in</h1>
        {error ? <div className="error-box">{error}</div> : null}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button disabled={loading}>{loading ? 'Working...' : 'Login'}</button>
      </form>
    </section>
  )
}
