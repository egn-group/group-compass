import type { Context, HttpRequest } from '@azure/functions'
import { DeleteGroupRequestSchema, type DeleteGroupResponse } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// Admin-only: remove a group record outright — for a mis-imported or
// duplicate row, not a way to retire a real one (spec §12 already has a
// deliberate "Closed" status for that). Refuses whenever the group has any
// DNA versions, comments, review events (excluding the Import event
// putGroups itself writes — that documents how the record came to exist,
// not activity performed on it since), or AI conversation history —
// checked directly rather than relying on the database's own foreign-key
// behavior, so the reason is always a clear message instead of a raw
// constraint error. In practice this means delete only works on a group
// nobody has touched since import.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = DeleteGroupRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireAdmin(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const { groupId } = parsed.data

    const group = await prisma.group.findUnique({ where: { id: groupId } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const [dnaVersionCount, commentCount, eventCount, turnCount] = await Promise.all([
      prisma.dnaVersion.count({ where: { groupId } }),
      prisma.comment.count({ where: { groupId } }),
      prisma.event.count({ where: { groupId, type: { not: 'Import' } } }),
      prisma.aiConversationTurn.count({ where: { groupId } }),
    ])
    if (dnaVersionCount + commentCount + eventCount + turnCount > 0) {
      context.res = errorResponse(
        409,
        'Cannot delete this group — it already has DNA versions, comments, or activity history. Delete only works for a freshly imported group with none yet.',
      )
      return
    }

    // The guard above only ever leaves Import events behind (every other
    // count is exactly 0), but those still hold a foreign key to this
    // group — Event.group has no onDelete: Cascade, so a bare group.delete
    // would fail on that constraint. Clearing them first is safe precisely
    // because the guard already confirmed there's nothing else on the group.
    await prisma.$transaction([prisma.event.deleteMany({ where: { groupId } }), prisma.group.delete({ where: { id: groupId } })])

    const body: DeleteGroupResponse = { groupId }
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
