import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-edit-group.ts.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-group-roster against non-local DATABASE_URL host "${databaseHost}".`)
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
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  await prisma.aiConversationTurn.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.event.deleteMany({})
  await prisma.dnaVersion.deleteMany({})
  await prisma.group.deleteMany({})
  await prisma.user.deleteMany({})

  const adminEmail = 'admin@example.com'
  const chairEmail = 'chair@example.com'
  await prisma.user.create({ data: { email: adminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] } })
  await prisma.user.create({ data: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] } })

  const importedSnapshot = {
    egnGroupName: 'Test Group',
    mmsGroupCode: 'MMS-1',
    partnerCode: 'EGDK',
    groupProfile: 'GROUP TEXT',
    memberProfile: 'MEMBER TEXT',
    companiesProfile: 'COMPANIES TEXT',
  }
  const group = await prisma.group.create({
    data: {
      egnGroupId: 'verify-group-roster-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Test Group',
      lifecycleStatus: 'Imported',
      groupProfile: 'GROUP TEXT',
      memberProfile: 'MEMBER TEXT',
      companiesProfile: 'COMPANIES TEXT',
      importedSnapshot,
    },
  })

  // --- 1. Auth/role guards.
  let res = await call('/api/saveGroupRoster', { method: 'POST', body: { groupId: group.id, roster: 'CFO — Acme A/S' } })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/saveGroupRoster', { method: 'POST', email: chairEmail, body: { groupId: group.id, roster: 'CFO — Acme A/S' } })
  assert(res.status === 403, `expected 403 for a non-Admin (Chair) caller, got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Not-found groupId.
  res = await call('/api/saveGroupRoster', { method: 'POST', email: adminEmail, body: { groupId: 'does-not-exist', roster: 'x' } })
  assert(res.status === 404, `expected 404 for a nonexistent group, got ${res.status}`)
  console.log('  2. 404 for a nonexistent group ok')

  // --- 3. getGroup starts with roster null — nothing pasted yet.
  res = await call(`/api/getGroup?groupId=${group.id}`, { method: 'GET', email: adminEmail })
  assert(res.status === 200 && res.json.roster === null, `expected roster null before anything is saved, got ${JSON.stringify(res.json.roster)}`)
  console.log('  3. getGroup reports roster null before anything is saved ok')

  // --- 4. Saving a roster persists it — visible on a later, independent getGroup call.
  res = await call('/api/saveGroupRoster', {
    method: 'POST',
    email: adminEmail,
    body: { groupId: group.id, roster: 'CFO — Acme A/S\nHead of Operations — Northco ApS' },
  })
  assert(res.status === 200, `expected 200 saving a roster, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.roster === 'CFO — Acme A/S\nHead of Operations — Northco ApS', 'response reflects the saved roster')

  res = await call(`/api/getGroup?groupId=${group.id}`, { method: 'GET', email: adminEmail })
  assert(res.json.roster === 'CFO — Acme A/S\nHead of Operations — Northco ApS', "getGroup's own roster field reflects the save — it's kept, not just returned once")
  console.log('  4. Saved roster persists, visible on a later, independent getGroup call ok')

  // --- 5. Leading/trailing whitespace is trimmed; an empty/whitespace-only
  // string clears it back to null (never an empty string sitting in the DB).
  res = await call('/api/saveGroupRoster', { method: 'POST', email: adminEmail, body: { groupId: group.id, roster: '  padded text  ' } })
  assert(res.status === 200 && res.json.roster === 'padded text', `expected trimmed roster, got ${JSON.stringify(res.json.roster)}`)
  res = await call('/api/saveGroupRoster', { method: 'POST', email: adminEmail, body: { groupId: group.id, roster: '   ' } })
  assert(res.status === 200 && res.json.roster === null, `expected a whitespace-only roster to clear back to null, got ${JSON.stringify(res.json.roster)}`)
  console.log('  5. Trimming and clear-to-null ok')

  // --- 6. Reset to imported must NOT clear the roster — it describes the
  // group's real current membership, independent of what stage the DNA
  // text itself is in.
  res = await call('/api/saveGroupRoster', { method: 'POST', email: adminEmail, body: { groupId: group.id, roster: 'CFO — Acme A/S' } })
  assert(res.status === 200, `expected 200 saving a roster before reset, got ${res.status}`)
  res = await call('/api/resetGroup', { method: 'POST', email: adminEmail, body: { groupId: group.id } })
  assert(res.status === 200, `expected 200 resetting the group, got ${res.status}: ${JSON.stringify(res.json)}`)
  res = await call(`/api/getGroup?groupId=${group.id}`, { method: 'GET', email: adminEmail })
  assert(res.json.roster === 'CFO — Acme A/S', "Reset must not clear the roster — it's independent of the DNA content it reset")
  console.log('  6. Reset to imported leaves the roster untouched ok')

  console.log('verify-group-roster: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
