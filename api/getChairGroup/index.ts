import type { Context, HttpRequest } from '@azure/functions'
import { GetChairGroupRequestSchema, type ChairGroupDetail } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair, resolveViewAs } from '../shared/auth'
import { ALL_DNA_FIELDS, DNA_FIELD_KEY } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

// Chair-only: the full review view for one of the caller's own groups.
// Ownership is re-checked here too (findFirst scoped to chairEmail ===
// caller) — a client-sent groupId alone proves nothing. An Admin's own
// "View as" preview (resolveViewAs) is the one exception — see
// getChairGroups' comment for the full reasoning.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = GetChairGroupRequestSchema.safeParse(req.query)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid query.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const { effectiveEmail, isAdminViewingAs } = resolveViewAs(req, principal, caller)
    if (!isAdminViewingAs) {
      const roleFailure = requireChair(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const { groupId } = parsed.data
    const group = await prisma.group.findFirst({
      where: { id: groupId, chairEmail: effectiveEmail },
      include: { networkAdvisor: true, comments: { where: { resolved: false } } },
    })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const body: ChairGroupDetail = {
      id: group.id,
      name: group.name,
      country: group.country,
      networkAdvisorName: group.networkAdvisor?.name ?? null,
      lifecycleStatus: group.lifecycleStatus,
      pendingReapproval: group.pendingReapproval,
      fields: ALL_DNA_FIELDS.map((field) => ({
        field,
        text: group[DNA_FIELD_KEY[field]],
        approved: group.approvedFields.includes(field),
        unresolvedComments: group.comments
          .filter((c) => c.field === field)
          .map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt.toISOString() })),
      })),
    }

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
