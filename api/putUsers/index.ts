import type { Context, HttpRequest } from '@azure/functions'
import { UpsertUserSchema, type UserDto } from '../../shared/schemas/user'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth, serverError } from '../shared/auth'

function trustedBootstrapEmails(): string[] {
  return (process.env.INITIAL_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = UpsertUserSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = { status: 400, body: JSON.stringify({ error: 'Invalid request body.', details: parsed.error.flatten() }) }
    return
  }
  const input = parsed.data
  const targetEmail = input.email.toLowerCase()

  try {
    const principal = getPrincipal(req)!
    const userCount = await prisma.user.count()

    if (userCount === 0) {
      // Bootstrap: no User rows exist yet, so there's no role data to check
      // the caller against. Gate on *who's calling* instead — only a
      // server-configured trusted email may perform this first write, and
      // it can only create an account for a trusted email, never grant a
      // role to an arbitrary address (mirrors My Path's putOrgUsers
      // INITIAL_ADMIN_EMAILS bootstrap).
      const trusted = trustedBootstrapEmails()
      if (trusted.length === 0) {
        context.res = { status: 500, body: JSON.stringify({ error: 'INITIAL_ADMIN_EMAILS not set — cannot bootstrap users.' }) }
        return
      }
      if (!trusted.includes(principal.email)) {
        context.res = { status: 403, body: JSON.stringify({ error: 'Initial setup must be performed by a server-configured admin account.' }) }
        return
      }
      if (!trusted.includes(targetEmail)) {
        context.res = { status: 403, body: JSON.stringify({ error: 'Initial setup may only create a server-configured admin account.' }) }
        return
      }
    } else {
      const caller = await getUserByEmail(principal.email)
      const roleFailure = requireAdmin(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const user = await prisma.user.upsert({
      where: { email: targetEmail },
      create: { email: targetEmail, name: input.name, initials: input.initials, roles: input.roles },
      update: { name: input.name, initials: input.initials, roles: input.roles },
    })

    const body: UserDto = { email: user.email, name: user.name, initials: user.initials, roles: user.roles }
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
