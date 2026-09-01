import type { Context, HttpRequest } from '@azure/functions'
import { getPrincipal, requireAuth } from '../shared/auth'
import { serverError } from '../shared/errors'

// Proves the authenticated-caller identity flow end-to-end (issue #13):
// no role check, no DB lookup — just the email SWA already decoded from
// the real Entra ID token into x-ms-client-principal. Any authenticated
// user may call this; it exposes nothing beyond their own identity.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: principal.email }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
