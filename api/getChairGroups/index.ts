import type { Context, HttpRequest } from '@azure/functions'
import type { ChairGroupListItem } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { serverError } from '../shared/errors'

// Chair-only: a caller's own groups (scoped server-side to chairEmail ===
// caller, never a client-sent identifier) across the statuses a Chair has
// any reason to look at — Launched (still waiting on the NA), ChairReview
// (needs the Chair), and Approved. Imported/DraftGenerated groups haven't
// reached the Chair yet; Closed ones are archived. No score data anywhere
// — spec §4/§15 says the Chair never sees scores, and this DTO never
// touches DnaVersion at all.
//
// Chair Leader is intentionally NOT included here (unlike this ticket's
// literal text) — the wayfinder map (issue #1) defers Chair Leader
// entirely from this pilot ("no screens or flows built for them"), so a
// Chair-Leader-wide view across other Chairs' groups is out of scope until
// that's revisited.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireChair(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const groups = await prisma.group.findMany({
      where: { chairEmail: principal.email, lifecycleStatus: { in: ['Launched', 'ChairReview', 'Approved'] } },
      include: { networkAdvisor: true },
      orderBy: { updatedAt: 'desc' },
    })
    const body: ChairGroupListItem[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      country: g.country,
      networkAdvisorName: g.networkAdvisor?.name ?? null,
      lifecycleStatus: g.lifecycleStatus,
      pendingReapproval: g.pendingReapproval,
      updatedAt: g.updatedAt.toISOString(),
    }))

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: body }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
