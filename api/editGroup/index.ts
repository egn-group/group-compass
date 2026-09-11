import type { Context, HttpRequest } from '@azure/functions'
import { EditGroupRequestSchema, type EditGroupResponse } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'
import { countryForPartnerCode } from '../shared/partnerCodeCountry'

// Admin-only: correct a group's own imported metadata/profile text directly
// — e.g. fixing a Salesforce data-entry mistake — without re-running a full
// CSV re-import just to change these fields. Chair/NA assignment has its
// own dedicated Reassign action; this is deliberately just the raw content.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = EditGroupRequestSchema.safeParse(req.body)
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

    const { groupId, egnGroupName, mmsGroupCode, partnerCode, groupProfile, memberProfile, companiesProfile } = parsed.data

    const group = await prisma.group.findUnique({ where: { id: groupId } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: {
        name: egnGroupName,
        mmsGroupCode,
        partnerCode,
        country: countryForPartnerCode(partnerCode),
        groupProfile,
        memberProfile,
        companiesProfile,
        // Same signal a Chair's own field edit uses (shared/chairReview/saveField.ts):
        // correcting the source data after approval warrants a fresh look,
        // not a silent change to an already-signed-off record.
        ...(group.lifecycleStatus === 'Approved' ? { pendingReapproval: true } : {}),
      },
    })
    await prisma.event.create({ data: { groupId, type: 'Edit', actorEmail: principal.email } })

    const body: EditGroupResponse = {
      groupId: updated.id,
      name: updated.name,
      mmsGroupCode: updated.mmsGroupCode,
      partnerCode: updated.partnerCode,
      country: updated.country,
      groupProfile: updated.groupProfile,
      memberProfile: updated.memberProfile,
      companiesProfile: updated.companiesProfile,
      pendingReapproval: updated.pendingReapproval,
    }
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
