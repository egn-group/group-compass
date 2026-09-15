import type { Context, HttpRequest } from '@azure/functions'
import { DnaContentSchema } from '../../shared/schemas/dna'
import type { GroupDto } from '../../shared/schemas/group'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { serverError } from '../shared/errors'

function emptySectionCount(g: { groupProfile: string; memberProfile: string; companiesProfile: string }): number {
  return [g.groupProfile, g.memberProfile, g.companiesProfile].filter((s) => !s.trim()).length
}

// An Ai-authored latest version only counts as a PENDING draft — one Launch
// would actually change something — if its content still differs from the
// group's live text. Launch (api/launchGroup) copies the version's content
// onto the group's live fields but never creates a new DnaVersion, so right
// after a launch this same version is still the latest AND still
// Ai-authored; without this check the Launch button would never disable
// itself once clicked. Regenerate (issue #22) always lays down a fresh
// Ai-authored version without touching the live fields, so it correctly
// re-enables Launch by making the content differ again.
function isUnlaunchedAiDraft(
  latest: { author: string | null; content: unknown } | null,
  g: { groupProfile: string; memberProfile: string; companiesProfile: string },
): boolean {
  if (!latest || latest.author !== 'Ai') return false
  const content = DnaContentSchema.safeParse(latest.content)
  if (!content.success) return false
  return content.data.groupProfile !== g.groupProfile || content.data.memberProfile !== g.memberProfile || content.data.companiesProfile !== g.companiesProfile
}

// Admin-only, matching the Admin-only import screen this endpoint serves.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
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

    const groups = await prisma.group.findMany({ orderBy: { createdAt: 'desc' } })

    // One query for every group's DnaVersions, reduced in-process to the
    // latest per group — cheaper than an N+1 findFirst per group, and
    // simple at pilot scale.
    const dnaVersions = await prisma.dnaVersion.findMany({
      where: { groupId: { in: groups.map((g) => g.id) } },
      orderBy: { versionNumber: 'desc' },
    })
    const latestByGroupId = new Map<string, (typeof dnaVersions)[number]>()
    for (const v of dnaVersions) {
      if (!latestByGroupId.has(v.groupId)) latestByGroupId.set(v.groupId, v)
    }

    const body: GroupDto[] = groups.map((g) => {
      const latest = latestByGroupId.get(g.id) ?? null
      return {
        id: g.id,
        egnGroupId: g.egnGroupId,
        name: g.name,
        mmsGroupCode: g.mmsGroupCode,
        partnerCode: g.partnerCode,
        country: g.country,
        chairEmail: g.chairEmail,
        networkAdvisorEmail: g.networkAdvisorEmail,
        lifecycleStatus: g.lifecycleStatus,
        noSourceDna: g.noSourceDna,
        emptySectionCount: emptySectionCount(g),
        updatedAt: g.updatedAt.toISOString(),
        latestDnaVersionId: latest?.id ?? null,
        latestDnaVersionScore: latest?.score ?? null,
        hasPendingAiDraft: isUnlaunchedAiDraft(latest, g),
      }
    })

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
