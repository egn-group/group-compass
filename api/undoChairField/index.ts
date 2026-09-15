import type { Context, HttpRequest } from '@azure/functions'
import { UndoChairFieldRequestSchema, type UndoChairFieldResponse } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair, resolveActingAs } from '../shared/auth'
import { requireChairReviewable } from '../shared/chairReview/requireReviewable'
import { undoChairFieldEdit } from '../shared/chairReview/saveField'
import { errorResponse, serverError } from '../shared/errors'

// "Undo last change" (prototype parity, HANDOFF.md §1's undoField) —
// single-level, per field. See saveField.ts's undoChairFieldEdit for why
// this never sets pendingReapproval, unlike a normal edit.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = UndoChairFieldRequestSchema.safeParse(req.body)
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

    const { groupId, field } = parsed.data
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

    const undone = await undoChairFieldEdit(group, field, effectiveEmail)
    if (!undone.ok) {
      if (undone.reason === 'nothing-to-undo') {
        context.res = errorResponse(400, 'Nothing to undo for this field.')
        return
      }
      context.res = errorResponse(500, undone.reason === 'no-dna-version' ? 'Group has no DNA version to edit.' : 'The latest DNA version has malformed content.')
      return
    }

    const body: UndoChairFieldResponse = { field, text: undone.text, dnaVersionId: undone.dnaVersionId }
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
