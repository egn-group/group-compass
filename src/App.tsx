import { useEffect, useState } from 'react'
import type { GetMeResponse } from '../shared/schemas/me'
import AdminUsers from './AdminUsers'
import ChairReview from './ChairReview'
import ImportGroups from './ImportGroups'
import NaComments from './NaComments'
import WhoAmI from './WhoAmI'

function App() {
  const [apiResult, setApiResult] = useState<string>('')
  const [me, setMe] = useState<GetMeResponse | null>(null)
  const [meError, setMeError] = useState('')

  useEffect(() => {
    async function loadMe() {
      const res = await fetch('/api/getMe')
      if (!res.ok) {
        setMeError(`Could not load your identity (${res.status}).`)
        return
      }
      setMe((await res.json()) as GetMeResponse)
    }
    void loadMe()
  }, [])

  async function callPing() {
    setApiResult('Calling /api/ping…')
    try {
      const res = await fetch('/api/ping')
      const data: unknown = await res.json()
      setApiResult(JSON.stringify(data))
    } catch (err) {
      setApiResult(`Error: ${String(err)}`)
    }
  }

  const roles = me?.roles ?? []
  const isAdmin = roles.includes('Admin')
  const isChair = roles.includes('Chair')
  const isNetworkAdvisor = roles.includes('NetworkAdvisor')
  // Signed in but no User row yet — not an error, just not bootstrapped.
  // Still show the Users section so a trusted email (INITIAL_ADMIN_EMAILS)
  // can create their own account.
  const notYetBootstrapped = me !== null && roles.length === 0
  const hasAnyBuiltScreen = isAdmin || isChair || isNetworkAdvisor

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
      <h1>Group Compass</h1>
      <WhoAmI email={me?.email ?? null} />
      {meError && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {meError}
        </p>
      )}

      <div className="card" style={{ padding: '28px 32px', margin: '16px 0 32px' }}>
        <p style={{ marginBottom: 16 }}>Scaffold placeholder page.</p>
        <button className="btn btn-primary" onClick={() => void callPing()}>
          Call /api/ping
        </button>
        {apiResult && (
          <p data-testid="api-result" style={{ marginTop: 16, color: 'var(--text-muted)' }}>
            {apiResult}
          </p>
        )}
      </div>

      {(isAdmin || notYetBootstrapped) && <AdminUsers />}
      {isAdmin && <ImportGroups />}
      {isNetworkAdvisor && <NaComments />}
      {isChair && <ChairReview />}
      {me && !notYetBootstrapped && !hasAnyBuiltScreen && (
        <p style={{ color: 'var(--text-muted)' }}>No screens are available for your role(s) yet.</p>
      )}
    </main>
  )
}

export default App
