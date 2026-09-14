import type { Context, HttpRequest } from '@azure/functions'
import { ImportedSnapshotSchema, ResetGroupRequestSchema, type ResetGroupResponse } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'
import { countryForPartnerCode } from '../shared/partnerCodeCountry'

// Admin-only: discard edits made since import and restore the same fields
// Edit can change (name/mmsGroupCode/partnerCode/the 3 profile texts) back
// to Group.importedSnapshot — whatever the group's most recent import/
// re-import actually said. Chair/NA assignment is untouched, same scope as
// Edit itself.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ResetGroupRequestSchema.safeParse(req.body)
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

    if (group.importedSnapshot === null) {
      context.res = errorResponse(
        409,
        'This group has no import snapshot to reset to — it was imported before this feature existed. Re-import it to create one.',
      )
      return
    }

    const snapshotParsed = ImportedSnapshotSchema.safeParse(group.importedSnapshot)
    if (!snapshotParsed.success) {
      context.res = errorResponse(500, 'This group’s import snapshot is corrupt and cannot be restored.')
      return
    }
    const snapshot = snapshotParsed.data

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: {
        name: snapshot.egnGroupName,
        mmsGroupCode: snapshot.mmsGroupCode,
        partnerCode: snapshot.partnerCode,
        country: countryForPartnerCode(snapshot.partnerCode),
        groupProfile: snapshot.groupProfile,
        memberProfile: snapshot.memberProfile,
        companiesProfile: snapshot.companiesProfile,
        // Same signal Edit itself uses — restoring to the imported text
        // after approval still warrants a fresh look, not a silent change
        // to an already-signed-off record.
        ...(group.lifecycleStatus === 'Approved' ? { pendingReapproval: true } : {}),
      },
    })
    await prisma.event.create({ data: { groupId, type: 'Reset', actorEmail: principal.email } })

    const body: ResetGroupResponse = {
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
