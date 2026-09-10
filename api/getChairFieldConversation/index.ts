import type { Context, HttpRequest } from '@azure/functions'
import { GetChairFieldConversationRequestSchema, type ConversationTurnDto } from '../../shared/schemas/chairReview'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// A Chair's own live chat for one field — never another Chair's, and
// never exposed as a generic Admin transcript-browsing feature here (that's
// a separate, not-yet-designed feature per HANDOFF.md's open decisions,
// out of scope for this ticket). Ownership re-checked via the group, not
// just trusting a client-sent groupId.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = GetChairFieldConversationRequestSchema.safeParse(req.query)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid query.', parsed.error.flatten())
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

    const turns = await prisma.aiConversationTurn.findMany({ where: { groupId, field }, orderBy: { createdAt: 'asc' } })
    const body: ConversationTurnDto[] = turns.map((t) => ({
      id: t.id,
      role: t.role,
      messageText: t.messageText,
      proposedText: t.proposedText,
      outcome: t.outcome,
      createdAt: t.createdAt.toISOString(),
    }))

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turns: body }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
