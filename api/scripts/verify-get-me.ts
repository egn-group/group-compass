import 'dotenv/config'
import { PrismaClient } from '../shared/prismaClient'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as every other verify script —
// proves the parsing/response wiring works without needing a real Entra
// sign-in (issue #13's own acceptance criteria: "no real Entra required").
// The real interactive sign-in flow through Entra is verified separately,
// by hand, against the deployed app.
const databaseUrl = process.env.DATABASE_URL ?? ''
const databaseHost = new URL(databaseUrl).hostname
if (databaseHost !== 'localhost' && databaseHost !== '127.0.0.1') {
  throw new Error(`Refusing to run verify-get-me against non-local DATABASE_URL host "${databaseHost}".`)
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

async function call(path: string, opts: { method: string; email?: string }) {
  const headers: Record<string, string> = {}
  if (opts.email) headers['x-ms-client-principal'] = principalHeader(opts.email)
  const res = await fetch(`${FUNCTIONS_HOST}${path}`, { method: opts.method, headers })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  await prisma.user.deleteMany({ where: { email: { in: ['someone@example.com', 'na-role-check@example.com'] } } })

  let res = await call('/api/getMe', { method: 'GET' })
  assert(res.status === 401, `expected 401 for unauthenticated getMe, got ${res.status}`)
  console.log('  1. Unauthenticated call rejected (401) ok')

  res = await call('/api/getMe', { method: 'GET', email: 'Someone@Example.com' })
  assert(res.status === 200, `expected 200 for an authenticated call, got ${res.status}`)
  const noRoleResult = res.json as { email: string; roles: string[] }
  assert(noRoleResult.email === 'someone@example.com', 'response echoes the lowercased email from x-ms-client-principal')
  assert(Array.isArray(noRoleResult.roles) && noRoleResult.roles.length === 0, 'a caller with no User row yet gets an empty roles array, not an error')
  console.log('  2. Authenticated call with no User row: email + empty roles ok')

  await prisma.user.create({ data: { email: 'na-role-check@example.com', name: 'NA Person', initials: 'NP', roles: ['NetworkAdvisor'] } })
  res = await call('/api/getMe', { method: 'GET', email: 'na-role-check@example.com' })
  assert(res.status === 200, `expected 200, got ${res.status}`)
  const roleResult = res.json as { roles: string[] }
  assert(roleResult.roles.length === 1 && roleResult.roles[0] === 'NetworkAdvisor', `expected the caller's real roles from the User table, got ${JSON.stringify(roleResult.roles)}`)
  console.log('  3. Authenticated call with a real User row returns their real roles ok')

  await prisma.user.deleteMany({ where: { email: { in: ['someone@example.com', 'na-role-check@example.com'] } } })
  console.log('verify-get-me: all checks passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
