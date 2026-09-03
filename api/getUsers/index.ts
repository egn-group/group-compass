import type { Context, HttpRequest } from '@azure/functions'
import type { UserDto } from '../../shared/schemas/user'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { SHORT_PRIVATE_CACHE } from '../shared/cacheHeaders'
import { serverError } from '../shared/errors'

// Admin-only, matching the "Admin-only page to view, add, and edit users"
// this endpoint serves — unlike My Path's getOrgUsers, which is
// authenticated-only because every employee needs the directory. There's no
// equivalent non-admin use for the full user/role list here.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireAdmin(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const users = await prisma.user.findMany({ orderBy: { email: 'asc' } })
    const body: UserDto[] = users.map((u) => ({ email: u.email, name: u.name, initials: u.initials, roles: u.roles }))

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...SHORT_PRIVATE_CACHE },
      body: JSON.stringify(body),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
