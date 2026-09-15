import type { Context, HttpRequest } from '@azure/functions'
import { DisregardChairCommentRequestSchema, type DisregardChairCommentResponse } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair, resolveActingAs } from '../shared/auth'
import { requireChairReviewable } from '../shared/chairReview/requireReviewable'
import { errorResponse, serverError } from '../shared/errors'

// "Disregard" (prototype parity, HANDOFF.md §1's naDisregard) — marks an NA
// comment resolved with no text change, for when the Chair has considered
// it and decided not to act on it. Distinct from "Read & accept"/an edit
// (which also resolve comments, as a side effect of dealing with the field
// as a whole) — this is the one path that resolves a specific comment
// without touching the field's text at all.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = DisregardChairCommentRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const { effectiveEmail, isAdminActingAs } = resolveActingAs(req, principal, caller)
    if (!isAdminActingAs) {
      const roleFailure = requireChair(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const { groupId, commentId } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: effectiveEmail } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }
    const reviewableFailure = requireChairReviewable(group)
    if (reviewableFailure) {
      context.res = reviewableFailure
      return
    }

    const comment = await prisma.comment.findFirst({ where: { id: commentId, groupId, resolved: false } })
    if (!comment) {
      context.res = errorResponse(404, `Unresolved comment ${commentId} not found.`)
      return
    }

    await prisma.comment.update({ where: { id: commentId }, data: { resolved: true } })

    const body: DisregardChairCommentResponse = { commentId }
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
