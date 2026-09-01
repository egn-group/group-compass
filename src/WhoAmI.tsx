import { useEffect, useState } from 'react'
import type { GetMeResponse } from '../shared/schemas/me'

// Proves the real Entra ID sign-in flow end-to-end (issue #13): this page
// is only reachable at all once SWA's edge auth has let the caller
// through, and the email shown here comes from api/getMe reading the
// SWA-decoded x-ms-client-principal header, not anything the client sent.
function WhoAmI() {
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/getMe')
      if (!res.ok) {
        setError(`Could not load your identity (${res.status}).`)
        return
      }
      const body = (await res.json()) as GetMeResponse
      setEmail(body.email)
    }
    void load()
  }, [])

  return (
    <section className="card" style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {error && (
        <p role="alert" style={{ color: 'var(--status-danger)' }}>
          {error}
        </p>
      )}
      {!error && <p data-testid="who-am-i">{email ? `Signed in as ${email}` : 'Loading…'}</p>}
      <a className="btn btn-secondary" href="/.auth/logout">
        Sign out
      </a>
    </section>
  )
}

export default WhoAmI
