import type { Context, HttpRequest } from '@azure/functions'
import { ChairProposalActionRequestSchema, type AcceptChairProposalResponse } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { saveChairFieldEdit } from '../shared/chairReview/saveField'
import { errorResponse, serverError } from '../shared/errors'

// "Accepted proposals save as Chair edits" (issue #26) — this is the same
// saveChairFieldEdit path editChairField uses, just sourced from the AI's
// proposedText instead of a freeform Chair-typed one. No separate
// edit-feedback round here — that guardrail (spec §11) is specifically for
// the Chair's own manual rewrite, not an assistant proposal the Chair
// already reviewed and chose to accept.
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
    const turn = await prisma.aiConversationTurn.findFirst({
      where: { id: turnId, group: { chairEmail: principal.email } },
      include: { group: true },
    })
    if (!turn) {
      context.res = errorResponse(404, `Proposal ${turnId} not found.`)
      return
    }
    if (turn.role !== 'Ai' || turn.proposedText === null || turn.outcome !== 'None') {
      context.res = errorResponse(400, 'This is not a pending proposal.')
      return
    }

    const saved = await saveChairFieldEdit(turn.group, turn.field, turn.proposedText, principal.email)
    if (!saved.ok) {
      context.res = errorResponse(500, saved.reason === 'no-dna-version' ? 'Group has no DNA version to edit.' : 'The latest DNA version has malformed content.')
      return
    }
    await prisma.aiConversationTurn.update({ where: { id: turnId }, data: { outcome: 'Accepted' } })

    const body: AcceptChairProposalResponse = { field: turn.field, dnaVersionId: saved.dnaVersionId }
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
