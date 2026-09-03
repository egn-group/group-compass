import { useEffect, useRef, useState } from 'react'
import type { DnaFieldValue } from '../shared/schemas/dna'
import type { GetNaGroupsResponse, NaGroupDto } from '../shared/schemas/naComment'

const FIELDS: Array<{ field: DnaFieldValue; label: string; textKey: 'groupProfile' | 'memberProfile' | 'companiesProfile' }> = [
  { field: 'GroupProfile', label: 'Group Profile', textKey: 'groupProfile' },
  { field: 'MemberProfile', label: 'Member Profile', textKey: 'memberProfile' },
  { field: 'CompaniesProfile', label: 'Companies Profile', textKey: 'companiesProfile' },
]

interface NaCommentsProps {
  // Set only by App.tsx's Admin-only "View as" preview — when present, the
  // fetch here carries x-view-as-email (honored server-side, read-only —
  // see api/shared/auth.ts's resolveViewAs) and every mutating action in
  // this component is hidden/disabled.
  viewAsEmail?: string
}

function NaComments({ viewAsEmail }: NaCommentsProps = {}) {
  const readOnly = !!viewAsEmail
  const [groups, setGroups] = useState<NaGroupDto[]>([])
  const [showGuidance, setShowGuidance] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<DnaFieldValue, string>>>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({})
  const [sentGroupIds, setSentGroupIds] = useState<Set<string>>(new Set())

  // Guards against an earlier, slower loadGroups() call resolving after a
  // later one and overwriting fresher state with stale data.
  const groupsRequestId = useRef(0)

  const viewAsHeaders: HeadersInit | undefined = viewAsEmail ? { 'x-view-as-email': viewAsEmail } : undefined

  async function loadGroups() {
    setError('')
    const id = ++groupsRequestId.current
    const res = await fetch('/api/getNaGroups', { headers: viewAsHeaders })
    if (id !== groupsRequestId.current) return
    if (!res.ok) {
      setError(`Could not load groups (${res.status}).`)
      return
    }
    const body = (await res.json()) as GetNaGroupsResponse
    setGroups(body.groups)
    setShowGuidance(body.showGuidance)
  }

  useEffect(() => {
    // Re-fires on a viewAsEmail change too — App.tsx can switch "View as"
    // targets without unmounting this component, so an empty dep array
    // would leave a stale, wrongly-attributed group list on screen.
    void loadGroups()
  }, [viewAsEmail])

  function dismissGuidance() {
    // Dismiss immediately — a failed server write just means the banner
    // reappears next visit, not worth blocking the UI on.
    setShowGuidance(false)
    void fetch('/api/dismissNaGuidance', { method: 'POST' })
  }

  function updateDraft(groupId: string, field: DnaFieldValue, text: string) {
    setDrafts((d) => ({ ...d, [groupId]: { ...d[groupId], [field]: text } }))
  }

  async function sendToChair(groupId: string) {
    const groupDrafts = drafts[groupId] ?? {}
    const comments = FIELDS.map((f) => ({ field: f.field, text: (groupDrafts[f.field] ?? '').trim() })).filter((c) => c.text)
    setGroupErrors((e) => ({ ...e, [groupId]: '' }))
    if (!comments.length) {
      setGroupErrors((e) => ({ ...e, [groupId]: 'Add at least one comment before sending to the Chair.' }))
      return
    }
    setSending((s) => ({ ...s, [groupId]: true }))
    try {
      const res = await fetch('/api/putNaComments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, comments }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setGroupErrors((e) => ({ ...e, [groupId]: body?.error ?? `Send failed (${res.status}).` }))
        return
      }
      setSentGroupIds((s) => new Set(s).add(groupId))
    } finally {
      setSending((s) => ({ ...s, [groupId]: false }))
    }
  }

  const pendingGroups = groups.filter((g) => !sentGroupIds.has(g.id))

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <h2 style={{ marginBottom: 16 }}>Network Advisor — comment on your groups</h2>
      {error && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {error}
        </p>
      )}

      {showGuidance && !readOnly && (
        <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 16, marginBottom: 16 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>When you read a Group DNA, please consider the following:</p>
          <ul style={{ marginBottom: 12, paddingLeft: 18 }}>
            <li>Do you agree with the text as it is written?</li>
            <li>Are there exceptions for the group where the Group DNA does not apply?</li>
            <li>Do we do anything else that should be reflected in the Group DNA?</li>
          </ul>
          <button type="button" className="btn" onClick={dismissGuidance}>
            Got it
          </button>
        </div>
      )}

      {pendingGroups.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No groups are waiting for your comment right now.</p>
      )}

      {pendingGroups.map((g) => (
        <div key={g.id} className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginBottom: 4 }}>{g.name}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>Chair: {g.chairName ?? '—'}</p>
          {FIELDS.map((f) => (
            <div key={f.field} className="field">
              <label className="lbl">{f.label}</label>
              <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{g[f.textKey]}</p>
              <label className="lbl" htmlFor={`comment-${g.id}-${f.field}`}>
                Comment for the Chair (optional)
              </label>
              <textarea
                id={`comment-${g.id}-${f.field}`}
                value={drafts[g.id]?.[f.field] ?? ''}
                onChange={(e) => updateDraft(g.id, f.field, e.target.value)}
                disabled={readOnly}
              />
            </div>
          ))}
          {groupErrors[g.id] && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 8 }}>
              {groupErrors[g.id]}
            </p>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-primary" disabled={!!sending[g.id]} onClick={() => void sendToChair(g.id)}>
              {sending[g.id] ? 'Sending…' : 'Send to Chair'}
            </button>
          )}
        </div>
      ))}
    </section>
  )
}

export default NaComments
