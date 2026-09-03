import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-launch.ts. Exercises the
// Admin-only "View as" preview (api/shared/auth.ts's resolveViewAs) end to
// end: the read endpoints that honor x-view-as-email, and — just as
// important — confirms the mutation endpoints never do.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-view-as against non-local DATABASE_URL host "${databaseHost}".`)
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

async function call(path: string, opts: { method: string; email?: string; viewAsEmail?: string; body?: unknown }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.email) headers['x-ms-client-principal'] = principalHeader(opts.email)
  if (opts.viewAsEmail) headers['x-view-as-email'] = opts.viewAsEmail
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
  const naEmail = 'na@example.com'
  await prisma.user.create({ data: { email: adminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] } })
  await prisma.user.create({ data: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] } })
  await prisma.user.create({ data: { email: naEmail, name: 'NA Person', initials: 'NP', roles: ['NetworkAdvisor'], hasSeenNaGuidance: true } })

  const chairGroup = await prisma.group.create({
    data: {
      egnGroupId: 'verify-view-as-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Verify View As — Chair Group',
      lifecycleStatus: 'ChairReview',
      chairEmail,
      groupProfile: 'GROUP TEXT',
      memberProfile: 'MEMBER TEXT',
      companiesProfile: 'COMPANIES TEXT',
    },
  })
  const naGroup = await prisma.group.create({
    data: {
      egnGroupId: 'verify-view-as-2',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Verify View As — NA Group',
      lifecycleStatus: 'Launched',
      networkAdvisorEmail: naEmail,
      groupProfile: 'GROUP TEXT 2',
      memberProfile: 'MEMBER TEXT 2',
      companiesProfile: 'COMPANIES TEXT 2',
    },
  })

  // --- 1. A non-admin sending the header is silently ignored — they just
  // get their own (empty) data, not an error, and definitely not the target's.
  let res = await call('/api/getChairGroups', { method: 'GET', email: chairEmail, viewAsEmail: 'someone-else@example.com' })
  assert(res.status === 200, `expected 200 for a Chair's own getChairGroups even with a (bogus) view-as header, got ${res.status}`)
  assert(res.json.groups.length === 1 && res.json.groups[0].id === chairGroup.id, "a non-admin's view-as header is ignored — they see their own groups")

  // --- 2. A real Admin, no header: their own (empty) view — the header
  // being absent must not accidentally grant them Chair/NA data.
  res = await call('/api/getChairGroups', { method: 'GET', email: adminEmail })
  assert(res.status === 403, `expected 403 for an Admin calling getChairGroups with no view-as header (they hold no Chair role), got ${res.status}`)
  console.log('  1-2. Non-admin view-as header ignored; admin-with-no-header still 403s ok')

  // --- 3. A real Admin, with the header: sees the target Chair's real groups.
  res = await call('/api/getChairGroups', { method: 'GET', email: adminEmail, viewAsEmail: chairEmail })
  assert(res.status === 200, `expected 200 for Admin view-as Chair on getChairGroups, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.groups.length === 1 && res.json.groups[0].id === chairGroup.id, 'Admin view-as Chair sees the real Chair-owned group')

  res = await call(`/api/getChairGroup?groupId=${chairGroup.id}`, { method: 'GET', email: adminEmail, viewAsEmail: chairEmail })
  assert(res.status === 200, `expected 200 for Admin view-as Chair on getChairGroup, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.id === chairGroup.id, "Admin view-as Chair's getChairGroup detail matches the real group")
  console.log('  3. Admin view-as a real Chair sees that Chair\'s real list + detail ok')

  // --- 4. Same for Network Advisor — and showGuidance is suppressed
  // (never the Admin's own irrelevant flag, never the target's real one).
  res = await call('/api/getNaGroups', { method: 'GET', email: adminEmail, viewAsEmail: naEmail })
  assert(res.status === 200, `expected 200 for Admin view-as NA on getNaGroups, got ${res.status}: ${JSON.stringify(res.json)}`)
  assert(res.json.groups.length === 1 && res.json.groups[0].id === naGroup.id, 'Admin view-as NA sees the real NA-owned group')
  assert(res.json.showGuidance === false, 'showGuidance is suppressed while viewing as someone, even though the real NA has already seen it')
  console.log('  4. Admin view-as a real Network Advisor sees their real groups, guidance banner suppressed ok')

  // --- 5. The one that matters most: no mutation endpoint honors the
  // header. An Admin "viewing as" a Chair still cannot approve a field —
  // they simply aren't a Chair, view-as or not.
  res = await call('/api/approveChairField', { method: 'POST', email: adminEmail, viewAsEmail: chairEmail, body: { groupId: chairGroup.id, field: 'GroupProfile' } })
  assert(res.status === 403, `expected 403 — approveChairField must never honor x-view-as-email, got ${res.status}`)

  res = await call('/api/editChairField', {
    method: 'POST',
    email: adminEmail,
    viewAsEmail: chairEmail,
    body: { groupId: chairGroup.id, field: 'GroupProfile', text: 'HIJACKED TEXT' },
  })
  assert(res.status === 403, `expected 403 — editChairField must never honor x-view-as-email, got ${res.status}`)

  res = await call('/api/putNaComments', {
    method: 'POST',
    email: adminEmail,
    viewAsEmail: naEmail,
    body: { groupId: naGroup.id, comments: [{ field: 'GroupProfile', text: 'hijacked comment' }] },
  })
  assert(res.status === 403, `expected 403 — putNaComments must never honor x-view-as-email, got ${res.status}`)

  const groupAfter = await prisma.group.findUniqueOrThrow({ where: { id: chairGroup.id } })
  assert(groupAfter.groupProfile === 'GROUP TEXT', 'nothing was actually mutated by the rejected view-as write attempts')
  console.log('  5. No mutation endpoint (approveChairField/editChairField/putNaComments) honors the view-as header ok — all 403, nothing written')

  // --- 6. getMe now carries name/initials too.
  res = await call('/api/getMe', { method: 'GET', email: chairEmail })
  assert(res.status === 200 && res.json.name === 'Chair Person' && res.json.initials === 'CP', `expected getMe to include the real name/initials, got ${JSON.stringify(res.json)}`)
  console.log('  6. getMe exposes name/initials ok')

  console.log('verify-view-as: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
