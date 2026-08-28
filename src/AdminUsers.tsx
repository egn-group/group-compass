import { useEffect, useState } from 'react'
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

  async function loadUsers() {
    setError('')
    const res = await fetch('/api/getUsers')
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
  }

  async function submit() {
    setError('')
    const parsed = UpsertUserSchema.safeParse(form)
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
      await loadUsers()
    } finally {
      setSaving(false)
    }
  }

  const isEditing = form.email !== '' && users.some((u) => u.email === form.email)

  return (
    <section>
      <h2>Users</h2>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Initials</th>
            <th>Roles</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>{u.initials}</td>
              <td>{u.roles.join(', ')}</td>
              <td>
                <button type="button" onClick={() => editUser(u)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{isEditing ? 'Edit user' : 'Add user'}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label>
          Email
          <input
            value={form.email}
            disabled={isEditing}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label>
          Initials
          <input value={form.initials} onChange={(e) => setForm((f) => ({ ...f, initials: e.target.value }))} />
        </label>
        <fieldset>
          <legend>Roles</legend>
          {ASSIGNABLE_ROLES.map((role) => (
            <label key={role}>
              <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />
              {role}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  )
}

export default AdminUsers
