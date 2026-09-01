import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// This script resets the User table to test bootstrap behavior, and hits a
// real running Functions host with hand-built x-ms-client-principal headers
// standing in for SWA's edge auth — the "local auth stub" issue #14 allows,
// since no real Entra sign-in exists yet. Refuse to run against anything but
// a local database for the same reason verify-crud.ts does.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-users-auth against non-local DATABASE_URL host "${databaseHost}".`)
}

const FUNCTIONS_HOST = process.env.FUNCTIONS_HOST ?? 'http://localhost:7071'
const prisma = new PrismaClient()

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function principalHeader(email: string): string {
  const principal = { userId: email, userDetails: email, identityProvider: 'aad', userRoles: ['authenticated'] }
  return Buffer.from(JSON.stringify(principal), 'utf-8').toString('base64')
}

async function call(path: string, opts: { method: string; email?: string; body?: unknown }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.email) headers['x-ms-client-principal'] = principalHeader(opts.email)
  const res = await fetch(`${FUNCTIONS_HOST}${path}`, {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  // Full cascade, not just User — a prior verify script's leftover
  // Group/Event/etc. rows referencing these emails would otherwise block
  // deleting them (FK RESTRICT), regardless of which script happened to
  // run last.
  await prisma.aiConversationTurn.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.event.deleteMany({})
  await prisma.dnaVersion.deleteMany({})
  await prisma.group.deleteMany({})
  await prisma.user.deleteMany({})

  const trustedAdminEmail = 'admin@example.com' // matches INITIAL_ADMIN_EMAILS in .env/local.settings.json
  const untrustedEmail = 'stranger@example.com'
  const chairEmail = 'chair@example.com'

  // 1. Unauthenticated caller: 401 on both endpoints.
  let res = await call('/api/putUsers', { method: 'POST', body: { email: chairEmail, name: 'x', initials: 'x', roles: ['Chair'] } })
  assert(res.status === 401, `expected 401 for unauthenticated putUsers, got ${res.status}`)
  res = await call('/api/getUsers', { method: 'GET' })
  assert(res.status === 401, `expected 401 for unauthenticated getUsers, got ${res.status}`)

  // 2. Bootstrap: an untrusted caller cannot create anyone, even themselves.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: untrustedEmail,
    body: { email: untrustedEmail, name: 'Stranger', initials: 'ST', roles: ['Admin'] },
  })
  assert(res.status === 403, `expected 403 for untrusted bootstrap caller, got ${res.status}`)

  // 3. Bootstrap: a trusted caller cannot use the bootstrap write to create someone else.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: trustedAdminEmail,
    body: { email: untrustedEmail, name: 'Stranger', initials: 'ST', roles: ['Admin'] },
  })
  assert(res.status === 403, `expected 403 for bootstrap write targeting a non-trusted email, got ${res.status}`)
  assert((await prisma.user.count()) === 0, 'no user should have been created yet')

  // 3b. Bootstrap: a trusted caller creating themselves without the Admin
  // role is rejected — otherwise the very first user could permanently lock
  // everyone out of user management (no one could ever pass requireAdmin).
  res = await call('/api/putUsers', {
    method: 'POST',
    email: trustedAdminEmail,
    body: { email: trustedAdminEmail, name: 'Admin', initials: 'AD', roles: ['Chair'] },
  })
  assert(res.status === 403, `expected 403 for bootstrap without Admin role, got ${res.status}`)
  assert((await prisma.user.count()) === 0, 'no user should have been created yet')

  // 4. Bootstrap: a trusted caller creating themselves succeeds.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: trustedAdminEmail,
    body: { email: trustedAdminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] },
  })
  assert(res.status === 200, `expected 200 for bootstrap self-creation, got ${res.status}: ${JSON.stringify(res.json)}`)

  // 5. Post-bootstrap: a caller with no User row (or a non-admin one) is rejected.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: untrustedEmail,
    body: { email: chairEmail, name: 'Chair', initials: 'CH', roles: ['Chair'] },
  })
  assert(res.status === 403, `expected 403 for non-admin write after bootstrap, got ${res.status}`)
  res = await call('/api/getUsers', { method: 'GET', email: untrustedEmail })
  assert(res.status === 403, `expected 403 for non-admin read after bootstrap, got ${res.status}`)

  // 6. Post-bootstrap: the real Admin can create a Chair.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: trustedAdminEmail,
    body: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] },
  })
  assert(res.status === 200, `expected 200 for admin-created Chair, got ${res.status}: ${JSON.stringify(res.json)}`)

  // 7. Admin can list both users; roles round-trip correctly.
  res = await call('/api/getUsers', { method: 'GET', email: trustedAdminEmail })
  assert(res.status === 200, `expected 200 for admin read, got ${res.status}`)
  const users = res.json as Array<{ email: string; roles: string[] }>
  assert(users.length === 2, `expected 2 users, got ${users.length}`)
  const chair = users.find((u) => u.email === chairEmail)
  assert(!!chair && chair.roles.includes('Chair'), 'created Chair should have the Chair role')

  // 8. Editing an existing user (role change) via the same upsert endpoint.
  res = await call('/api/putUsers', {
    method: 'POST',
    email: trustedAdminEmail,
    body: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair', 'NetworkAdvisor'] },
  })
  assert(res.status === 200, `expected 200 for admin edit, got ${res.status}`)
  const updated = (res.json as { roles: string[] }).roles
  assert(updated.includes('NetworkAdvisor') && updated.includes('Chair'), 'edit should update roles')

  await prisma.user.deleteMany({})
  console.log('User auth/bootstrap verification passed: 401/403/200 paths and bootstrap gating all correct.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
