import type { Context, HttpRequest } from '@azure/functions'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireNetworkAdvisor } from '../shared/auth'
import { serverError } from '../shared/errors'

// Marks the caller's first-time guidance banner as seen (spec §5) so it
// doesn't show again on their next visit. Keyed to the caller's own User
// row — never a client-sent identifier.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireNetworkAdvisor(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    await prisma.user.update({ where: { email: principal.email }, data: { hasSeenNaGuidance: true } })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasSeenNaGuidance: true }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
