import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { UpsertUserSchema, type RoleValue, type UserDto } from '../shared/schemas/user'

// Chair Leader and Sales Leader are deferred past this pilot (wayfinder map,
// issue #1) — this Admin page only offers the three active roles.
const ASSIGNABLE_ROLES: RoleValue[] = ['Admin', 'Chair', 'NetworkAdvisor']

function emptyForm() {
  return { email: '', name: '', initials: '', roles: [] as RoleValue[] }
}

function AdminUsers() {
  const [users, setUsers] = useState<UserDto[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  // Roles the edited user already has that this page doesn't expose
  // checkboxes for (e.g. ChairLeader/SalesLeader, deferred past this pilot).
  // Carried silently so saving an edit can't accidentally strip them.
  const [hiddenRoles, setHiddenRoles] = useState<string[]>([])

  // Guards against an earlier, slower loadUsers() call resolving after a
  // later one and overwriting fresher state with stale data (this page
  // calls it both on mount and after every save).
  const usersRequestId = useRef(0)

  async function loadUsers() {
    setError('')
    const id = ++usersRequestId.current
    const res = await fetch('/api/getUsers')
    if (id !== usersRequestId.current) return
    if (!res.ok) {
      setError(`Could not load users (${res.status}).`)
      return
    }
    setUsers((await res.json()) as UserDto[])
  }

  useEffect(() => {
    void loadUsers()
  }, [])

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
      await loadUsers()
    } finally {
      setSaving(false)
    }
  }

  const isEditing = form.email !== '' && users.some((u) => u.email === form.email)

  return (
    <section className="card" style={{ padding: '28px 32px', marginBottom: 32 }}>
      <h2 style={{ marginBottom: 16 }}>Users</h2>
      {error && (
        <p role="alert" style={{ color: 'var(--status-danger)', marginBottom: 16 }}>
          {error}
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 32 }}>
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

      <h3 style={{ marginBottom: 16 }}>{isEditing ? 'Edit user' : 'Add user'}</h3>
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
    </section>
  )
}

const cellStyle: CSSProperties = { textAlign: 'left', padding: '10px 12px' }

export default AdminUsers
