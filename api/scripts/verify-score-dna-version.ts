import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as verify-launch.ts. This makes a
// real AI call (scoreDna's own model, 8 max tokens) — cheap, and consistent
// with verify-dna-generation.ts's own real-AI-call convention.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-score-dna-version against non-local DATABASE_URL host "${databaseHost}".`)
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
  const chairLeaderEmail = 'chairleader@example.com'
  const chairEmail = 'chair@example.com' // neither Admin nor ChairLeader — used for the negative role check
  await prisma.user.create({ data: { email: adminEmail, name: 'Admin', initials: 'AD', roles: ['Admin'] } })
  await prisma.user.create({ data: { email: chairLeaderEmail, name: 'Chair Leader', initials: 'CL', roles: ['ChairLeader'] } })
  await prisma.user.create({ data: { email: chairEmail, name: 'Chair Person', initials: 'CP', roles: ['Chair'] } })

  const group = await prisma.group.create({
    data: {
      egnGroupId: 'verify-score-1',
      partnerCode: 'EGDK',
      country: 'Denmark',
      name: 'Verify Score Group',
      lifecycleStatus: 'DraftGenerated',
      groupProfile: 'Ambitious owner-managers meeting monthly to challenge each other on growth strategy.',
      memberProfile: '8 CEOs of companies with 20-150 employees.',
      companiesProfile: 'Revenue 15M-300M DKK, several past ownership transitions.',
    },
  })
  const importedVersion = await prisma.dnaVersion.create({
    data: {
      groupId: group.id,
      versionNumber: 1,
      content: {
        groupProfile: group.groupProfile,
        memberProfile: group.memberProfile,
        companiesProfile: group.companiesProfile,
      },
      author: null,
      scoreStage: 'Imported',
      // score deliberately left null, matching how issue #22 actually creates it.
    },
  })
  assert(importedVersion.score === null, "Imported-stage version starts with score null (issue #22's scoping decision)")

  // --- 1. Unauthenticated / wrong role: 401 / 403.
  let res = await call('/api/scoreDnaVersion', { method: 'POST', body: { dnaVersionId: importedVersion.id } })
  assert(res.status === 401, `expected 401 for unauthenticated call, got ${res.status}`)
  res = await call('/api/scoreDnaVersion', { method: 'POST', email: chairEmail, body: { dnaVersionId: importedVersion.id } })
  assert(res.status === 403, `expected 403 for a Chair (neither Admin nor Chair Leader), got ${res.status}`)
  console.log('  1. Auth/role guard (401/403) ok')

  // --- 2. Validation + not-found.
  res = await call('/api/scoreDnaVersion', { method: 'POST', email: adminEmail, body: {} })
  assert(res.status === 400, `expected 400 for a missing dnaVersionId, got ${res.status}`)
  res = await call('/api/scoreDnaVersion', { method: 'POST', email: adminEmail, body: { dnaVersionId: 'does-not-exist' } })
  assert(res.status === 404, `expected 404 for a nonexistent DnaVersion, got ${res.status}`)
  console.log('  2. Validation + not-found guards ok')

  // --- 3. Admin can score the Imported-stage version, on demand.
  res = await call('/api/scoreDnaVersion', { method: 'POST', email: adminEmail, body: { dnaVersionId: importedVersion.id } })
  assert(res.status === 200, `expected 200 for admin scoring, got ${res.status}: ${JSON.stringify(res.json)}`)
  const firstScore = (res.json as { score: number }).score
  assert(firstScore >= 1 && firstScore <= 5, `response score is in 1-5 range (got ${firstScore})`)

  const versionAfterFirstScore = await prisma.dnaVersion.findUniqueOrThrow({ where: { id: importedVersion.id } })
  assert(versionAfterFirstScore.score === firstScore, "DnaVersion.score was written with the endpoint's returned score")
  console.log(`  3. Admin scoring an Imported-stage version ok (score=${firstScore})`)

  // --- 4. Chair Leader can also score (spec §9/§4 visibility, not just Admin).
  res = await call('/api/scoreDnaVersion', { method: 'POST', email: chairLeaderEmail, body: { dnaVersionId: importedVersion.id } })
  assert(res.status === 200, `expected 200 for Chair Leader scoring, got ${res.status}: ${JSON.stringify(res.json)}`)
  console.log('  4. Chair Leader can also trigger scoring ok')

  // --- 5. Re-scoring an already-scored version overwrites it — not a "nothing is ever overwritten" violation, per the ticket.
  const rescored = (res.json as { score: number }).score
  const versionAfterRescore = await prisma.dnaVersion.findUniqueOrThrow({ where: { id: importedVersion.id } })
  assert(versionAfterRescore.score === rescored, 're-scoring overwrites the version\'s score field with the new result')
  console.log('  5. Re-scoring an already-scored version is allowed and overwrites ok')

  console.log('verify-score-dna-version: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
