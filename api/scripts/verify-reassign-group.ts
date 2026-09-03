import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-launch.ts.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-reassign-group against non-local DATABASE_URL host "${databaseHost}".`)
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
  const otherChairEmail = 'other-chair@example.com'
  const naEmail = 'na@example.com'
  await prisma.user.create({ data: { email: adminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] } })
  await prisma.user.create({ data: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] } })
  await prisma.user.create({ data: { email: otherChairEmail, name: 'Other Chair', initials: 'OC', roles: ['Chair'] } })
  await prisma.user.create({ data: { email: naEmail, name: 'NA Person', initials: 'NP', roles: ['NetworkAdvisor'] } })

  const group = await prisma.group.create({
    data: {
      egnGroupId: 'verify-reassign-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Verify Reassign Group',
      lifecycleStatus: 'Imported',
      chairEmail,
      groupProfile: 'GROUP TEXT',
      memberProfile: 'MEMBER TEXT',
      companiesProfile: 'COMPANIES TEXT',
    },
  })

  // --- 1. Auth/role guards.
  let res = await call('/api/reassignGroup', { method: 'POST', body: { groupId: group.id, chairEmail: null, networkAdvisorEmail: null } })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/reassignGroup', { method: 'POST', email: chairEmail, body: { groupId: group.id, chairEmail: null, networkAdvisorEmail: null } })
  assert(res.status === 403, `expected 403 for a non-Admin (Chair) caller, got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Not-found groupId.
  res = await call('/api/reassignGroup', { method: 'POST', email: adminEmail, body: { groupId: 'does-not-exist', chairEmail: null, networkAdvisorEmail: null } })
  assert(res.status === 404, `expected 404 for a nonexistent group, got ${res.status}`)
  console.log('  2. 404 for a nonexistent group ok')

  // --- 3. chairEmail/networkAdvisorEmail must be a real User with the right role.
  res = await call('/api/reassignGroup', {
    method: 'POST',
    email: adminEmail,
    body: { groupId: group.id, chairEmail: 'not-a-real-user@example.com', networkAdvisorEmail: null },
  })
  assert(res.status === 400, `expected 400 for a chairEmail with no matching User, got ${res.status}`)
  res = await call('/api/reassignGroup', {
    method: 'POST',
    email: adminEmail,
    body: { groupId: group.id, chairEmail: naEmail, networkAdvisorEmail: null }, // real User, wrong role
  })
  assert(res.status === 400, `expected 400 for a chairEmail belonging to a User without the Chair role, got ${res.status}`)
  res = await call('/api/reassignGroup', {
    method: 'POST',
    email: adminEmail,
    body: { groupId: group.id, chairEmail: null, networkAdvisorEmail: chairEmail }, // real User, wrong role
  })
  assert(res.status === 400, `expected 400 for a networkAdvisorEmail belonging to a User without the NetworkAdvisor role, got ${res.status}`)
  console.log('  3. chairEmail/networkAdvisorEmail existence + role validation ok')

  const groupUnchanged = await prisma.group.findUniqueOrThrow({ where: { id: group.id } })
  assert(groupUnchanged.chairEmail === chairEmail && groupUnchanged.networkAdvisorEmail === null, 'none of the rejected attempts above actually wrote anything')

  // --- 4. A real Admin reassigns to a different real Chair and a real NA — succeeds, logs a Reassign event.
  res = await call('/api/reassignGroup', {
    method: 'POST',
    email: adminEmail,
    body: { groupId: group.id, chairEmail: 'Other-Chair@Example.com', networkAdvisorEmail: naEmail },
  })
  assert(res.status === 200, `expected 200 for a valid reassignment, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.chairEmail === otherChairEmail && res.json.networkAdvisorEmail === naEmail, 'response reflects the new assignment, email lowercased')

  const groupAfter = await prisma.group.findUniqueOrThrow({ where: { id: group.id } })
  assert(groupAfter.chairEmail === otherChairEmail, "the group's chairEmail was actually updated")
  assert(groupAfter.networkAdvisorEmail === naEmail, "the group's networkAdvisorEmail was actually updated")

  const events = await prisma.event.findMany({ where: { groupId: group.id, type: 'Reassign' } })
  assert(events.length === 1 && events[0].actorEmail === adminEmail, 'a single Reassign event was logged, attributed to the real Admin')
  console.log('  4. Admin reassigns Chair + NA to real users ok — group updated, Reassign event logged')

  // --- 5. null unassigns.
  res = await call('/api/reassignGroup', { method: 'POST', email: adminEmail, body: { groupId: group.id, chairEmail: null, networkAdvisorEmail: null } })
  assert(res.status === 200 && res.json.chairEmail === null && res.json.networkAdvisorEmail === null, `expected 200 with both fields null, got ${res.status}: ${JSON.stringify(res.json)}`)
  console.log('  5. null unassigns both Chair and NA ok')

  console.log('verify-reassign-group: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
