import type { Context, HttpRequest } from '@azure/functions'
import { SaveGroupRosterRequestSchema, type SaveGroupRosterResponse } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// Admin-only: save (or clear, by sending an empty string) the optional
// roster paste for a group — grounding context for generation (spec §8),
// not part of the group's own imported content, so it's kept separate from
// editGroup and doesn't log an Edit event or affect pendingReapproval. Kept
// server-side (not just in the browser) so it survives a refresh or a
// later visit, per user feedback ("keep the group roster on the group
// detail page if it is added").
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = SaveGroupRosterRequestSchema.safeParse(req.body)
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

    const { groupId, roster } = parsed.data
    const trimmed = roster.trim()

    const group = await prisma.group.findUnique({ where: { id: groupId } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const updated = await prisma.group.update({ where: { id: groupId }, data: { roster: trimmed || null } })

    const body: SaveGroupRosterResponse = { groupId: updated.id, roster: updated.roster }
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
