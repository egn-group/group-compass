import 'dotenv/config'

// Hits a real running Functions host with hand-built x-ms-client-principal
// headers, same local-auth-stub approach as every other verify script —
// proves the parsing/response wiring works without needing a real Entra
// sign-in (issue #13's own acceptance criteria: "no real Entra required").
// The real interactive sign-in flow through Entra is verified separately,
// by hand, against the deployed app.
const FUNCTIONS_HOST = process.env.FUNCTIONS_HOST ?? 'http://localhost:7071'

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
  let res = await call('/api/getMe', { method: 'GET' })
  assert(res.status === 401, `expected 401 for unauthenticated getMe, got ${res.status}`)
  console.log('  1. Unauthenticated call rejected (401) ok')

  res = await call('/api/getMe', { method: 'GET', email: 'Someone@Example.com' })
  assert(res.status === 200, `expected 200 for an authenticated call, got ${res.status}`)
  assert((res.json as { email: string }).email === 'someone@example.com', 'response echoes the lowercased email from x-ms-client-principal')
  console.log('  2. Authenticated call returns the caller\'s own email ok')

  console.log('verify-get-me: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
