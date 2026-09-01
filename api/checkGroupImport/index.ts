import type { Context, HttpRequest } from '@azure/functions'
import { CheckGroupImportRequestSchema, type ImportCheckResult } from '../../shared/schemas/group'
import { DnaContentSchema } from '../../shared/schemas/dna'
import { getPrincipal, getUserByEmail, prisma, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'
import { textEqualsIgnoringWhitespace } from '../shared/textCompare'

// Dry-run preview for the group-import review screen: for each raw row,
// reports whether it's new, an unchanged duplicate (spec §12: "an unchanged
// group is a no-op"), or a genuine change against an existing record with
// the same EGN Group ID (which the admin must then choose to overwrite or
// import as a new record) — plus the resolved Chair/NA email (verified
// against real Users, never auto-created — see the "unmatched" case below),
// for the admin to confirm or change (spec §12).
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = CheckGroupImportRequestSchema.safeParse(req.body)
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

    const { rows } = parsed.data

    const users = await prisma.user.findMany()
    const knownEmails = new Set(users.map((u) => u.email))

    const egnGroupIds = [...new Set(rows.map((r) => r.egnGroupId))]
    const existingGroups = await prisma.group.findMany({
      where: { egnGroupId: { in: egnGroupIds } },
      orderBy: { updatedAt: 'desc' },
    })
    // Multiple records may share an EGN Group ID (spec §12) — the most
    // recently updated one is the comparison candidate for re-import.
    const latestByEgnGroupId = new Map<string, (typeof existingGroups)[number]>()
    for (const g of existingGroups) {
      if (!latestByEgnGroupId.has(g.egnGroupId)) latestByEgnGroupId.set(g.egnGroupId, g)
    }

    // Compare against the Imported-stage DnaVersion (the true, preserved-
    // forever original) when one exists, not against Group's own plain
    // fields — issue #23's Launch action overwrites those with the
    // AI-rewritten text, which would otherwise make every launched group
    // look "changed" on its next routine re-import even when Salesforce's
    // source data never moved. Falls back to Group's fields for a group
    // that's never been through Generate yet, where they're still the
    // untouched original.
    const importedVersions = await prisma.dnaVersion.findMany({
      where: { groupId: { in: existingGroups.map((g) => g.id) }, scoreStage: 'Imported' },
    })
    const importedContentByGroupId = new Map(
      importedVersions.map((v) => [v.groupId, DnaContentSchema.safeParse(v.content)] as const),
    )

    const results: ImportCheckResult[] = rows.map((row) => {
      const existing = latestByEgnGroupId.get(row.egnGroupId) ?? null
      const importedParsed = existing ? importedContentByGroupId.get(existing.id) : undefined
      const baseline =
        importedParsed?.success && existing
          ? importedParsed.data
          : existing
            ? { groupProfile: existing.groupProfile, memberProfile: existing.memberProfile, companiesProfile: existing.companiesProfile }
            : null

      const status = !baseline
        ? 'new'
        : textEqualsIgnoringWhitespace(baseline.groupProfile, row.groupProfile) &&
            textEqualsIgnoringWhitespace(baseline.memberProfile, row.memberProfile) &&
            textEqualsIgnoringWhitespace(baseline.companiesProfile, row.companiesProfile)
          ? 'unchanged'
          : 'changed'

      const chairEmail = row.responsibleChairEmail.trim().toLowerCase()
      const naEmail = row.responsibleSalesEmail.trim().toLowerCase()
      return {
        row,
        status,
        existingGroupId: existing?.id ?? null,
        // Email is the definitive match now (not a fuzzy name guess) — but
        // it must already be a real User; an email nobody's created yet
        // surfaces as unmatched, same as before, rather than being trusted
        // blindly or auto-creating someone.
        suggestedChairEmail: knownEmails.has(chairEmail) ? chairEmail : null,
        suggestedNetworkAdvisorEmail: knownEmails.has(naEmail) ? naEmail : null,
      }
    })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
