import type { Context, HttpRequest } from '@azure/functions'
import { ApproveChairFieldRequestSchema, type ApproveChairFieldResponse } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// "Read & accept" (spec §11) — approve a field as-is, no text change.
// Resolves any pending NA comment on that field as a side effect (the
// Chair has now dealt with it, whether or not they acted on it). Approving
// the 3rd and final field moves the whole group to Approved.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ApproveChairFieldRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
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

    const { groupId, field } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: principal.email } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const approvedFields = group.approvedFields.includes(field) ? group.approvedFields : [...group.approvedFields, field]
    const justFullyApproved = approvedFields.length === 3 && group.lifecycleStatus !== 'Approved'

    await prisma.$transaction([
      prisma.group.update({
        where: { id: groupId },
        data: {
          approvedFields,
          ...(justFullyApproved ? { lifecycleStatus: 'Approved', pendingReapproval: false } : {}),
        },
      }),
      prisma.comment.updateMany({ where: { groupId, field, resolved: false }, data: { resolved: true } }),
      ...(justFullyApproved ? [prisma.event.create({ data: { groupId, type: 'Approve', actorEmail: principal.email } })] : []),
    ])

    const body: ApproveChairFieldResponse = {
      field,
      lifecycleStatus: justFullyApproved ? 'Approved' : group.lifecycleStatus,
      justFullyApproved,
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
