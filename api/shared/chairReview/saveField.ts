import type { Group } from '../prismaClient'
import { DnaContentSchema, type DnaFieldValue } from '../../../shared/schemas/dna'
import { prisma } from '../auth'
import { DNA_FIELD_KEY } from '../dna/fieldKeys'

export type SaveChairFieldEditOutcome =
  | { ok: true; dnaVersionId: string }
  | { ok: false; reason: 'no-dna-version' | 'malformed-content' }

// Group.pendingUndo's shape: a partial map of field -> its text immediately
// before the most recent change, one level deep (see the schema comment).
export type PendingUndoMap = Partial<Record<DnaFieldValue, string>>

export function readPendingUndo(group: Pick<Group, 'pendingUndo'>): PendingUndoMap {
  const raw = group.pendingUndo
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PendingUndoMap) : {}
}

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
  const oldText = latestContent.data[fieldKey]
  const newContent = { ...latestContent.data, [fieldKey]: text }
  // This change becomes the one available Undo for the field — overwrites
  // (not accumulates) any earlier pending-undo entry for it, since only one
  // level is ever kept (prototype parity — see the schema comment).
  const newPendingUndo: PendingUndoMap = { ...readPendingUndo(group), [field]: oldText }

  const [newVersion] = await prisma.$transaction([
    prisma.dnaVersion.create({
      data: { groupId: group.id, versionNumber: latest.versionNumber + 1, content: newContent, author: 'Chair', scoreStage: 'ChairEdited' },
    }),
    prisma.group.update({
      where: { id: group.id },
      data: {
        [fieldKey]: text,
        pendingUndo: newPendingUndo,
        ...(group.lifecycleStatus === 'Approved' ? { pendingReapproval: true } : {}),
      },
    }),
    prisma.comment.updateMany({ where: { groupId: group.id, field, resolved: false }, data: { resolved: true } }),
    prisma.event.create({ data: { groupId: group.id, type: 'Edit', actorEmail } }),
  ])

  return { ok: true, dnaVersionId: newVersion.id }
}

export type UndoChairFieldOutcome =
  | { ok: true; dnaVersionId: string; text: string }
  | { ok: false; reason: 'no-dna-version' | 'malformed-content' | 'nothing-to-undo' }

// Reverts a field to whatever it was right before its last change (Include,
// an accepted AI proposal, or a manual Save) — prototype parity,
// HANDOFF.md §1's undoField. Deliberately does NOT set pendingReapproval,
// even on an Approved group: the prototype's undoField never calls
// markGroupReEdited either, since reverting to the last-approved text isn't
// a new edit needing a fresh look. Consumes (clears) the pending-undo entry
// for this field, so a second click has nothing left to revert to.
export async function undoChairFieldEdit(group: Group, field: DnaFieldValue, actorEmail: string): Promise<UndoChairFieldOutcome> {
  const pendingUndo = readPendingUndo(group)
  const previousText = pendingUndo[field]
  if (previousText === undefined) return { ok: false, reason: 'nothing-to-undo' }

  const latest = await prisma.dnaVersion.findFirst({ where: { groupId: group.id }, orderBy: { versionNumber: 'desc' } })
  if (!latest) return { ok: false, reason: 'no-dna-version' }
  const latestContent = DnaContentSchema.safeParse(latest.content)
  if (!latestContent.success) return { ok: false, reason: 'malformed-content' }

  const fieldKey = DNA_FIELD_KEY[field]
  const newContent = { ...latestContent.data, [fieldKey]: previousText }
  const { [field]: _cleared, ...remainingPendingUndo } = pendingUndo

  const [newVersion] = await prisma.$transaction([
    prisma.dnaVersion.create({
      data: { groupId: group.id, versionNumber: latest.versionNumber + 1, content: newContent, author: 'Chair', scoreStage: 'ChairEdited' },
    }),
    prisma.group.update({ where: { id: group.id }, data: { [fieldKey]: previousText, pendingUndo: remainingPendingUndo } }),
    prisma.event.create({ data: { groupId: group.id, type: 'Edit', actorEmail } }),
  ])

  return { ok: true, dnaVersionId: newVersion.id, text: previousText }
}
