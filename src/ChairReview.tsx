import { useEffect, useRef, useState } from 'react'
import type { DnaFieldValue } from '../shared/schemas/dna'
import type { ChairGroupDetail, ChairGroupListItem } from '../shared/schemas/chairReview'

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

function ChairReview() {
  const [groups, setGroups] = useState<ChairGroupListItem[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChairGroupDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [justFullyApproved, setJustFullyApproved] = useState(false)

  const [editingField, setEditingField] = useState<DnaFieldValue | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busyField, setBusyField] = useState<DnaFieldValue | null>(null)
  const [fieldFeedback, setFieldFeedback] = useState<Partial<Record<DnaFieldValue, string>>>({})
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DnaFieldValue, string>>>({})
  const [reapproving, setReapproving] = useState(false)

  // Guards against an earlier, slower request resolving after a later one
  // and overwriting fresher state with stale data.
  const groupsRequestId = useRef(0)
  const detailRequestId = useRef(0)

  async function loadGroups() {
    setError('')
    const id = ++groupsRequestId.current
    const res = await fetch('/api/getChairGroups')
    if (id !== groupsRequestId.current) return
    if (!res.ok) {
      setError(`Could not load groups (${res.status}).`)
      return
    }
    const body = (await res.json()) as { groups: ChairGroupListItem[] }
    setGroups(body.groups)
  }

  useEffect(() => {
    void loadGroups()
  }, [])

  async function loadDetail(groupId: string) {
    setDetailError('')
    const id = ++detailRequestId.current
    const res = await fetch(`/api/getChairGroup?groupId=${encodeURIComponent(groupId)}`)
    if (id !== detailRequestId.current) return
    if (!res.ok) {
      setDetailError(`Could not load this group (${res.status}).`)
      return
    }
    setDetail((await res.json()) as ChairGroupDetail)
  }

  function openGroup(groupId: string) {
    setSelectedGroupId(groupId)
    setDetail(null)
    setJustFullyApproved(false)
    setFieldFeedback({})
    setFieldErrors({})
    setEditingField(null)
    void loadDetail(groupId)
  }

  function backToList() {
    setSelectedGroupId(null)
    setDetail(null)
    void loadGroups()
  }

  async function approveField(field: DnaFieldValue) {
    if (!selectedGroupId) return
    setFieldErrors((e) => ({ ...e, [field]: '' }))
    setBusyField(field)
    try {
      const res = await fetch('/api/approveChairField', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroupId, field }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFieldErrors((e) => ({ ...e, [field]: body?.error ?? `Approve failed (${res.status}).` }))
        return
      }
      const data = (await res.json()) as { justFullyApproved: boolean }
      if (data.justFullyApproved) setJustFullyApproved(true)
      await loadDetail(selectedGroupId)
    } finally {
      setBusyField(null)
    }
  }

  function startEdit(field: DnaFieldValue, currentText: string) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroupId, field, text: editDraft }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setFieldErrors((e) => ({ ...e, [field]: body?.error ?? `Save failed (${res.status}).` }))
        return
      }
      const data = (await res.json()) as { aiFeedback: string }
      setFieldFeedback((f) => ({ ...f, [field]: data.aiFeedback }))
      setEditingField(null)
      setEditDraft('')
      await loadDetail(selectedGroupId)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroupId }),
      })
      if (res.ok) await loadDetail(selectedGroupId)
    } finally {
      setReapproving(false)
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
                <td style={cellStyle}>{new Date(g.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

          {justFullyApproved && (
            <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 16, marginBottom: 16 }}>
              Thank you — the DNA has been updated. It will be updated in Salesforce within five business days.
            </div>
          )}

          {detail.lifecycleStatus === 'Approved' && detail.pendingReapproval && (
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
                  <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{f.text}</p>
                )}

                {f.unresolvedComments.map((c) => (
                  <div key={c.id} className="card" style={{ background: '#FEF3E7', padding: 10, marginBottom: 8 }}>
                    <strong>Network Advisor:</strong> {c.text}
                  </div>
                ))}
                {fieldFeedback[field] && !isEditing && (
                  <div className="card" style={{ background: 'var(--egn-light-blue)', padding: 10, marginBottom: 8 }}>
                    <strong>AI feedback:</strong> {fieldFeedback[field]}
                  </div>
                )}
                {fieldErrors[field] && (
                  <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 8 }}>
                    {fieldErrors[field]}
                  </p>
                )}

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
                      <button type="button" className="btn" onClick={() => startEdit(field, f.text)}>
                        Edit
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
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

const cellStyle = { textAlign: 'left' as const, padding: '10px 12px' }

export default ChairReview
