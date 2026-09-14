import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-edit-group.ts.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-reset-group against non-local DATABASE_URL host "${databaseHost}".`)
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
    egnGroupName: 'Original Name',
    mmsGroupCode: 'MMS-ORIGINAL',
    partnerCode: 'EGDK',
    groupProfile: 'ORIGINAL GROUP TEXT',
    memberProfile: 'ORIGINAL MEMBER TEXT',
    companiesProfile: 'ORIGINAL COMPANIES TEXT',
  }

  const groupWithSnapshot = await prisma.group.create({
    data: {
      egnGroupId: 'verify-reset-group-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Edited Name',
      mmsGroupCode: 'MMS-EDITED',
      lifecycleStatus: 'Imported',
      chairEmail,
      groupProfile: 'EDITED GROUP TEXT',
      memberProfile: 'EDITED MEMBER TEXT',
      companiesProfile: 'EDITED COMPANIES TEXT',
      importedSnapshot,
    },
  })

  const groupWithoutSnapshot = await prisma.group.create({
    data: {
      egnGroupId: 'verify-reset-group-2',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'No Snapshot Group',
      lifecycleStatus: 'Imported',
      groupProfile: 'TEXT',
      memberProfile: 'TEXT',
      companiesProfile: 'TEXT',
    },
  })

  // --- 1. Auth/role guards.
  let res = await call('/api/resetGroup', { method: 'POST', body: { groupId: groupWithSnapshot.id } })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/resetGroup', { method: 'POST', email: chairEmail, body: { groupId: groupWithSnapshot.id } })
  assert(res.status === 403, `expected 403 for a non-Admin (Chair) caller, got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Not-found groupId.
  res = await call('/api/resetGroup', { method: 'POST', email: adminEmail, body: { groupId: 'does-not-exist' } })
  assert(res.status === 404, `expected 404 for a nonexistent group, got ${res.status}`)
  console.log('  2. 404 for a nonexistent group ok')

  // --- 3. Refuses when the group has no import snapshot (predates the feature).
  res = await call('/api/resetGroup', { method: 'POST', email: adminEmail, body: { groupId: groupWithoutSnapshot.id } })
  assert(res.status === 409, `expected 409 for a group with no import snapshot, got ${res.status}: ${JSON.stringify(res.json)}`)
  console.log('  3. Refuses a group with no import snapshot ok')

  // --- 4. A real Admin resets a group back to its imported snapshot, logs a Reset event.
  res = await call('/api/resetGroup', { method: 'POST', email: adminEmail, body: { groupId: groupWithSnapshot.id } })
  assert(res.status === 200, `expected 200 for a valid reset, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.name === 'Original Name' && res.json.mmsGroupCode === 'MMS-ORIGINAL', 'response reflects the restored fields')
  assert(res.json.groupProfile === 'ORIGINAL GROUP TEXT', 'response reflects the restored groupProfile')
  assert(res.json.pendingReapproval === false, 'pendingReapproval stays false for a group that was never Approved')

  const groupAfter = await prisma.group.findUniqueOrThrow({ where: { id: groupWithSnapshot.id } })
  assert(groupAfter.name === 'Original Name', "the group's name was actually restored")
  assert(groupAfter.groupProfile === 'ORIGINAL GROUP TEXT', "the group's groupProfile was actually restored")
  assert(groupAfter.chairEmail === chairEmail, 'chair assignment is untouched by Reset (Edit-scope only)')

  const events = await prisma.event.findMany({ where: { groupId: groupWithSnapshot.id, type: 'Reset' } })
  assert(events.length === 1 && events[0].actorEmail === adminEmail, 'a single Reset event was logged, attributed to the real Admin')
  console.log('  4. Admin resets a group to its imported snapshot ok — fields restored, chair untouched, Reset event logged')

  // --- 5. Resetting an Approved group sets pendingReapproval.
  await prisma.group.update({ where: { id: groupWithSnapshot.id }, data: { lifecycleStatus: 'Approved', pendingReapproval: false, name: 'Edited Again' } })
  res = await call('/api/resetGroup', { method: 'POST', email: adminEmail, body: { groupId: groupWithSnapshot.id } })
  assert(res.status === 200 && res.json.pendingReapproval === true, `expected pendingReapproval true after resetting an Approved group, got ${JSON.stringify(res.json)}`)
  console.log('  5. Resetting an Approved group sets pendingReapproval ok')

  console.log('verify-reset-group: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
