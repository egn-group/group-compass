import type { Group } from '@prisma/client'
import { DnaContentSchema, type DnaFieldValue } from '../../../shared/schemas/dna'
import { prisma } from '../auth'
import { DNA_FIELD_KEY } from '../dna/fieldKeys'

export type SaveChairFieldEditOutcome =
  | { ok: true; dnaVersionId: string }
  | { ok: false; reason: 'no-dna-version' | 'malformed-content' }

// Shared by editChairField (a Chair's own manual rewrite) and
// acceptChairProposal (accepting the AI assistant's proposed text, issue
// #26) — "accepted proposals save as Chair edits" means literally the same
// save path, not a parallel one that could drift from it. Versions a new
// DnaVersion snapshot, updates the group's live text, resolves any pending
// NA comment on that field, sets pendingReapproval if the group was
// already Approved, and logs an Edit event.
export async function saveChairFieldEdit(
  group: Group,
  field: DnaFieldValue,
  text: string,
  actorEmail: string,
): Promise<SaveChairFieldEditOutcome> {
  const latest = await prisma.dnaVersion.findFirst({ where: { groupId: group.id }, orderBy: { versionNumber: 'desc' } })
  if (!latest) return { ok: false, reason: 'no-dna-version' }
  const latestContent = DnaContentSchema.safeParse(latest.content)
  if (!latestContent.success) return { ok: false, reason: 'malformed-content' }

  const fieldKey = DNA_FIELD_KEY[field]
  const newContent = { ...latestContent.data, [fieldKey]: text }

  const [newVersion] = await prisma.$transaction([
    prisma.dnaVersion.create({
      data: { groupId: group.id, versionNumber: latest.versionNumber + 1, content: newContent, author: 'Chair', scoreStage: 'ChairEdited' },
    }),
    prisma.group.update({
      where: { id: group.id },
      data: { [fieldKey]: text, ...(group.lifecycleStatus === 'Approved' ? { pendingReapproval: true } : {}) },
    }),
    prisma.comment.updateMany({ where: { groupId: group.id, field, resolved: false }, data: { resolved: true } }),
    prisma.event.create({ data: { groupId: group.id, type: 'Edit', actorEmail } }),
  ])

  return { ok: true, dnaVersionId: newVersion.id }
}
