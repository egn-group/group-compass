import { useEffect, useRef, useState } from 'react'
import { decodeUtf8Strict, headerIndex, parseCsv, sniffDelimiter } from './lib/csv'
import type { GroupDto, ImportCheckResult, RawImportRow } from '../shared/schemas/group'
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

  const [review, setReview] = useState<ReviewRow[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)

  // Guards against out-of-order responses for the standalone lists.
  const usersRequestId = useRef(0)
  const groupsRequestId = useRef(0)
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
        setManualForm(emptyManualForm())
      }
    } finally {
      // Same reasoning as runCheck's finally: always clear this call's own
      // busy flag, even if superseded, so it can't get stuck true forever.
      setImporting(false)
    }
  }

  function qualityChips(g: GroupDto) {
    const chips: string[] = []
    if (g.noSourceDna) chips.push('no source DNA')
    else if (g.emptySectionCount > 0) chips.push(`${g.emptySectionCount} empty section(s)`)
    if (!g.chairEmail) chips.push('no Chair')
    if (!g.networkAdvisorEmail) chips.push('no NA')
    return chips
  }

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <h2 style={{ marginBottom: 16 }}>Import groups</h2>
      {error && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {error}
        </p>
      )}

      <h3 style={{ marginBottom: 12 }}>Add one group manually</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runCheck([manualForm])
        }}
        style={{ marginBottom: 32 }}
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

      <h3 style={{ marginBottom: 12 }}>Import from CSV</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
        Required columns: {REQUIRED_COLS.join(', ')}. Must be UTF-8; delimiter auto-detected.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleCsvFile(file)
        }}
        style={{ marginBottom: 16 }}
      />
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
      {csvRows.length > 0 && !review && (
        <button type="button" className="btn btn-primary" disabled={checking} onClick={() => void runCheck(csvRows)} style={{ marginBottom: 32 }}>
          {checking ? 'Checking…' : `Check ${csvRows.length} row(s)`}
        </button>
      )}

      {review && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ marginBottom: 12 }}>Review before import</h3>
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
        </div>
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
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={cellStyle}>{g.name}</td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const cellStyle = { textAlign: 'left' as const, padding: '10px 12px' }

export default ImportGroups
