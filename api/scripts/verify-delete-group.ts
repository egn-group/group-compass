import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-reassign-group.ts.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-delete-group against non-local DATABASE_URL host "${databaseHost}".`)
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

  const freshGroup = await prisma.group.create({
    data: {
      egnGroupId: 'verify-delete-group-fresh',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Fresh Import, No Activity',
      lifecycleStatus: 'Imported',
      groupProfile: 'TEXT',
      memberProfile: 'TEXT',
      companiesProfile: 'TEXT',
    },
  })

  const touchedGroup = await prisma.group.create({
    data: {
      egnGroupId: 'verify-delete-group-touched',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Has DNA History',
      lifecycleStatus: 'DraftGenerated',
      groupProfile: 'TEXT',
      memberProfile: 'TEXT',
      companiesProfile: 'TEXT',
    },
  })
  await prisma.dnaVersion.create({
    data: { groupId: touchedGroup.id, versionNumber: 1, content: { groupProfile: 'TEXT', memberProfile: 'TEXT', companiesProfile: 'TEXT' } },
  })

  // --- 1. Auth/role guards.
  let res = await call('/api/deleteGroup', { method: 'POST', body: { groupId: freshGroup.id } })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/deleteGroup', { method: 'POST', email: chairEmail, body: { groupId: freshGroup.id } })
  assert(res.status === 403, `expected 403 for a non-Admin (Chair) caller, got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Not-found groupId.
  res = await call('/api/deleteGroup', { method: 'POST', email: adminEmail, body: { groupId: 'does-not-exist' } })
  assert(res.status === 404, `expected 404 for a nonexistent group, got ${res.status}`)
  console.log('  2. 404 for a nonexistent group ok')

  // --- 3. Refuses to delete a group with DNA-version history.
  res = await call('/api/deleteGroup', { method: 'POST', email: adminEmail, body: { groupId: touchedGroup.id } })
  assert(res.status === 409, `expected 409 for a group with DNA history, got ${res.status}: ${JSON.stringify(res.json)}`)
  const stillThere = await prisma.group.findUnique({ where: { id: touchedGroup.id } })
  assert(stillThere !== null, 'the group with history was NOT actually deleted')
  console.log('  3. Refuses to delete a group with DNA/history ok — nothing was destroyed')

  // --- 4. A real Admin deletes a freshly-imported group with no activity.
  res = await call('/api/deleteGroup', { method: 'POST', email: adminEmail, body: { groupId: freshGroup.id } })
  assert(res.status === 200, `expected 200 for deleting a fresh group, got ${res.status}: ${JSON.stringify(res.json)}`)
  const gone = await prisma.group.findUnique({ where: { id: freshGroup.id } })
  assert(gone === null, 'the fresh group with no activity was actually deleted')
  console.log('  4. Admin deletes a freshly-imported group ok — actually gone from the database')

  console.log('verify-delete-group: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
