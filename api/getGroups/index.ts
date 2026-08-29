import type { Context, HttpRequest } from '@azure/functions'
import type { GroupDto } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { serverError } from '../shared/errors'

function emptySectionCount(g: { groupProfile: string; memberProfile: string; companiesProfile: string }): number {
  return [g.groupProfile, g.memberProfile, g.companiesProfile].filter((s) => !s.trim()).length
}

// Admin-only, matching the Admin-only import screen this endpoint serves.
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

    const groups = await prisma.group.findMany({ orderBy: { createdAt: 'desc' } })
    const body: GroupDto[] = groups.map((g) => ({
      id: g.id,
      egnGroupId: g.egnGroupId,
      name: g.name,
      mmsGroupCode: g.mmsGroupCode,
      partnerCode: g.partnerCode,
      country: g.country,
      chairEmail: g.chairEmail,
      networkAdvisorEmail: g.networkAdvisorEmail,
      lifecycleStatus: g.lifecycleStatus,
      noSourceDna: g.noSourceDna,
      emptySectionCount: emptySectionCount(g),
    }))

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
