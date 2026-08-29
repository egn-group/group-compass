import type { Context, HttpRequest } from '@azure/functions'
import { PutGroupsRequestSchema } from '../../shared/schemas/group'
import { countryForPartnerCode } from '../shared/partnerCodeCountry'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'

const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = PutGroupsRequestSchema.safeParse(req.body)
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

    const created: string[] = []
    const overwritten: string[] = []

    for (const row of parsed.data.rows) {
      const data = {
        egnGroupId: row.egnGroupId,
        name: row.egnGroupName,
        mmsGroupCode: row.mmsGroupCode,
        partnerCode: row.partnerCode,
        country: countryForPartnerCode(row.partnerCode),
        groupProfile: row.groupProfile,
        memberProfile: row.memberProfile,
        companiesProfile: row.companiesProfile,
        noSourceDna: !row.groupProfile.trim() && !row.memberProfile.trim() && !row.companiesProfile.trim(),
        chairEmail: row.chairEmail,
        networkAdvisorEmail: row.networkAdvisorEmail,
      }

      if (row.action.type === 'create') {
        const group = await prisma.group.create({ data })
        await prisma.event.create({ data: { groupId: group.id, type: 'Import', actorEmail: principal.email } })
        created.push(group.id)
      } else {
        const existing = await prisma.group.findUnique({ where: { id: row.action.groupId } })
        if (!existing || existing.egnGroupId !== row.egnGroupId) {
          context.res = errorResponse(400, `Cannot overwrite: group ${row.action.groupId} not found or EGN Group ID mismatch.`)
          return
        }
        const group = await prisma.group.update({ where: { id: row.action.groupId }, data })
        await prisma.event.create({ data: { groupId: group.id, type: 'Import', actorEmail: principal.email } })
        overwritten.push(group.id)
      }
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ created, overwritten }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
