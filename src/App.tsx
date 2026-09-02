import { useEffect, useState, type ReactNode } from 'react'
import type { GetMeResponse } from '../shared/schemas/me'
import AdminUsers from './AdminUsers'
import ChairReview from './ChairReview'
import ImportGroups from './ImportGroups'
import NaComments from './NaComments'
import WhoAmI from './WhoAmI'

interface Section {
  key: string
  label: string
  render: () => ReactNode
}

function App() {
  const [me, setMe] = useState<GetMeResponse | null>(null)
  const [meError, setMeError] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)

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

  const roles = me?.roles ?? []
  const isAdmin = roles.includes('Admin')
  const isChair = roles.includes('Chair')
  const isNetworkAdvisor = roles.includes('NetworkAdvisor')
  // Signed in but no User row yet — not an error, just not bootstrapped.
  // Show only the Users section (Groups would just 403) so a trusted email
  // (INITIAL_ADMIN_EMAILS) can create their own account.
  const notYetBootstrapped = me !== null && roles.length === 0

  const sections: Section[] = []
  if (isAdmin) {
    sections.push({ key: 'groups', label: 'Groups', render: () => <ImportGroups /> })
    sections.push({ key: 'users', label: 'Users', render: () => <AdminUsers /> })
  } else if (notYetBootstrapped) {
    sections.push({ key: 'users', label: 'Users', render: () => <AdminUsers /> })
  }
  if (isNetworkAdvisor) {
    sections.push({ key: 'na-groups', label: 'My groups', render: () => <NaComments /> })
  }
  if (isChair) {
    sections.push({ key: 'chair-groups', label: 'My groups', render: () => <ChairReview /> })
  }

  // The active tab falls back to the first available section whenever the
  // current activeKey isn't (or is no longer) one of them — covers both the
  // initial load (activeKey starts null) and a hypothetical role change.
  const activeSection = sections.find((s) => s.key === activeKey) ?? sections[0]

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
      <h1>Group Compass</h1>
      <WhoAmI email={me?.email ?? null} />
      {meError && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {meError}
        </p>
      )}

      {sections.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={s.key === activeSection?.key ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setActiveKey(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {activeSection?.render()}

      {me && !notYetBootstrapped && sections.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No screens are available for your role(s) yet.</p>
      )}
    </main>
  )
}

export default App
