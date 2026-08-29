import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-users-auth.ts. Resets
// User/Group tables to a known state first.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-groups-import against non-local DATABASE_URL host "${databaseHost}".`)
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

function rawRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    egnGroupName: 'Digital Strategy & Change Management',
    egnGroupId: '38494',
    mmsGroupCode: '02092-EGDK',
    partnerCode: 'EGDK',
    groupProfile: 'Who is the group for: ambitious CEOs.',
    memberProfile: '',
    companiesProfile: '',
    responsibleChairName: 'Chair Person',
    responsibleSalesName: 'NA Person',
    ...overrides,
  }
}

async function main() {
  await prisma.event.deleteMany({})
  await prisma.group.deleteMany({})
  await prisma.user.deleteMany({})

  const adminEmail = 'admin@example.com'
  const chairEmail = 'chair@example.com'
  const naEmail = 'na@example.com'
  await prisma.user.create({ data: { email: adminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] } })
  await prisma.user.create({ data: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] } })
  await prisma.user.create({ data: { email: naEmail, name: 'NA Person', initials: 'NP', roles: ['NetworkAdvisor'] } })

  // 1. Unauthenticated / non-admin rejected from all three endpoints.
  let res = await call('/api/getGroups', { method: 'GET' })
  assert(res.status === 401, `expected 401 unauthenticated getGroups, got ${res.status}`)
  res = await call('/api/checkGroupImport', { method: 'POST', email: chairEmail, body: { rows: [rawRow()] } })
  assert(res.status === 403, `expected 403 non-admin checkGroupImport, got ${res.status}`)

  // 2. Check a brand-new group: status 'new', Chair/NA best-guess matched by name.
  res = await call('/api/checkGroupImport', { method: 'POST', email: adminEmail, body: { rows: [rawRow()] } })
  assert(res.status === 200, `expected 200 checkGroupImport, got ${res.status}: ${JSON.stringify(res.json)}`)
  let checked = res.json as Array<{ status: string; suggestedChairEmail: string | null; suggestedNetworkAdvisorEmail: string | null }>
  assert(checked[0].status === 'new', `expected status 'new', got ${checked[0].status}`)
  assert(checked[0].suggestedChairEmail === chairEmail, 'Chair should be matched by name')
  assert(checked[0].suggestedNetworkAdvisorEmail === naEmail, 'NA should be matched by name')

  // 3. Import it (create), country resolved from partner code, noSourceDna false (one section filled).
  res = await call('/api/putGroups', {
    method: 'POST',
    email: adminEmail,
    body: {
      rows: [
        {
          ...rawRow(),
          chairEmail,
          networkAdvisorEmail: naEmail,
          action: { type: 'create' },
        },
      ],
    },
  })
  assert(res.status === 200, `expected 200 putGroups create, got ${res.status}: ${JSON.stringify(res.json)}`)
  const created = await prisma.group.findFirstOrThrow({ where: { egnGroupId: '38494' } })
  assert(created.country === 'Denmark', `expected country Denmark, got "${created.country}"`)
  assert(created.noSourceDna === false, 'noSourceDna should be false — one profile section is filled')
  assert(created.chairEmail === chairEmail && created.networkAdvisorEmail === naEmail, 'Chair/NA should be wired')
  const importEvent = await prisma.event.findFirst({ where: { groupId: created.id, type: 'Import' } })
  assert(!!importEvent, 'an Import Event row should have been recorded')

  // 4. Re-checking the exact same text (with insignificant whitespace differences) reports 'unchanged'.
  res = await call('/api/checkGroupImport', {
    method: 'POST',
    email: adminEmail,
    body: { rows: [rawRow({ groupProfile: '  Who is the group for: ambitious   CEOs.  ' })] },
  })
  checked = res.json as typeof checked
  assert(checked[0].status === 'unchanged', `expected 'unchanged' for whitespace-only difference, got ${checked[0].status}`)

  // 5. Re-checking with genuinely different text reports 'changed', pointing at the existing group.
  res = await call('/api/checkGroupImport', {
    method: 'POST',
    email: adminEmail,
    body: { rows: [rawRow({ groupProfile: 'Completely different wording now.' })] },
  })
  checked = res.json as typeof checked
  const changed = checked[0] as unknown as { status: string; existingGroupId: string | null }
  assert(changed.status === 'changed', `expected 'changed' for genuine text change, got ${changed.status}`)
  assert(changed.existingGroupId === created.id, 'changed row should point at the existing group id')

  // 6. Overwriting updates the existing record in place rather than creating a new one.
  res = await call('/api/putGroups', {
    method: 'POST',
    email: adminEmail,
    body: {
      rows: [
        {
          ...rawRow({ groupProfile: 'Completely different wording now.' }),
          chairEmail,
          networkAdvisorEmail: naEmail,
          action: { type: 'overwrite', groupId: created.id },
        },
      ],
    },
  })
  assert(res.status === 200, `expected 200 putGroups overwrite, got ${res.status}: ${JSON.stringify(res.json)}`)
  const groupCount = await prisma.group.count({ where: { egnGroupId: '38494' } })
  assert(groupCount === 1, `expected still exactly 1 group for this egnGroupId, got ${groupCount}`)
  const overwritten = await prisma.group.findUniqueOrThrow({ where: { id: created.id } })
  assert(overwritten.groupProfile === 'Completely different wording now.', 'overwrite should update the profile text')

  // 7. An unmatched Chair/NA name still imports, flagged (nullable FKs).
  res = await call('/api/putGroups', {
    method: 'POST',
    email: adminEmail,
    body: {
      rows: [
        {
          ...rawRow({ egnGroupId: '999', responsibleChairName: 'Nobody Matching' }),
          chairEmail: null,
          networkAdvisorEmail: naEmail,
          action: { type: 'create' },
        },
      ],
    },
  })
  assert(res.status === 200, `expected 200 for unmatched-Chair create, got ${res.status}: ${JSON.stringify(res.json)}`)
  const unmatched = await prisma.group.findFirstOrThrow({ where: { egnGroupId: '999' } })
  assert(unmatched.chairEmail === null, 'group should still import with no Chair matched')

  // 8. getGroups lists both, with quality flags computed.
  res = await call('/api/getGroups', { method: 'GET', email: adminEmail })
  assert(res.status === 200, `expected 200 getGroups, got ${res.status}`)
  const groups = res.json as Array<{ egnGroupId: string; chairEmail: string | null }>
  assert(groups.length === 2, `expected 2 groups, got ${groups.length}`)

  await prisma.event.deleteMany({})
  await prisma.group.deleteMany({})
  await prisma.user.deleteMany({})
  console.log('Group import verification passed: new/unchanged/changed detection, country lookup, unmatched-Chair/NA handling, and auth all correct.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
