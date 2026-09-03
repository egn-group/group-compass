import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type CSSProperties } from 'react'
import { decodeUtf8Strict, headerIndex, parseCsv, sniffDelimiter } from './lib/csv'
import { apiGet } from './lib/api'
import Modal from './Modal'
import { UpsertUserSchema, type RoleValue, type UpsertUserInput, type UserDto } from '../shared/schemas/user'

// Chair Leader and Sales Leader are deferred past this pilot (wayfinder map,
// issue #1) — this Admin page only offers the three active roles.
const ASSIGNABLE_ROLES: RoleValue[] = ['Admin', 'Chair', 'NetworkAdvisor']

const REQUIRED_COLS = ['Email', 'Name', 'Initials', 'Role'] as const

function emptyForm() {
  return { email: '', name: '', initials: '', roles: [] as RoleValue[] }
}

function AdminUsers() {
  const queryClient = useQueryClient()
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<UserDto[]>('/api/getUsers', 'Could not load users'),
  })
  const users = usersQuery.data ?? []
  const [error, setError] = useState('')
  const loadError = usersQuery.isError ? usersQuery.error.message : ''
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  // Roles the edited user already has that this page doesn't expose
  // checkboxes for (e.g. ChairLeader/SalesLeader, deferred past this pilot).
  // Carried silently so saving an edit can't accidentally strip them.
  const [hiddenRoles, setHiddenRoles] = useState<string[]>([])

  const [csvBanner, setCsvBanner] = useState<{ kind: 'error' | 'warning'; title: string; items: string[] } | null>(null)
  const [csvRows, setCsvRows] = useState<UpsertUserInput[]>([])
  const [csvFileName, setCsvFileName] = useState('')
  const csvFileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  // The list is the default view — the add/edit form and CSV import are
  // tucked behind buttons, not shown inline by default. At most one open
  // at a time.
  const [openPanel, setOpenPanel] = useState<'form' | 'csv' | null>(null)

  function toggleRole(role: RoleValue) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }))
  }

  function editUser(user: UserDto) {
    setForm({
      email: user.email,
      name: user.name,
      initials: user.initials,
      roles: user.roles.filter((r): r is RoleValue => (ASSIGNABLE_ROLES as string[]).includes(r)),
    })
    setHiddenRoles(user.roles.filter((r) => !(ASSIGNABLE_ROLES as string[]).includes(r)))
    setOpenPanel('form')
  }

  function toggleFormPanel() {
    if (openPanel === 'form') {
      setOpenPanel(null)
    } else {
      setForm(emptyForm())
      setHiddenRoles([])
      setOpenPanel('form')
    }
  }

  function toggleCsvPanel() {
    setOpenPanel((p) => (p === 'csv' ? null : 'csv'))
  }

  async function submit() {
    setError('')
    const payload = { ...form, roles: [...form.roles, ...hiddenRoles] }
    const parsed = UpsertUserSchema.safeParse(payload)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/putUsers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Save failed (${res.status}).`)
        return
      }
      setForm(emptyForm())
      setHiddenRoles([])
      setOpenPanel(null)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    } finally {
      setSaving(false)
    }
  }

  function handleCsvFile(file: File) {
    setCsvBanner(null)
    setCsvRows([])
    setCsvFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer
      const dec = decodeUtf8Strict(buf)
      if (!dec.ok) {
        setCsvBanner({
          kind: 'error',
          title: 'This file is not saved as UTF-8 — import blocked',
          items: [
            `First invalid byte: 0x${dec.byteVal.toString(16).toUpperCase()} at position ${dec.bytePos} (typical of a Windows ANSI / Windows-1252 export).`,
            'Fix: in Excel use Save As → CSV UTF-8, or choose UTF-8 in the export, then re-upload.',
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
      const rows: UpsertUserInput[] = []
      aoa.slice(1).forEach((row, i) => {
        const ln = i + 2
        const email = String(row[idx.Email] ?? '').trim()
        const name = String(row[idx.Name] ?? '').trim()
        const initials = String(row[idx.Initials] ?? '').trim()
        // One row per person — a person needing more than one role lists
        // them all in this one cell, semicolon-separated (not the CSV's own
        // delimiter, which this cell's value would otherwise collide with).
        const roles = String(row[idx.Role] ?? '')
          .split(';')
          .map((r) => r.trim())
          .filter(Boolean)
        const label = email || name || '(unidentified row)'
        const parsed = UpsertUserSchema.safeParse({ email, name, initials, roles })
        if (!parsed.success) {
          rejections.push(`Row ${ln} (${label}): ${parsed.error.issues[0]?.message ?? 'invalid'} — will be rejected.`)
          return
        }
        rows.push(parsed.data)
      })

      setCsvRows(rows)
      if (rejections.length) setCsvBanner({ kind: 'warning', title: 'Rows that will be rejected (invalid)', items: rejections })
    }
    reader.readAsArrayBuffer(file)
  }

  async function confirmUsersImport() {
    if (!csvRows.length) return
    setImporting(true)
    setError('')
    try {
      const failures: string[] = []
      for (const row of csvRows) {
        const res = await fetch('/api/putUsers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          failures.push(`${row.email}: ${body?.error ?? `failed (${res.status})`}`)
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setCsvRows([])
      if (failures.length) {
        setCsvBanner({ kind: 'error', title: 'Some users failed to import', items: failures })
      } else {
        setCsvBanner(null)
        setCsvFileName('')
        setOpenPanel(null)
      }
    } finally {
      setImporting(false)
    }
  }

  const isEditing = form.email !== '' && users.some((u) => u.email === form.email)

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <h2 style={{ marginBottom: 16 }}>Users</h2>
      {(error || loadError) && !openPanel && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {error || loadError}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={openPanel === 'csv' ? 'btn btn-primary' : 'btn'} onClick={toggleCsvPanel}>
          Import CSV
        </button>
        <button type="button" className={openPanel === 'form' ? 'btn btn-primary' : 'btn'} onClick={toggleFormPanel}>
          Add user
        </button>
      </div>

      {openPanel === 'form' && (
        <Modal title={isEditing ? 'Edit user' : 'Add user'} onClose={() => setOpenPanel(null)}>
          {error && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="field">
              <label className="lbl" htmlFor="user-email">
                Email
              </label>
              <input
                id="user-email"
                value={form.email}
                disabled={isEditing}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="user-name">
                Name
              </label>
              <input
                id="user-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="user-initials">
                Initials
              </label>
              <input
                id="user-initials"
                value={form.initials}
                onChange={(e) => setForm((f) => ({ ...f, initials: e.target.value }))}
              />
            </div>
            <fieldset className="field" style={{ border: 'none' }}>
              <legend className="lbl">Roles</legend>
              <div style={{ display: 'flex', gap: 16 }}>
                {ASSIGNABLE_ROLES.map((role) => (
                  <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto' }}>
                    <input
                      type="checkbox"
                      checked={form.roles.includes(role)}
                      onChange={() => toggleRole(role)}
                      style={{ width: 'auto' }}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </Modal>
      )}

      {openPanel === 'csv' && (
        <Modal title="Import users from CSV" onClose={() => setOpenPanel(null)}>
          {error && (
            <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
              {error}
            </p>
          )}
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            Required columns: {REQUIRED_COLS.join(', ')}. Role may list more than one value in one cell, separated by{' '}
            <code>;</code> (e.g. <code>Chair;NetworkAdvisor</code>). Must be UTF-8; delimiter auto-detected.
          </p>
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Users CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleCsvFile(file)
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
            <div>
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--egn-sand)' }}>
                      <th style={cellStyle}>Email</th>
                      <th style={cellStyle}>Name</th>
                      <th style={cellStyle}>Initials</th>
                      <th style={cellStyle}>Roles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((r) => (
                      <tr key={r.email} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={cellStyle}>{r.email}</td>
                        <td style={cellStyle}>{r.name}</td>
                        <td style={cellStyle}>{r.initials}</td>
                        <td style={cellStyle}>{r.roles.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-primary" disabled={importing} onClick={() => void confirmUsersImport()}>
                {importing ? 'Importing…' : `Confirm import (${csvRows.length})`}
              </button>
            </div>
          )}
        </Modal>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--egn-sand)' }}>
              <th style={cellStyle}>Email</th>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Initials</th>
              <th style={cellStyle}>Roles</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={cellStyle}>{u.email}</td>
                <td style={cellStyle}>{u.name}</td>
                <td style={cellStyle}>{u.initials}</td>
                <td style={cellStyle}>{u.roles.join(', ')}</td>
                <td style={cellStyle}>
                  <button type="button" className="btn btn-secondary" onClick={() => editUser(u)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const cellStyle: CSSProperties = { textAlign: 'left', padding: '10px 12px' }

export default AdminUsers
