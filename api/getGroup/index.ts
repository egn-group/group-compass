import type { Context, HttpRequest } from '@azure/functions'
import { DnaContentSchema } from '../../shared/schemas/dna'
import { GetGroupRequestSchema, type GroupDetail } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { SHORT_PRIVATE_CACHE } from '../shared/cacheHeaders'
import { errorResponse, serverError } from '../shared/errors'

// Admin-only detail view backing the Groups tab's Generate/Score/Launch
// UI (issue #47) — the latest DnaVersion's own content is returned (not
// just Group's live fields) so an unlaunched AI draft is visible before
// Launch overwrites Group's fields with it.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = GetGroupRequestSchema.safeParse(req.query)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid query.', parsed.error.flatten())
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

    const latest = await prisma.dnaVersion.findFirst({ where: { groupId }, orderBy: { versionNumber: 'desc' } })
    const latestContent = latest ? DnaContentSchema.safeParse(latest.content) : null

    const body: GroupDetail = {
      id: group.id,
      egnGroupId: group.egnGroupId,
      mmsGroupCode: group.mmsGroupCode,
      name: group.name,
      country: group.country,
      chairEmail: group.chairEmail,
      networkAdvisorEmail: group.networkAdvisorEmail,
      lifecycleStatus: group.lifecycleStatus,
      groupProfile: group.groupProfile,
      memberProfile: group.memberProfile,
      companiesProfile: group.companiesProfile,
      latestDnaVersion:
        latest && latestContent?.success
          ? {
              id: latest.id,
              versionNumber: latest.versionNumber,
              author: latest.author,
              score: latest.score,
              scoreStage: latest.scoreStage,
              createdAt: latest.createdAt.toISOString(),
              content: latestContent.data,
            }
          : null,
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...SHORT_PRIVATE_CACHE },
      body: JSON.stringify(body),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
