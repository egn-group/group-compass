import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiGet } from './lib/api'
import { formatFieldText } from './lib/formatFieldText'
import type { DnaFieldValue } from '../shared/schemas/dna'
import type { ChairChatResponse, ChairGroupDetail, ChairGroupListItem, ConversationTurnDto } from '../shared/schemas/chairReview'

const FIELD_LABELS: Record<DnaFieldValue, string> = {
  GroupProfile: 'Group Profile',
  MemberProfile: 'Member Profile',
  CompaniesProfile: 'Companies Profile',
}
const ALL_FIELDS: DnaFieldValue[] = ['GroupProfile', 'MemberProfile', 'CompaniesProfile']

const STATUS_LABEL: Record<string, string> = {
  Launched: 'Waiting on Network Advisor',
  ChairReview: 'Needs your review',
  Approved: 'Approved',
}

type StatusFilter = 'all' | 'Launched' | 'ChairReview' | 'Approved'

interface ChairReviewProps {
  // Set only by App.tsx's Admin-only "View as" preview — when present,
  // every fetch here carries x-view-as-email. Read-only by default
  // (server-side: api/shared/auth.ts's resolveViewAs); App.tsx's own
  // "Enable actions" toggle flips viewAsCanEdit on, at which point the
  // mutating endpoints also honor the header (resolveActingAs) and this
  // component's own mutating controls render too.
  viewAsEmail?: string
  viewAsCanEdit?: boolean
}

function ChairReview({ viewAsEmail, viewAsCanEdit }: ChairReviewProps = {}) {
  const readOnly = !!viewAsEmail && !viewAsCanEdit
  const queryClient = useQueryClient()
  const viewAsKey = viewAsEmail ?? null
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [justFullyApproved, setJustFullyApproved] = useState(false)

  const [editingField, setEditingField] = useState<DnaFieldValue | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busyField, setBusyField] = useState<DnaFieldValue | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DnaFieldValue, string>>>({})
  const [reapproving, setReapproving] = useState(false)

  // AI assistant chat (issue #26) — at most one field's chat is open at a
  // time, mirroring "only one editing mode per field at once" from #25.
  const [chatField, setChatField] = useState<DnaFieldValue | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [suggestions, setSuggestions] = useState<Array<{ field: DnaFieldValue; suggestion: string }> | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  // NA comment actions (Accept/Include, Disregard, Copy — prototype parity,
  // HANDOFF.md §1's renderNaArea) — keyed by commentId since several
  // comments (on different fields) could be busy/erroring independently.
  const [commentBusy, setCommentBusy] = useState<Record<string, boolean>>({})
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({})
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null)
  // Resolved comments stay out of sight by default, one toggle per field
  // (prototype parity, HANDOFF.md §1's naToggle).
  const [expandedResolvedComments, setExpandedResolvedComments] = useState<Partial<Record<DnaFieldValue, boolean>>>({})
  // Single-level "Undo last change" per field (prototype parity,
  // HANDOFF.md §1's previousText/undoField).
  const [undoingField, setUndoingField] = useState<DnaFieldValue | null>(null)

  const viewAsHeaders: HeadersInit | undefined = viewAsEmail ? { 'x-view-as-email': viewAsEmail } : undefined

  const groupsQuery = useQuery({
    queryKey: ['chairGroups', viewAsKey],
    queryFn: () => apiGet<{ groups: ChairGroupListItem[] }>('/api/getChairGroups', 'Could not load groups', viewAsHeaders),
  })
  const groups = groupsQuery.data?.groups ?? []
  const error = groupsQuery.isError ? groupsQuery.error.message : ''

  useEffect(() => {
    // App.tsx can switch "View as" targets without unmounting this
    // component — clear the selection so a stale, wrongly-attributed group
    // detail can't stay on screen under the new identity.
    setSelectedGroupId(null)
  }, [viewAsEmail])

  const detailQuery = useQuery({
    queryKey: ['chairGroup', selectedGroupId, viewAsKey],
    queryFn: () => apiGet<ChairGroupDetail>(`/api/getChairGroup?groupId=${encodeURIComponent(selectedGroupId!)}`, 'Could not load this group', viewAsHeaders),
    enabled: selectedGroupId !== null,
  })
  const detail = detailQuery.data ?? null
  const detailError = detailQuery.isError ? detailQuery.error.message : ''
  // Read-only whenever the Admin's "View as" preview is active, OR the group
  // is still Launched (waiting on the NA) — the Chair can see the AI draft
  // for transparency, but every mutating endpoint on this group rejects
  // until it reaches ChairReview/Approved (requireChairReviewable, server-
  // side; this is convenience only).
  const canEdit = !readOnly && detail?.lifecycleStatus !== 'Launched'

  function openGroup(groupId: string) {
    setSelectedGroupId(groupId)
    setJustFullyApproved(false)
    setFieldErrors({})
    setEditingField(null)
    closeChat()
    setSuggestions(null)
    setCommentBusy({})
    setCommentErrors({})
    setCopiedCommentId(null)
    setExpandedResolvedComments({})
    setUndoingField(null)
  }

  function backToList() {
    setSelectedGroupId(null)
    closeChat()
    setSuggestions(null)
  }

  async function approveField(field: DnaFieldValue) {
    if (!selectedGroupId) return
    setFieldErrors((e) => ({ ...e, [field]: '' }))
    setBusyField(field)
    try {
      const res = await fetch('/api/approveChairField', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, field }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFieldErrors((e) => ({ ...e, [field]: body?.error ?? `Approve failed (${res.status}).` }))
        return
      }
      const data = (await res.json()) as { justFullyApproved: boolean }
      if (data.justFullyApproved) setJustFullyApproved(true)
      await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
      await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
    } finally {
      setBusyField(null)
    }
  }

  function startEdit(field: DnaFieldValue, currentText: string) {
    closeChat()
    setEditingField(field)
    setEditDraft(currentText)
    setFieldErrors((e) => ({ ...e, [field]: '' }))
  }
  function cancelEdit() {
    setEditingField(null)
    setEditDraft('')
  }

  async function saveEdit(field: DnaFieldValue) {
    if (!selectedGroupId) return
    setBusyField(field)
    try {
      const res = await fetch('/api/editChairField', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, field, text: editDraft }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFieldErrors((e) => ({ ...e, [field]: body?.error ?? `Save failed (${res.status}).` }))
        return
      }
      const data = (await res.json()) as { aiFeedback: string | null }
      setEditingField(null)
      setEditDraft('')
      // All AI interaction happens in the chat, not an inline card — the
      // edit note + feedback are already posted to this field's own
      // conversation (editChairField); opening it here just shows that.
      // Null means the text didn't actually change — nothing to show.
      if (data.aiFeedback !== null) openChat(field)
      await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
      await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
    } finally {
      setBusyField(null)
    }
  }

  async function reapprove() {
    if (!selectedGroupId) return
    setReapproving(true)
    try {
      const res = await fetch('/api/reapproveChairGroup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId }),
      })
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
        await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
      }
    } finally {
      setReapproving(false)
    }
  }

  async function refreshAfterCommentAction() {
    await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
    await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
  }

  async function includeComment(commentId: string) {
    if (!selectedGroupId) return
    setCommentErrors((e) => ({ ...e, [commentId]: '' }))
    setCommentBusy((b) => ({ ...b, [commentId]: true }))
    try {
      const res = await fetch('/api/includeChairComment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, commentId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setCommentErrors((e) => ({ ...e, [commentId]: body?.error ?? `Include failed (${res.status}).` }))
        return
      }
      await refreshAfterCommentAction()
    } finally {
      setCommentBusy((b) => ({ ...b, [commentId]: false }))
    }
  }

  async function disregardComment(commentId: string) {
    if (!selectedGroupId) return
    setCommentErrors((e) => ({ ...e, [commentId]: '' }))
    setCommentBusy((b) => ({ ...b, [commentId]: true }))
    try {
      const res = await fetch('/api/disregardChairComment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, commentId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setCommentErrors((e) => ({ ...e, [commentId]: body?.error ?? `Disregard failed (${res.status}).` }))
        return
      }
      await refreshAfterCommentAction()
    } finally {
      setCommentBusy((b) => ({ ...b, [commentId]: false }))
    }
  }

  async function copyComment(commentId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // "Copied" confirmation just won't appear; not worth surfacing an error.
      return
    }
    setCopiedCommentId(commentId)
    setTimeout(() => setCopiedCommentId((id) => (id === commentId ? null : id)), 1500)
  }

  async function undoField(field: DnaFieldValue) {
    if (!selectedGroupId) return
    setFieldErrors((e) => ({ ...e, [field]: '' }))
    setUndoingField(field)
    try {
      const res = await fetch('/api/undoChairField', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, field }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFieldErrors((e) => ({ ...e, [field]: body?.error ?? `Undo failed (${res.status}).` }))
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
      await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
    } finally {
      setUndoingField(null)
    }
  }

  const chatQuery = useQuery({
    queryKey: ['chairChat', selectedGroupId, chatField],
    queryFn: () =>
      apiGet<{ turns: ConversationTurnDto[] }>(
        `/api/getChairFieldConversation?groupId=${encodeURIComponent(selectedGroupId!)}&field=${chatField}`,
        'Could not load this conversation',
        viewAsHeaders,
      ),
    enabled: selectedGroupId !== null && chatField !== null,
  })
  const chatTurns = chatQuery.data?.turns ?? []
  const chatLoadError = chatQuery.isError ? chatQuery.error.message : ''

  function openChat(field: DnaFieldValue) {
    setChatField(field)
    setChatError('')
    setChatInput('')
    setEditingField(null)
  }
  function closeChat() {
    setChatField(null)
    setChatInput('')
  }
  useEffect(() => {
    if (chatField === null) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeChat()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [chatField])

  async function sendChatMessage() {
    if (!selectedGroupId || !chatField || !chatInput.trim()) return
    const field = chatField
    const message = chatInput.trim()
    setChatInput('')
    setChatBusy(true)
    setChatError('')
    try {
      const res = await fetch('/api/chairChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId, field, message }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setChatError(body?.error ?? `Send failed (${res.status}).`)
        return
      }
      const data = (await res.json()) as ChairChatResponse
      void data // the refreshed conversation below already reflects this turn
      await queryClient.invalidateQueries({ queryKey: ['chairChat', selectedGroupId, field] })
    } finally {
      setChatBusy(false)
    }
  }

  async function acceptProposal(turnId: string) {
    if (!selectedGroupId || !chatField) return
    setChatBusy(true)
    try {
      const res = await fetch('/api/acceptChairProposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ turnId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setChatError(body?.error ?? `Accept failed (${res.status}).`)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['chairChat', selectedGroupId, chatField] })
      // Accepting a proposal saves it the same way saveEdit does (see
      // acceptChairProposal's own comment) — the field text and the list's
      // pendingReapproval/lifecycleStatus can both change.
      await queryClient.invalidateQueries({ queryKey: ['chairGroup', selectedGroupId, viewAsKey] })
      await queryClient.invalidateQueries({ queryKey: ['chairGroups', viewAsKey] })
    } finally {
      setChatBusy(false)
    }
  }

  async function rejectProposal(turnId: string) {
    if (!chatField) return
    setChatBusy(true)
    try {
      const res = await fetch('/api/rejectChairProposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ turnId }),
      })
      if (res.ok) await queryClient.invalidateQueries({ queryKey: ['chairChat', selectedGroupId, chatField] })
    } finally {
      setChatBusy(false)
    }
  }

  async function checkSuggestions() {
    if (!selectedGroupId) return
    setSuggestionsLoading(true)
    try {
      const res = await fetch('/api/suggestImprovements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...viewAsHeaders },
        body: JSON.stringify({ groupId: selectedGroupId }),
      })
      if (res.ok) {
        const data = (await res.json()) as { suggestions: Array<{ field: DnaFieldValue; suggestion: string }> }
        setSuggestions(data.suggestions)
      }
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const visibleGroups = groups.filter((g) => {
    if (statusFilter !== 'all' && g.lifecycleStatus !== statusFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return g.name.toLowerCase().includes(q) || (g.networkAdvisorName ?? '').toLowerCase().includes(q)
  })

  if (!selectedGroupId) {
    return (
      <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>My groups</h2>
        {error && (
          <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            aria-label="Search by group or Network Advisor"
            placeholder="Search by group or Network Advisor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 280, width: 'auto' }}
          />
          {(['all', 'ChairReview', 'Launched', 'Approved'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={f === statusFilter ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setStatusFilter(f)}
            >
              {f === 'all' ? 'All groups' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--egn-sand)' }}>
                <th style={cellStyle}>Group</th>
                <th style={cellStyle}>Network Advisor</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...cellStyle, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No groups match this view.
                  </td>
                </tr>
              )}
              {visibleGroups.map((g) => (
                <tr
                  key={g.id}
                  style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => openGroup(g.id)}
                >
                  <td style={cellStyle}>{g.name}</td>
                  <td style={cellStyle}>{g.networkAdvisorName ?? '—'}</td>
                  <td style={cellStyle}>
                    {STATUS_LABEL[g.lifecycleStatus] ?? g.lifecycleStatus}
                    {g.pendingReapproval && ' (edited since approval)'}
                  </td>
                  <td style={cellStyle}>
                    {/* Pinned to en-GB, not the browser's default locale — see
                        ImportGroups.tsx's own DNA-version-date comment: this
                        app's chrome is day-first with a 24-hour clock
                        everywhere, not whatever a US-locale browser would show. */}
                    {new Date(g.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <button type="button" className="btn" style={{ marginBottom: 16 }} onClick={backToList}>
        ← Back to My groups
      </button>
      {detailError && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {detailError}
        </p>
      )}
      {!detail && !detailError && <p>Loading…</p>}
      {detail && (
        <>
          <h2 style={{ marginBottom: 4 }}>{detail.name}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            {detail.country} · Network Advisor: {detail.networkAdvisorName ?? '—'} · {STATUS_LABEL[detail.lifecycleStatus] ?? detail.lifecycleStatus}
          </p>

          {detail.lifecycleStatus === 'Launched' && (
            // Waiting on the NA (spec §5/§11) — the AI draft is still shown
            // below, read-only (canEdit is false), so the Chair can preview
            // it; only the editing affordances are gated. Server-side,
            // every mutating endpoint on this group rejects the same way
            // (requireChairReviewable) — this banner is convenience, not
            // the actual boundary.
            <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 16, marginBottom: 16 }}>
              <p>
                This group has been launched. {detail.networkAdvisorName ?? 'The Network Advisor'} has been invited to comment on
                the auto-generated DNA below. You&apos;ll be notified as soon as the comments are ready for your review.
              </p>
            </div>
          )}

          {justFullyApproved && (
            <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 16, marginBottom: 16 }}>
              Thank you — the DNA has been updated. It will be updated in Salesforce within five business days.
            </div>
          )}

          {canEdit && detail.lifecycleStatus === 'Approved' && detail.pendingReapproval && (
            <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 16, marginBottom: 16 }}>
              <p style={{ marginBottom: 8 }}>You&apos;ve edited this DNA since it was last approved.</p>
              <button type="button" className="btn btn-primary" disabled={reapproving} onClick={() => void reapprove()}>
                {reapproving ? 'Approving…' : 'Approve whole DNA'}
              </button>
            </div>
          )}

          {ALL_FIELDS.map((field) => {
            const f = detail.fields.find((x) => x.field === field)!
            const isEditing = editingField === field
            const isBusy = busyField === field
            return (
              <div key={field} className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h3>{FIELD_LABELS[field]}</h3>
                  {f.approved && <span className="badge" style={{ background: 'var(--egn-light-blue)' }}>Approved</span>}
                </div>

                {isEditing ? (
                  <div className="field">
                    <textarea
                      aria-label={`Edit ${FIELD_LABELS[field]}`}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      style={{ minHeight: 160 }}
                    />
                  </div>
                ) : (
                  // Bold headline markers only, in read mode — the raw
                  // markdown (asterisks and all) is what the textarea above
                  // shows in edit mode (prototype parity, HANDOFF.md §1's
                  // formatFieldText).
                  <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{formatFieldText(f.text)}</p>
                )}

                {(() => {
                  const unresolvedComments = f.comments.filter((c) => !c.resolved)
                  const resolvedComments = f.comments.filter((c) => c.resolved)
                  const commentsExpanded = !!expandedResolvedComments[field]
                  return (
                    <>
                      {unresolvedComments.map((c) => (
                        <div key={c.id} className="card" style={{ background: '#FEF3E7', padding: 10, marginBottom: 8 }}>
                          <p style={{ marginBottom: canEdit ? 8 : 0 }}>
                            <strong>Network Advisor:</strong> {c.text}
                          </p>
                          {canEdit && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <button type="button" className="btn btn-small" disabled={!!commentBusy[c.id]} onClick={() => void includeComment(c.id)}>
                                {commentBusy[c.id] ? 'Thinking…' : 'Accept/Include'}
                              </button>
                              <button type="button" className="btn btn-small" disabled={!!commentBusy[c.id]} onClick={() => void disregardComment(c.id)}>
                                Disregard
                              </button>
                              <button type="button" className="btn btn-small" onClick={() => openChat(field)}>
                                Edit with AI
                              </button>
                              <button type="button" className="linkText" onClick={() => void copyComment(c.id, c.text)}>
                                {copiedCommentId === c.id ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          )}
                          {commentErrors[c.id] && (
                            <p role="alert" style={{ color: 'var(--status-danger)', marginTop: 8 }}>
                              {commentErrors[c.id]}
                            </p>
                          )}
                        </div>
                      ))}
                      {resolvedComments.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <button
                            type="button"
                            className="linkText"
                            onClick={() => setExpandedResolvedComments((s) => ({ ...s, [field]: !s[field] }))}
                          >
                            {commentsExpanded ? '▾' : '▸'} See network advisor comments ({resolvedComments.length})
                          </button>
                          {commentsExpanded &&
                            resolvedComments.map((c) => (
                              <div key={c.id} className="card" style={{ background: '#FEF3E7', padding: 10, marginTop: 8 }}>
                                <strong>Network Advisor:</strong> {c.text}
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  )
                })()}
                {fieldErrors[field] && (
                  <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 8 }}>
                    {fieldErrors[field]}
                  </p>
                )}

                {canEdit && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isEditing ? (
                      <>
                        <button type="button" className="btn btn-primary" disabled={isBusy} onClick={() => void saveEdit(field)}>
                          {isBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {f.canUndo && (
                          <button type="button" className="btn" disabled={undoingField === field} onClick={() => void undoField(field)}>
                            {undoingField === field ? 'Undoing…' : 'Undo last change'}
                          </button>
                        )}
                        <button type="button" className="btn" onClick={() => startEdit(field, f.text)}>
                          Edit
                        </button>
                        <button type="button" className="btn" onClick={() => (chatField === field ? closeChat() : openChat(field))}>
                          {chatField === field ? 'Close AI assistant' : 'Ask AI assistant'}
                        </button>
                        {!f.approved && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={isBusy}
                            onClick={() => void approveField(field)}
                          >
                            {isBusy ? 'Approving…' : 'Read & accept'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {canEdit && detail.lifecycleStatus === 'Approved' && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <button type="button" className="btn" disabled={suggestionsLoading} onClick={() => void checkSuggestions()}>
                {suggestionsLoading ? 'Checking…' : 'Check for improvement suggestions'}
              </button>
              {suggestions && suggestions.length === 0 && (
                <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>No specific improvements to suggest right now.</p>
              )}
              {suggestions && suggestions.length > 0 && (
                <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <strong>{FIELD_LABELS[s.field]}:</strong> {s.suggestion}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* AI assistant — a persistent slide-in sidebar, not a blocking modal
          (the rest of the screen stays usable while it's open), one
          conversation per field: switching fields swaps chatQuery's data,
          it never mixes turns from different fields into one thread. */}
      <div className={`chatPanel${chatField !== null ? ' open' : ''}`} aria-hidden={chatField === null}>
        <div className="chatPanelHead">
          <span>AI assistant{chatField ? ` — ${FIELD_LABELS[chatField]}` : ''}</span>
          <button type="button" aria-label="Close AI assistant" onClick={closeChat}>
            ✕
          </button>
        </div>
        <div className="chatMessages">
          {chatQuery.isSuccess && chatTurns.length === 0 && (
            // A greeting only — never persisted, so it doesn't affect what
            // the AI sees as history if the Chair's first message here
            // starts a real conversation.
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <p className="chatBubble ai">How can I assist you?</p>
            </div>
          )}
          {chatTurns.map((t) => (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: t.role === 'Chair' ? 'flex-end' : 'flex-start' }}>
              {t.messageText && <p className={`chatBubble ${t.role === 'Chair' ? 'chair' : 'ai'}`}>{t.messageText}</p>}
              {t.proposedText && (
                <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 10, maxWidth: '88%' }}>
                  <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Proposed update</p>
                  <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8, fontSize: 14 }}>{formatFieldText(t.proposedText)}</p>
                  {t.outcome === 'None' ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={chatBusy} onClick={() => void acceptProposal(t.id)}>
                        Accept
                      </button>
                      <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13 }} disabled={chatBusy} onClick={() => void rejectProposal(t.id)}>
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.outcome}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {(chatError || chatLoadError) && (
          <p role="alert" style={{ color: 'var(--status-danger)', padding: '0 16px 8px' }}>
            {chatError || chatLoadError}
          </p>
        )}
        <div className="chatInputRow">
          <input
            aria-label={chatField ? `Message the AI assistant about ${FIELD_LABELS[chatField]}` : 'Message the AI assistant'}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendChatMessage()
              }
            }}
            placeholder="e.g. incorporate the Network Advisor's comment"
          />
          <button type="button" className="btn btn-primary" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendChatMessage()}>
            {chatBusy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  )
}

const cellStyle = { textAlign: 'left' as const, padding: '10px 12px' }

export default ChairReview
