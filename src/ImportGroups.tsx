import { useEffect, useRef, useState } from 'react'
import { decodeUtf8Strict, headerIndex, parseCsv, sniffDelimiter } from './lib/csv'
import Modal from './Modal'
import type { GroupDetail, GroupDto, ImportCheckResult, RawImportRow } from '../shared/schemas/group'
import type { UserDto } from '../shared/schemas/user'

const REQUIRED_COLS = [
  'EGN Group Name',
  'EGN Group Id',
  'MMSGroup: Name',
  'Partner Code',
  'Group Profile',
  'Member Profile',
  'Companies Profile',
  'Responsible Chair',
  'Responsible Chair Email',
  'Responsible Sales',
  'Responsible Sales Email',
] as const
const REQUIRED_METADATA_COLS = [
  'EGN Group Name',
  'EGN Group Id',
  'MMSGroup: Name',
  'Partner Code',
  'Responsible Chair',
  'Responsible Chair Email',
  'Responsible Sales',
  'Responsible Sales Email',
] as const
const COL_TO_FIELD: Record<(typeof REQUIRED_COLS)[number], keyof RawImportRow> = {
  'EGN Group Name': 'egnGroupName',
  'EGN Group Id': 'egnGroupId',
  'MMSGroup: Name': 'mmsGroupCode',
  'Partner Code': 'partnerCode',
  'Group Profile': 'groupProfile',
  'Member Profile': 'memberProfile',
  'Companies Profile': 'companiesProfile',
  'Responsible Chair': 'responsibleChairName',
  'Responsible Chair Email': 'responsibleChairEmail',
  'Responsible Sales': 'responsibleSalesName',
  'Responsible Sales Email': 'responsibleSalesEmail',
}

function emptyManualForm(): RawImportRow {
  return {
    egnGroupName: '',
    egnGroupId: '',
    mmsGroupCode: '',
    partnerCode: '',
    groupProfile: '',
    memberProfile: '',
    companiesProfile: '',
    responsibleChairName: '',
    responsibleChairEmail: '',
    responsibleSalesName: '',
    responsibleSalesEmail: '',
  }
}

interface ReviewRow {
  check: ImportCheckResult
  chairEmail: string
  networkAdvisorEmail: string
  action: 'create' | 'overwrite'
}

function ImportGroups() {
  const [users, setUsers] = useState<UserDto[]>([])
  const [groups, setGroups] = useState<GroupDto[]>([])
  const [error, setError] = useState('')

  const [manualForm, setManualForm] = useState(emptyManualForm())
  const [csvBanner, setCsvBanner] = useState<{ kind: 'error' | 'warning'; title: string; items: string[] } | null>(null)
  const [csvRows, setCsvRows] = useState<RawImportRow[]>([])
  const [csvFileName, setCsvFileName] = useState('')
  const csvFileInputRef = useRef<HTMLInputElement>(null)

  const [review, setReview] = useState<ReviewRow[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)

  // The Groups list is the default view — the manual-add form, CSV import,
  // and review-before-import steps are all overlays, not inline page
  // sections. At most one open at a time.
  const [openPanel, setOpenPanel] = useState<'manual' | 'csv' | 'review' | null>(null)

  // Generate/Score/Launch (issue #47) — Admin-only actions, available both
  // as row buttons on the list and inside a group's own detail view.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  // Keyed by groupId so a busy/error state on one row's action doesn't
  // affect any other row, whether triggered from the list or the detail view.
  const [actionBusy, setActionBusy] = useState<Record<string, 'generate' | 'score' | 'launch' | undefined>>({})
  const [actionError, setActionError] = useState<Record<string, string | undefined>>({})

  // Guards against out-of-order responses for the standalone lists.
  const usersRequestId = useRef(0)
  const groupsRequestId = useRef(0)
  const detailRequestId = useRef(0)
  // A ref, not just the selectedGroupId state, because refreshAfterAction
  // runs after an await (a Generate action can take upwards of a minute) —
  // reading the state variable there would close over its value from
  // click-time, not the admin's current selection, so a switch to a
  // different group mid-action would wrongly re-fetch and overwrite the
  // now-displayed group's detail with the original one's.
  const selectedGroupIdRef = useRef<string | null>(null)
  // Guards the check/import workflow as a whole (csvBanner, csvRows, review):
  // selecting a file, running a check, and confirming an import are all
  // async and can overlap (e.g. a slow manual-row check resolving after a
  // CSV file has already been selected and checked). Every action that
  // starts a new attempt bumps this; anything that resolves after being
  // superseded skips applying its result instead of clobbering newer state.
  const workflowGeneration = useRef(0)

  async function loadUsers() {
    const id = ++usersRequestId.current
    const res = await fetch('/api/getUsers')
    if (id !== usersRequestId.current) return
    if (res.ok) setUsers((await res.json()) as UserDto[])
  }

  async function loadGroups() {
    const id = ++groupsRequestId.current
    const res = await fetch('/api/getGroups')
    if (id !== groupsRequestId.current) return
    if (res.ok) setGroups((await res.json()) as GroupDto[])
  }

  useEffect(() => {
    void loadUsers()
    void loadGroups()
  }, [])

  const chairs = users.filter((u) => u.roles.includes('Chair'))
  const advisors = users.filter((u) => u.roles.includes('NetworkAdvisor'))

  async function loadDetail(groupId: string) {
    setDetailError('')
    const id = ++detailRequestId.current
    const res = await fetch(`/api/getGroup?groupId=${encodeURIComponent(groupId)}`)
    if (id !== detailRequestId.current) return
    if (!res.ok) {
      setDetailError(`Could not load this group (${res.status}).`)
      return
    }
    setDetail((await res.json()) as GroupDetail)
  }

  function openGroup(groupId: string) {
    selectedGroupIdRef.current = groupId
    setSelectedGroupId(groupId)
    setDetail(null)
    void loadDetail(groupId)
  }

  function backToList() {
    selectedGroupIdRef.current = null
    setSelectedGroupId(null)
    setDetail(null)
  }

  async function refreshAfterAction(groupId: string) {
    await loadGroups()
    if (selectedGroupIdRef.current === groupId) await loadDetail(groupId)
  }

  // Generate/Regenerate: the 4-call pipeline (spec §8, issue #22) as one
  // user-facing action — stage1 -> stage2 -> score -> commit. Each call is
  // its own request (not combined) because generateDnaStage1/2 already
  // budget close to SWA's 45s cap on their own; see those endpoints'
  // comments.
  async function generateDna(groupId: string) {
    setActionError((e) => ({ ...e, [groupId]: undefined }))
    setActionBusy((b) => ({ ...b, [groupId]: 'generate' }))
    try {
      const s1 = await fetch('/api/generateDnaStage1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      })
      if (!s1.ok) {
        const body = (await s1.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: `Stage 1 failed (${s1.status}): ${body?.error ?? 'unknown error'}` }))
        return
      }
      const { stage1Text } = (await s1.json()) as { stage1Text: string }

      const s2 = await fetch('/api/generateDnaStage2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, stage1Text }),
      })
      if (!s2.ok) {
        const body = (await s2.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: `Stage 2 failed (${s2.status}): ${body?.error ?? 'unknown error'}` }))
        return
      }
      const { stage2Text } = (await s2.json()) as { stage2Text: string }

      const scoreRes = await fetch('/api/scoreDna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: stage2Text }),
      })
      if (!scoreRes.ok) {
        const body = (await scoreRes.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: `Scoring failed (${scoreRes.status}): ${body?.error ?? 'unknown error'}` }))
        return
      }
      const { score } = (await scoreRes.json()) as { score: number }

      const commitRes = await fetch('/api/commitDnaGeneration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, stage2Text, autoGeneratedScore: score }),
      })
      if (!commitRes.ok) {
        const body = (await commitRes.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: `Commit failed (${commitRes.status}): ${body?.error ?? 'unknown error'}` }))
        return
      }

      await refreshAfterAction(groupId)
    } catch (err) {
      // A network failure or an unexpectedly-shaped response (fetch itself
      // rejecting, or .json() throwing on a non-JSON body) would otherwise
      // propagate uncaught here and leave the admin with no visible error
      // at all — surface it instead of failing silently.
      setActionError((e) => ({ ...e, [groupId]: `Generate failed: ${err instanceof Error ? err.message : String(err)}` }))
    } finally {
      setActionBusy((b) => ({ ...b, [groupId]: undefined }))
    }
  }

  // On-demand scoring (issue #31) of the group's latest DnaVersion, whatever its stage.
  async function scoreLatest(groupId: string, dnaVersionId: string) {
    setActionError((e) => ({ ...e, [groupId]: undefined }))
    setActionBusy((b) => ({ ...b, [groupId]: 'score' }))
    try {
      const res = await fetch('/api/scoreDnaVersion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dnaVersionId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: body?.error ?? `Scoring failed (${res.status}).` }))
        return
      }
      await refreshAfterAction(groupId)
    } finally {
      setActionBusy((b) => ({ ...b, [groupId]: undefined }))
    }
  }

  async function launch(groupId: string) {
    setActionError((e) => ({ ...e, [groupId]: undefined }))
    setActionBusy((b) => ({ ...b, [groupId]: 'launch' }))
    try {
      const res = await fetch('/api/launchGroup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setActionError((e) => ({ ...e, [groupId]: body?.error ?? `Launch failed (${res.status}).` }))
        return
      }
      await refreshAfterAction(groupId)
    } finally {
      setActionBusy((b) => ({ ...b, [groupId]: undefined }))
    }
  }

  async function runCheck(rows: RawImportRow[]) {
    setError('')
    setChecking(true)
    const gen = ++workflowGeneration.current
    try {
      // Refresh the roster right before checking — an Admin may have just
      // added a Chair/NA in the Users section above on this same page load,
      // and the review dropdowns need that user to actually be selectable.
      await loadUsers()
      const res = await fetch('/api/checkGroupImport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      // A slower earlier check (e.g. the manual-add form's single-row check)
      // can resolve after a later action has superseded it — skip applying
      // stale results rather than clobbering newer state.
      if (gen !== workflowGeneration.current) return
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Check failed (${res.status}).`)
        return
      }
      const results = (await res.json()) as ImportCheckResult[]
      setReview(
        results.map((check) => ({
          check,
          chairEmail: check.suggestedChairEmail ?? '',
          networkAdvisorEmail: check.suggestedNetworkAdvisorEmail ?? '',
          action: 'create',
        })),
      )
      // The review table is the active step now — replaces whichever input
      // panel led here (manual form or CSV picker) in the same overlay.
      setOpenPanel('review')
    } finally {
      // Always clear this call's own busy flag, even if superseded — the
      // Check/CSV-file buttons are disabled while checking is true, so a
      // stale call's flag getting stuck true would permanently disable them.
      // (A newer call, if any, has already set checking true again itself.)
      setChecking(false)
    }
  }

  function handleCsvFile(file: File) {
    const gen = ++workflowGeneration.current // supersede any in-flight check/import
    setCsvBanner(null)
    setCsvRows([])
    setCsvFileName(file.name)
    setReview(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      if (gen !== workflowGeneration.current) return // a different file was selected meanwhile
      const buf = ev.target?.result as ArrayBuffer
      const dec = decodeUtf8Strict(buf)
      if (!dec.ok) {
        setCsvBanner({
          kind: 'error',
          title: 'This file is not saved as UTF-8 — import blocked',
          items: [
            `First invalid byte: 0x${dec.byteVal.toString(16).toUpperCase()} at position ${dec.bytePos} (typical of a Windows ANSI / Windows-1252 export).`,
            'Fix: in Excel use Save As → CSV UTF-8, or choose UTF-8 in the Salesforce export, then re-upload.',
          ],
        })
        return
      }
      const text = dec.text
      if (!text.trim()) {
        setCsvBanner({ kind: 'error', title: 'Cannot import', items: ['The file is empty.'] })
        return
      }

      const delim = sniffDelimiter(text)
      const aoa = parseCsv(text, delim)
      if (aoa.length < 2) {
        setCsvBanner({ kind: 'error', title: 'Cannot import', items: ['No data rows below the header row.'] })
        return
      }

      const idx = headerIndex(aoa[0])
      const missingCols = REQUIRED_COLS.filter((c) => idx[c] === undefined)
      if (missingCols.length) {
        setCsvBanner({ kind: 'error', title: 'Missing required columns', items: missingCols })
        return
      }

      const rejections: string[] = []
      const rows: RawImportRow[] = []
      aoa.slice(1).forEach((row, i) => {
        const ln = i + 2
        const obj = emptyManualForm()
        for (const col of REQUIRED_COLS) {
          obj[COL_TO_FIELD[col]] = String(row[idx[col]] ?? '').trim()
        }
        const missingMeta = REQUIRED_METADATA_COLS.filter((c) => !obj[COL_TO_FIELD[c]])
        const label = obj.egnGroupName || obj.egnGroupId || '(unidentified row)'
        if (missingMeta.length) {
          rejections.push(`Row ${ln} (${label}): missing ${missingMeta.join(', ')} — will be rejected.`)
          return
        }
        rows.push(obj)
      })

      setCsvRows(rows)
      if (rejections.length) setCsvBanner({ kind: 'warning', title: 'Rows that will be rejected (missing required fields)', items: rejections })
    }
    reader.readAsArrayBuffer(file)
  }

  function updateReviewRow(i: number, patch: Partial<ReviewRow>) {
    setReview((r) => (r ? r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) : r))
  }

  function toggleManualPanel() {
    setOpenPanel((p) => (p === 'manual' ? null : 'manual'))
  }

  function toggleCsvPanel() {
    setOpenPanel((p) => (p === 'csv' ? null : 'csv'))
  }

  async function confirmImport() {
    if (!review) return
    const gen = ++workflowGeneration.current // this review is being consumed now — supersede anything else in flight
    setError('')
    setImporting(true)
    try {
      const rows = review
        .filter((r) => r.check.status !== 'unchanged')
        .map((r) => ({
          egnGroupName: r.check.row.egnGroupName,
          egnGroupId: r.check.row.egnGroupId,
          mmsGroupCode: r.check.row.mmsGroupCode,
          partnerCode: r.check.row.partnerCode,
          groupProfile: r.check.row.groupProfile,
          memberProfile: r.check.row.memberProfile,
          companiesProfile: r.check.row.companiesProfile,
          chairEmail: r.chairEmail || null,
          networkAdvisorEmail: r.networkAdvisorEmail || null,
          action:
            r.action === 'overwrite' && r.check.existingGroupId
              ? { type: 'overwrite' as const, groupId: r.check.existingGroupId }
              : { type: 'create' as const },
        }))
      if (!rows.length) {
        setReview(null)
        setCsvRows([])
        setCsvFileName('')
        setOpenPanel(null)
        return
      }
      const res = await fetch('/api/putGroups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) {
        // Only surface the error if nothing newer has since superseded this
        // attempt (e.g. the admin already moved on to a different file).
        if (gen === workflowGeneration.current) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          setError(body?.error ?? `Import failed (${res.status}).`)
        }
        return
      }
      // The import genuinely happened server-side — refresh the groups
      // table regardless of whether the admin has since moved on to a new
      // file (loadGroups has its own out-of-order guard for the fetch
      // itself). Only the review/csvRows/manualForm UI state — which a
      // newer action may already own — is gated on still being current.
      await loadGroups()
      if (gen === workflowGeneration.current) {
        setReview(null)
        setCsvRows([])
        setCsvFileName('')
        setManualForm(emptyManualForm())
        setOpenPanel(null)
      }
    } finally {
      // Same reasoning as runCheck's finally: always clear this call's own
      // busy flag, even if superseded, so it can't get stuck true forever.
      setImporting(false)
    }
  }

  function dnaChip(g: Pick<GroupDto, 'latestDnaVersionId' | 'latestDnaVersionScore' | 'hasPendingAiDraft'>) {
    if (!g.latestDnaVersionId) return 'No DNA version yet'
    if (g.hasPendingAiDraft) return g.latestDnaVersionScore !== null ? `AI draft pending, score ${g.latestDnaVersionScore}/5` : 'AI draft pending'
    return g.latestDnaVersionScore !== null ? `Score ${g.latestDnaVersionScore}/5` : 'Not yet scored'
  }

  function actionButtons(g: Pick<GroupDto, 'id' | 'latestDnaVersionId' | 'hasPendingAiDraft'>) {
    const busy = actionBusy[g.id]
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void generateDna(g.id)}>
          {busy === 'generate' ? 'Generating…' : g.latestDnaVersionId ? 'Regenerate' : 'Generate'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !g.latestDnaVersionId}
          onClick={() => g.latestDnaVersionId && void scoreLatest(g.id, g.latestDnaVersionId)}
        >
          {busy === 'score' ? 'Scoring…' : 'Score'}
        </button>
        <button type="button" className="btn btn-primary" disabled={!!busy || !g.hasPendingAiDraft} onClick={() => void launch(g.id)}>
          {busy === 'launch' ? 'Launching…' : 'Launch'}
        </button>
      </div>
    )
  }

  function qualityChips(g: GroupDto) {
    const chips: string[] = []
    if (g.noSourceDna) chips.push('no source DNA')
    else if (g.emptySectionCount > 0) chips.push(`${g.emptySectionCount} empty section(s)`)
    if (!g.chairEmail) chips.push('no Chair')
    if (!g.networkAdvisorEmail) chips.push('no NA')
    return chips
  }

  if (selectedGroupId) {
    const latest = detail?.latestDnaVersion ?? null
    return (
      <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
        <button type="button" className="btn" style={{ marginBottom: 16 }} onClick={backToList}>
          ← Back to groups
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
              {detail.country} · {detail.lifecycleStatus} · Chair: {detail.chairEmail ?? '—'} · NA: {detail.networkAdvisorEmail ?? '—'}
            </p>

            {actionError[detail.id] && (
              <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
                {actionError[detail.id]}
              </p>
            )}
            <div style={{ marginBottom: 24 }}>
              {actionButtons({ id: detail.id, latestDnaVersionId: latest?.id ?? null, hasPendingAiDraft: latest?.author === 'Ai' })}
            </div>

            <h3 style={{ marginBottom: 8 }}>
              {latest ? `Latest DNA version (v${latest.versionNumber}, ${latest.author ?? 'Imported'})` : 'No DNA version yet'}
            </h3>
            {latest && (
              <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                {latest.score !== null ? `Score ${latest.score}/5` : 'Not yet scored'} · {new Date(latest.createdAt).toLocaleString()}
              </p>
            )}
            {(
              [
                ['groupProfile', 'Group Profile'],
                ['memberProfile', 'Member Profile'],
                ['companiesProfile', 'Companies Profile'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="card" style={{ padding: 16, marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>{label}</h4>
                <p style={{ whiteSpace: 'pre-wrap' }}>{(latest ? latest.content[key] : detail[key]) || '—'}</p>
              </div>
            ))}
          </>
        )}
      </section>
    )
  }

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <h2 style={{ marginBottom: 16 }}>Groups</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={openPanel === 'csv' ? 'btn btn-primary' : 'btn'} onClick={toggleCsvPanel}>
          Import CSV
        </button>
        <button type="button" className={openPanel === 'manual' ? 'btn btn-primary' : 'btn'} onClick={toggleManualPanel}>
          Add group
        </button>
      </div>

      {openPanel === 'manual' && (
        <Modal title="Add one group manually" onClose={() => setOpenPanel(null)}>
          {error && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void runCheck([manualForm])
            }}
          >
            {(
              [
                ['egnGroupName', 'EGN Group Name'],
                ['egnGroupId', 'EGN Group Id'],
                ['mmsGroupCode', 'MMSGroup: Name'],
                ['partnerCode', 'Partner Code'],
                ['responsibleChairName', 'Responsible Chair'],
                ['responsibleChairEmail', 'Responsible Chair Email'],
                ['responsibleSalesName', 'Responsible Sales'],
                ['responsibleSalesEmail', 'Responsible Sales Email'],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <label className="lbl" htmlFor={`manual-${key}`}>
                  {label}
                </label>
                <input
                  id={`manual-${key}`}
                  value={manualForm[key]}
                  onChange={(e) => setManualForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            {(
              [
                ['groupProfile', 'Group Profile'],
                ['memberProfile', 'Member Profile'],
                ['companiesProfile', 'Companies Profile'],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <label className="lbl" htmlFor={`manual-${key}`}>
                  {label}
                </label>
                <textarea
                  id={`manual-${key}`}
                  value={manualForm[key]}
                  onChange={(e) => setManualForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <button type="submit" className="btn btn-primary" disabled={checking}>
              {checking ? 'Checking…' : 'Check group'}
            </button>
          </form>
        </Modal>
      )}

      {openPanel === 'csv' && (
        <Modal title="Import from CSV" onClose={() => setOpenPanel(null)}>
          {error && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {error}
            </p>
          )}
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            Required columns: {REQUIRED_COLS.join(', ')}. Must be UTF-8; delimiter auto-detected.
          </p>
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleCsvFile(file)
            }}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button type="button" className="btn" onClick={() => csvFileInputRef.current?.click()}>
              Choose file
            </button>
            <span style={{ color: 'var(--text-muted)' }}>{csvFileName || 'No file chosen'}</span>
          </div>
          {csvBanner && (
            <div
              role={csvBanner.kind === 'error' ? 'alert' : 'status'}
              style={{
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                background: csvBanner.kind === 'error' ? '#fef2f2' : 'var(--egn-light-blue)',
                color: csvBanner.kind === 'error' ? 'var(--status-danger)' : 'var(--text-main)',
              }}
            >
              <strong>{csvBanner.title}</strong>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {csvBanner.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {csvRows.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={checking} onClick={() => void runCheck(csvRows)}>
              {checking ? 'Checking…' : `Check ${csvRows.length} row(s)`}
            </button>
          )}
        </Modal>
      )}

      {openPanel === 'review' && review && (
        <Modal
          title="Review before import"
          onClose={() => {
            setReview(null)
            setOpenPanel(null)
          }}
        >
          {error && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {error}
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ background: 'var(--egn-sand)' }}>
                <th style={cellStyle}>Group</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Chair</th>
                <th style={cellStyle}>NA</th>
              </tr>
            </thead>
            <tbody>
              {review.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={cellStyle}>{r.check.row.egnGroupName || r.check.row.egnGroupId}</td>
                  <td style={cellStyle}>
                    {r.check.status === 'unchanged' ? (
                      'Unchanged — skipped'
                    ) : r.check.status === 'changed' ? (
                      <label>
                        Changed —{' '}
                        <select
                          aria-label={`Action for ${r.check.row.egnGroupName || r.check.row.egnGroupId}`}
                          value={r.action}
                          onChange={(e) => updateReviewRow(i, { action: e.target.value as ReviewRow['action'] })}
                          style={{ width: 'auto' }}
                        >
                          <option value="create">Create new record</option>
                          <option value="overwrite">Overwrite existing (discards its review progress)</option>
                        </select>
                      </label>
                    ) : (
                      'New'
                    )}
                  </td>
                  <td style={cellStyle}>
                    <select
                      aria-label={`Chair for ${r.check.row.egnGroupName || r.check.row.egnGroupId}`}
                      value={r.chairEmail}
                      onChange={(e) => updateReviewRow(i, { chairEmail: e.target.value })}
                      disabled={r.check.status === 'unchanged'}
                      style={{ width: 'auto' }}
                    >
                      <option value="">— unmatched —</option>
                      {chairs.map((c) => (
                        <option key={c.email} value={c.email}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={cellStyle}>
                    <select
                      aria-label={`Network Advisor for ${r.check.row.egnGroupName || r.check.row.egnGroupId}`}
                      value={r.networkAdvisorEmail}
                      onChange={(e) => updateReviewRow(i, { networkAdvisorEmail: e.target.value })}
                      disabled={r.check.status === 'unchanged'}
                      style={{ width: 'auto' }}
                    >
                      <option value="">— unmatched —</option>
                      {advisors.map((a) => (
                        <option key={a.email} value={a.email}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-primary" disabled={importing} onClick={() => void confirmImport()}>
            {importing ? 'Importing…' : 'Confirm import'}
          </button>
        </Modal>
      )}

      <h3 style={{ marginBottom: 12 }}>Imported groups ({groups.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--egn-sand)' }}>
            <th style={cellStyle}>Group</th>
            <th style={cellStyle}>Group Id</th>
            <th style={cellStyle}>Country</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Quality</th>
            <th style={cellStyle}>DNA</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={cellStyle}>
                <button type="button" className="btn" style={{ padding: 0, border: 'none', background: 'none', textDecoration: 'underline' }} onClick={() => openGroup(g.id)}>
                  {g.name}
                </button>
              </td>
              <td style={cellStyle}>{g.egnGroupId}</td>
              <td style={cellStyle}>{g.country || '—'}</td>
              <td style={cellStyle}>{g.lifecycleStatus}</td>
              <td style={cellStyle}>
                {qualityChips(g).map((chip) => (
                  <span key={chip} className="badge" style={{ background: '#fef2f2', color: 'var(--status-danger)', marginRight: 4 }}>
                    {chip}
                  </span>
                ))}
              </td>
              <td style={cellStyle}>
                {dnaChip(g)}
                {actionError[g.id] && (
                  <p role="alert" style={{ color: 'var(--status-danger)', marginTop: 4, fontSize: 12 }}>
                    {actionError[g.id]}
                  </p>
                )}
              </td>
              <td style={cellStyle}>{actionButtons(g)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const cellStyle = { textAlign: 'left' as const, padding: '10px 12px' }

export default ImportGroups
