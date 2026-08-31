import type { Context, HttpRequest } from '@azure/functions'
import { ChairProposalActionRequestSchema } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ChairProposalActionRequestSchema.safeParse(req.body)
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

    const { turnId } = parsed.data
    const turn = await prisma.aiConversationTurn.findFirst({ where: { id: turnId, group: { chairEmail: principal.email } } })
    if (!turn) {
      context.res = errorResponse(404, `Proposal ${turnId} not found.`)
      return
    }
    if (turn.role !== 'Ai' || turn.proposedText === null || turn.outcome !== 'None') {
      context.res = errorResponse(400, 'This is not a pending proposal.')
      return
    }

    await prisma.aiConversationTurn.update({ where: { id: turnId }, data: { outcome: 'Rejected' } })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId, outcome: 'Rejected' }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
