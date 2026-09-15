import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiGet } from './lib/api'
import { formatFieldText } from './lib/formatFieldText'
import type { DnaFieldValue } from '../shared/schemas/dna'
import type { GetNaGroupsResponse } from '../shared/schemas/naComment'

const STATUS_LABEL: Record<string, { text: string; bg: string; color: string }> = {
  ChairReview: { text: 'Sent — waiting on the Chair', bg: 'var(--egn-light-blue)', color: 'var(--status-info)' },
  Approved: { text: 'Approved by Chair', bg: '#ecfdf5', color: 'var(--status-success)' },
}

const FIELDS: Array<{ field: DnaFieldValue; label: string; textKey: 'groupProfile' | 'memberProfile' | 'companiesProfile' }> = [
  { field: 'GroupProfile', label: 'Group Profile', textKey: 'groupProfile' },
  { field: 'MemberProfile', label: 'Member Profile', textKey: 'memberProfile' },
  { field: 'CompaniesProfile', label: 'Companies Profile', textKey: 'companiesProfile' },
]

interface NaCommentsProps {
  // Set only by App.tsx's Admin-only "View as" preview — when present, the
  // fetch here carries x-view-as-email. Read-only by default (server-side:
  // api/shared/auth.ts's resolveViewAs); App.tsx's own "Enable actions"
  // toggle flips viewAsCanEdit on, at which point the mutating endpoints
  // also honor the header (resolveActingAs) and this component's own
  // mutating controls render too.
  viewAsEmail?: string
  viewAsCanEdit?: boolean
}

function NaComments({ viewAsEmail, viewAsCanEdit }: NaCommentsProps = {}) {
  const readOnly = !!viewAsEmail && !viewAsCanEdit
  const queryClient = useQueryClient()
  const viewAsKey = viewAsEmail ?? null
  const [dismissed, setDismissed] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<DnaFieldValue, string>>>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({})

  const viewAsHeaders: HeadersInit | undefined = viewAsEmail ? { 'x-view-as-email': viewAsEmail } : undefined

  const groupsQuery = useQuery({
    queryKey: ['naGroups', viewAsKey],
    queryFn: () => apiGet<GetNaGroupsResponse>('/api/getNaGroups', 'Could not load groups', viewAsHeaders),
  })
  const groups = groupsQuery.data?.groups ?? []
  const error = groupsQuery.isError ? groupsQuery.error.message : ''
  const showGuidance = (groupsQuery.data?.showGuidance ?? false) && !dismissed

  useEffect(() => {
    // App.tsx can switch "View as" targets without unmounting this
    // component — a locally-dismissed guidance banner shouldn't carry over
    // to a different identity's own dismissal state.
    setDismissed(false)
  }, [viewAsEmail])

  function dismissGuidance() {
    // Dismiss immediately — a failed server write just means the banner
    // reappears next visit, not worth blocking the UI on.
    setDismissed(true)
    void fetch('/api/dismissNaGuidance', { method: 'POST', headers: viewAsHeaders })
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
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId, comments }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setGroupErrors((e) => ({ ...e, [groupId]: body?.error ?? `Send failed (${res.status}).` }))
        return
      }
      // The group stays in this list (now read-only) rather than
      // disappearing — refetch so its lifecycleStatus flips from server.
      await queryClient.invalidateQueries({ queryKey: ['naGroups', viewAsKey] })
    } finally {
      setSending((s) => ({ ...s, [groupId]: false }))
    }
  }

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

      {groups.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No groups have been assigned to you yet.</p>}

      {groups.map((g) => {
        // Editable only while it's still awaiting the NA's own comment —
        // once sent, the group stays in this list but turns read-only
        // (prototype parity would have hidden it entirely; this build keeps
        // it visible so the NA can track it through to the Chair's approval).
        const editable = !readOnly && g.lifecycleStatus === 'Launched'
        const statusMeta = STATUS_LABEL[g.lifecycleStatus]
        return (
          <div key={g.id} className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3>{g.name}</h3>
              {statusMeta && (
                <span className="badge" style={{ background: statusMeta.bg, color: statusMeta.color }}>
                  {statusMeta.text}
                </span>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>Chair: {g.chairName ?? '—'}</p>
            {FIELDS.map((f) => (
              <div key={f.field} className="field">
                <label className="lbl">{f.label}</label>
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{formatFieldText(g[f.textKey])}</p>
                {editable && (
                  <>
                    <label className="lbl" htmlFor={`comment-${g.id}-${f.field}`}>
                      Comment for the Chair (optional)
                    </label>
                    <textarea
                      id={`comment-${g.id}-${f.field}`}
                      value={drafts[g.id]?.[f.field] ?? ''}
                      onChange={(e) => updateDraft(g.id, f.field, e.target.value)}
                    />
                  </>
                )}
              </div>
            ))}
            {groupErrors[g.id] && (
              <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 8 }}>
                {groupErrors[g.id]}
              </p>
            )}
            {editable && (
              <button type="button" className="btn btn-primary" disabled={!!sending[g.id]} onClick={() => void sendToChair(g.id)}>
                {sending[g.id] ? 'Sending…' : 'Send to Chair'}
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}

export default NaComments
