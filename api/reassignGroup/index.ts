import type { Context, HttpRequest } from '@azure/functions'
import { ReassignGroupRequestSchema, type ReassignGroupResponse } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

// Admin-only: change which Chair/Network Advisor a group is assigned to,
// directly — the only other way to do this today is re-importing the same
// EGN Group ID via the CSV/manual-add "overwrite" flow, which also
// overwrites the group's profile text just to change an assignment.
// Deliberately no notification here — the wayfinder map (issue #1) settled
// that reassignment has no dedicated notification of its own; an Admin who
// wants to notify the new Chair/NA relaunches the group afterward, reusing
// the existing relaunch notification.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ReassignGroupRequestSchema.safeParse(req.body)
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

    const { groupId, chairEmail, networkAdvisorEmail } = parsed.data

    const group = await prisma.group.findUnique({ where: { id: groupId } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    // Existence + role are re-checked server-side rather than trusting the
    // client to only ever offer real Chairs/NAs in its picker — same
    // reasoning as every other write endpoint here never trusting the
    // client for anything identity-shaped.
    if (chairEmail) {
      const chair = await getUserByEmail(chairEmail)
      if (!chair?.roles.includes('Chair')) {
        context.res = errorResponse(400, `${chairEmail} is not a User with the Chair role.`)
        return
      }
    }
    if (networkAdvisorEmail) {
      const advisor = await getUserByEmail(networkAdvisorEmail)
      if (!advisor?.roles.includes('NetworkAdvisor')) {
        context.res = errorResponse(400, `${networkAdvisorEmail} is not a User with the NetworkAdvisor role.`)
        return
      }
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { chairEmail: chairEmail?.toLowerCase() ?? null, networkAdvisorEmail: networkAdvisorEmail?.toLowerCase() ?? null },
    })
    await prisma.event.create({ data: { groupId, type: 'Reassign', actorEmail: principal.email } })

    const body: ReassignGroupResponse = { groupId: updated.id, chairEmail: updated.chairEmail, networkAdvisorEmail: updated.networkAdvisorEmail }
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
