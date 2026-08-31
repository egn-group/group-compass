import type { Context, HttpRequest } from '@azure/functions'
import { DnaContentSchema, LaunchGroupRequestSchema } from '../../shared/schemas/dna'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// Launch and Relaunch (spec §10: relaunching "resets the group's status
// to Launched", "the same as a first launch") are one action here, not
// two: push the group's latest AI-authored draft live. The precondition
// is "does a not-yet-launched draft exist" — exactly what "the latest
// DnaVersion's author is Ai" means. Regenerate (issue #22) always creates
// a fresh Ai-authored version on top regardless of the group's current
// status, and a Chair edit's version has author Chair — so this one check
// correctly covers both a group's very first launch (status Imported/
// DraftGenerated) and a later relaunch after regenerating an
// already-Approved/ChairReview group, with no need to separately track
// which prior statuses are "valid" to launch from.
//
// The draft's content is already split into the 3 profile fields (issue
// #22's commitDnaGeneration did that when the version was created) — no
// re-parsing needed here, unlike the prototype's /api/launch, which split
// a single text blob at launch time because it had no versioned storage.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = LaunchGroupRequestSchema.safeParse(req.body)
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
    if (group.lifecycleStatus === 'Closed') {
      context.res = errorResponse(400, 'Cannot launch a closed group.')
      return
    }

    const latest = await prisma.dnaVersion.findFirst({ where: { groupId }, orderBy: { versionNumber: 'desc' } })
    if (!latest || latest.author !== 'Ai') {
      context.res = errorResponse(400, 'No pending AI draft to launch — generate or regenerate first.')
      return
    }

    const content = DnaContentSchema.safeParse(latest.content)
    if (!content.success) {
      context.res = errorResponse(500, 'The latest DNA version has malformed content.')
      return
    }

    await prisma.group.update({
      where: { id: groupId },
      data: {
        groupProfile: content.data.groupProfile,
        memberProfile: content.data.memberProfile,
        companiesProfile: content.data.companiesProfile,
        lifecycleStatus: 'Launched',
        // A relaunch supersedes whatever re-approval was pending from
        // before this new review cycle starts.
        pendingReapproval: false,
      },
    })
    await prisma.event.create({ data: { groupId, type: 'Launch', actorEmail: principal.email } })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, lifecycleStatus: 'Launched', launchedVersionNumber: latest.versionNumber }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
