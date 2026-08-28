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
    <main>
      <h1>Group Compass</h1>
      <p>Scaffold placeholder page.</p>
      <button onClick={() => void callPing()}>Call /api/ping</button>
      {apiResult && <p data-testid="api-result">{apiResult}</p>}
      <AdminUsers />
    </main>
  )
}

export default App
