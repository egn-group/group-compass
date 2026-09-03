import type { Context, HttpRequest } from '@azure/functions'
import type { GetMeResponse } from '../../shared/schemas/me'
import { getPrincipal, getUserByEmail, requireAuth } from '../shared/auth'
import { serverError } from '../shared/errors'

// Proves the authenticated-caller identity flow end-to-end (issue #13):
// no role check on this endpoint itself — any authenticated user may call
// it, and it exposes only their own identity. Roles come from our own
// User table (empty if the caller has signed in but hasn't been
// bootstrapped yet — a real, expected state the frontend uses to decide
// what to show, not an error).
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const body: GetMeResponse = { email: principal.email, name: caller?.name ?? null, initials: caller?.initials ?? null, roles: caller?.roles ?? [] }
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
