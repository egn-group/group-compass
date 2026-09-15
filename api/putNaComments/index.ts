import type { Context, HttpRequest } from '@azure/functions'
import { PutNaCommentsRequestSchema } from '../../shared/schemas/naComment'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireNetworkAdvisor, resolveActingAs } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// "Send to Chair" (spec §5): write the NA's per-field comments against the
// group's current DNA version, then move the group to ChairReview. Looking
// the group up scoped to networkAdvisorEmail === caller (not just by id) is
// the actual authorization check here — a client-sent groupId alone proves
// nothing about who it belongs to.
//
// At most one NA comment can exist per (group, field) at any time: a group
// can cycle Launched -> ChairReview -> Launched again across multiple review
// rounds, and without this, each round's comment would just pile up behind
// the last one instead of replacing it (the actual bug this guards
// against — a field showing several stale NA comments at once). So any
// existing NA comment for a field being submitted here is deleted first,
// in the same transaction, before the new one is created.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = PutNaCommentsRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const { effectiveEmail, isAdminActingAs } = resolveActingAs(req, principal, caller)
    if (!isAdminActingAs) {
      const roleFailure = requireNetworkAdvisor(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const { groupId, comments } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, networkAdvisorEmail: effectiveEmail } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }
    if (group.lifecycleStatus !== 'Launched') {
      context.res = errorResponse(400, 'Group is not awaiting a Network Advisor comment.')
      return
    }

    const dnaVersion = await prisma.dnaVersion.findFirst({ where: { groupId }, orderBy: { versionNumber: 'desc' } })
    if (!dnaVersion) {
      context.res = errorResponse(500, 'Group has no DNA version to comment on.')
      return
    }

    const fields = comments.map((c) => c.field)

    await prisma.$transaction([
      prisma.comment.deleteMany({ where: { groupId, author: 'NetworkAdvisor', field: { in: fields } } }),
      ...comments.map((c) =>
        prisma.comment.create({
          data: { groupId, dnaVersionId: dnaVersion.id, field: c.field, author: 'NetworkAdvisor', text: c.text },
        }),
      ),
      prisma.group.update({ where: { id: groupId }, data: { lifecycleStatus: 'ChairReview' } }),
      prisma.event.create({ data: { groupId, type: 'Comment', actorEmail: effectiveEmail } }),
    ])

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, lifecycleStatus: 'ChairReview' }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
