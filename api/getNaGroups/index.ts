import type { Context, HttpRequest } from '@azure/functions'
import type { NaGroupDto } from '../../shared/schemas/naComment'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireNetworkAdvisor, resolveViewAs } from '../shared/auth'
import { serverError } from '../shared/errors'

// Network-Advisor-only: a caller's own Launched groups, awaiting their
// comment before moving to Chair review (spec §5). Scoped server-side to
// networkAdvisorEmail === caller — never trust a client-sent identifier for
// this. Deliberately reads only Group's own profile fields, never
// DnaVersion.score — spec §4/§15 says NA sees no scores anywhere here.
//
// An Admin's own "View as" preview (resolveViewAs) is the one exception to
// "Network-Advisor-only" — see getChairGroups' own comment for the full
// reasoning; same read-only, list-endpoints-only scope here.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const { effectiveEmail, isAdminViewingAs } = resolveViewAs(req, principal, caller)
    if (!isAdminViewingAs) {
      const roleFailure = requireNetworkAdvisor(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const groups = await prisma.group.findMany({
      where: { networkAdvisorEmail: effectiveEmail, lifecycleStatus: 'Launched' },
      include: { chair: true },
      orderBy: { name: 'asc' },
    })
    const body: NaGroupDto[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      chairName: g.chair?.name ?? null,
      groupProfile: g.groupProfile,
      memberProfile: g.memberProfile,
      companiesProfile: g.companiesProfile,
    }))

    // The guidance banner's own dismiss action is a write (dismissNaGuidance)
    // that view-as never gets to use — showing it while previewing would be
    // a dead end, so it's suppressed entirely rather than reflecting the
    // Admin's own (irrelevant) hasSeenNaGuidance flag.
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: body, showGuidance: isAdminViewingAs ? false : !caller!.hasSeenNaGuidance }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
