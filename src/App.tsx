import { useState } from 'react'
import AdminUsers from './AdminUsers'

function App() {
  const [apiResult, setApiResult] = useState<string>('')

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

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
      <h1>Group Compass</h1>
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
      <AdminUsers />
    </main>
  )
}

export default App
