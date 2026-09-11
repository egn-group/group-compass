import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-reassign-group.ts.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-edit-group against non-local DATABASE_URL host "${databaseHost}".`)
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

  const group = await prisma.group.create({
    data: {
      egnGroupId: 'verify-edit-group-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Original Name',
      mmsGroupCode: 'MMS-ORIGINAL',
      lifecycleStatus: 'Imported',
      chairEmail,
      groupProfile: 'ORIGINAL GROUP TEXT',
      memberProfile: 'ORIGINAL MEMBER TEXT',
      companiesProfile: 'ORIGINAL COMPANIES TEXT',
    },
  })

  const editBody = {
    groupId: group.id,
    egnGroupName: 'Edited Name',
    mmsGroupCode: 'MMS-EDITED',
    partnerCode: 'EGDK',
    groupProfile: 'EDITED GROUP TEXT',
    memberProfile: 'EDITED MEMBER TEXT',
    companiesProfile: 'EDITED COMPANIES TEXT',
  }

  // --- 1. Auth/role guards.
  let res = await call('/api/editGroup', { method: 'POST', body: editBody })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/editGroup', { method: 'POST', email: chairEmail, body: editBody })
  assert(res.status === 403, `expected 403 for a non-Admin (Chair) caller, got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Not-found groupId.
  res = await call('/api/editGroup', { method: 'POST', email: adminEmail, body: { ...editBody, groupId: 'does-not-exist' } })
  assert(res.status === 404, `expected 404 for a nonexistent group, got ${res.status}`)
  console.log('  2. 404 for a nonexistent group ok')

  // --- 3. Invalid body (blank required field).
  res = await call('/api/editGroup', { method: 'POST', email: adminEmail, body: { ...editBody, egnGroupName: '' } })
  assert(res.status === 400, `expected 400 for a blank egnGroupName, got ${res.status}`)
  console.log('  3. Invalid-body validation ok')

  // --- 4. A real Admin edit succeeds, recomputes country, logs an Edit event.
  res = await call('/api/editGroup', { method: 'POST', email: adminEmail, body: editBody })
  assert(res.status === 200, `expected 200 for a valid edit, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.name === 'Edited Name' && res.json.mmsGroupCode === 'MMS-EDITED', 'response reflects the edited fields')
  assert(res.json.pendingReapproval === false, 'pendingReapproval stays false for a group that was never Approved')

  const groupAfter = await prisma.group.findUniqueOrThrow({ where: { id: group.id } })
  assert(groupAfter.name === 'Edited Name', "the group's name was actually updated")
  assert(groupAfter.groupProfile === 'EDITED GROUP TEXT', "the group's groupProfile was actually updated")
  assert(groupAfter.country === 'Denmark', 'country was recomputed from partnerCode (unchanged here, still Denmark)')

  const events = await prisma.event.findMany({ where: { groupId: group.id, type: 'Edit' } })
  assert(events.length === 1 && events[0].actorEmail === adminEmail, 'a single Edit event was logged, attributed to the real Admin')
  console.log('  4. Admin edits a group ok — fields updated, country recomputed, Edit event logged')

  // --- 5. Editing an Approved group sets pendingReapproval.
  await prisma.group.update({ where: { id: group.id }, data: { lifecycleStatus: 'Approved', pendingReapproval: false } })
  res = await call('/api/editGroup', { method: 'POST', email: adminEmail, body: { ...editBody, groupProfile: 'EDITED AGAIN' } })
  assert(res.status === 200 && res.json.pendingReapproval === true, `expected pendingReapproval true after editing an Approved group, got ${JSON.stringify(res.json)}`)
  console.log('  5. Editing an Approved group sets pendingReapproval ok')

  console.log('verify-edit-group: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
