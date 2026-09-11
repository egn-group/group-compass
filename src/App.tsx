import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { GetMeResponse } from '../shared/schemas/me'
import type { UserDto } from '../shared/schemas/user'
import AdminUsers from './AdminUsers'
import ChairReview from './ChairReview'
import Header from './Header'
import ImportGroups from './ImportGroups'
import { apiGet } from './lib/api'
import Modal from './Modal'
import NaComments from './NaComments'

// Set by the deploy workflow to github.sha — undefined in local dev, where
// there's nothing to verify a push against.
const commitSha = import.meta.env.VITE_COMMIT_SHA

interface Section {
  key: string
  label: string
  render: () => ReactNode
}

interface ViewAsTarget {
  email: string
  name: string
  role: 'Chair' | 'NetworkAdvisor'
  // Starts false (read-only preview) every time a new target is picked —
  // "Enable actions" is a deliberate second opt-in on top of View as
  // itself, not the default, since real writes here land in the same
  // database real Chairs/NAs use (api/shared/auth.ts's resolveActingAs).
  canEdit: boolean
}

function App() {
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<GetMeResponse>('/api/getMe', 'Could not load your identity'),
  })
  const me = meQuery.data ?? null
  const meError = meQuery.isError ? meQuery.error.message : ''
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Admin-only "View as" preview (read-only — see api/shared/auth.ts's
  // resolveViewAs) — a separate render mode from the normal tab shell
  // below, entered/exited independently of it.
  const [viewAs, setViewAs] = useState<ViewAsTarget | null>(null)
  const [viewAsPickerOpen, setViewAsPickerOpen] = useState(false)
  const viewAsUsersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<UserDto[]>('/api/getUsers', 'Could not load users'),
    enabled: viewAsPickerOpen,
  })
  const viewAsUsers = viewAsUsersQuery.data ?? []
  const viewAsError = viewAsUsersQuery.isError ? viewAsUsersQuery.error.message : ''

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

  function openViewAsPicker() {
    setViewAsPickerOpen(true)
  }

  function selectViewAs(user: UserDto, role: 'Chair' | 'NetworkAdvisor') {
    setViewAs({ email: user.email, name: user.name, role, canEdit: false })
    setViewAsPickerOpen(false)
  }

  const chairsToViewAs = viewAsUsers.filter((u) => u.roles.includes('Chair'))
  const advisorsToViewAs = viewAsUsers.filter((u) => u.roles.includes('NetworkAdvisor'))

  return (
    <>
      <Header email={me?.email ?? null} name={me?.name ?? null} initials={me?.initials ?? null} isAdmin={isAdmin} onOpenViewAs={openViewAsPicker} />

      <main className="page-container" style={{ paddingTop: 32, paddingBottom: 32 }}>
        {meError && (
          <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
            {meError}
          </p>
        )}

        {viewAs ? (
          <>
            <div
              className="card"
              style={{
                // Amber once actions are enabled — a real-writes session
                // should never look identical to a plain read-only preview.
                background: viewAs.canEdit ? '#fffbeb' : 'var(--egn-light-blue)',
                padding: '12px 20px',
                marginBottom: 24,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <p>
                {viewAs.canEdit ? 'Acting as' : 'Viewing as'} <strong>{viewAs.name}</strong> ({viewAs.role === 'Chair' ? 'Chair' : 'Network Advisor'})
                {viewAs.canEdit
                  ? ' — actions taken here are real and attributed to them, not to you.'
                  : ' — read-only, no actions can be taken from here.'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setViewAs((v) => (v ? { ...v, canEdit: !v.canEdit } : v))}>
                  {viewAs.canEdit ? 'Disable actions' : 'Enable actions (testing)'}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setViewAs(null)}>
                  Exit view as
                </button>
              </div>
            </div>
            {viewAs.role === 'Chair' ? (
              <ChairReview viewAsEmail={viewAs.email} viewAsCanEdit={viewAs.canEdit} />
            ) : (
              <NaComments viewAsEmail={viewAs.email} viewAsCanEdit={viewAs.canEdit} />
            )}
          </>
        ) : (
          <>
            {sections.length > 0 && (
              <div style={{ display: 'flex', gap: 28, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
                {sections.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`tabBtn ${s.key === activeSection?.key ? 'on' : ''}`}
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
          </>
        )}
      </main>

      {viewAsPickerOpen && (
        <Modal title="View as" onClose={() => setViewAsPickerOpen(false)}>
          {viewAsError && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {viewAsError}
            </p>
          )}
          <h3 style={{ marginBottom: 8 }}>Chairs</h3>
          {chairsToViewAs.length === 0 && <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No Chairs yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {chairsToViewAs.map((u) => (
              <button key={u.email} type="button" className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => selectViewAs(u, 'Chair')}>
                {u.name} — {u.email}
              </button>
            ))}
          </div>
          <h3 style={{ marginBottom: 8 }}>Network Advisors</h3>
          {advisorsToViewAs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No Network Advisors yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {advisorsToViewAs.map((u) => (
              <button key={u.email} type="button" className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => selectViewAs(u, 'NetworkAdvisor')}>
                {u.name} — {u.email}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {commitSha && (
        <p
          title={`Deployed commit ${commitSha}`}
          style={{
            position: 'fixed',
            right: 8,
            bottom: 8,
            margin: 0,
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--text-muted)',
            opacity: 0.6,
            pointerEvents: 'none',
            zIndex: 50,
          }}
        >
          {commitSha.slice(0, 7)}
        </p>
      )}
    </>
  )
}

export default App
