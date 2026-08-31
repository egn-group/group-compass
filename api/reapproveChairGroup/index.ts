import type { Context, HttpRequest } from '@azure/functions'
import { ReapproveChairGroupRequestSchema, type ReapproveChairGroupResponse } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// The persistent "Approve whole DNA" control (spec §11) a Chair sees after
// editing any field on an already-Approved group. One click, no blocking
// modal (a bug already found and fixed once in the prototype) — just
// clears pendingReapproval and logs a fresh Approve event.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ReapproveChairGroupRequestSchema.safeParse(req.body)
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

    const { groupId } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: principal.email } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }
    if (group.lifecycleStatus !== 'Approved' || !group.pendingReapproval) {
      context.res = errorResponse(400, 'Group has no pending re-approval.')
      return
    }

    await prisma.$transaction([
      prisma.group.update({ where: { id: groupId }, data: { pendingReapproval: false } }),
      prisma.event.create({ data: { groupId, type: 'Approve', actorEmail: principal.email } }),
    ])

    const body: ReapproveChairGroupResponse = { groupId, pendingReapproval: false }
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
