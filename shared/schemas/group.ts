import { z } from 'zod'
import { DnaContentSchema } from './dna'

// The 6 required metadata columns from the real Salesforce export (spec §12).
// The 3 profile columns may be blank — a group with all three blank still
// imports, flagged noSourceDna, per spec §12.
export const RawImportRowSchema = z.object({
  egnGroupName: z.string().min(1),
  egnGroupId: z.string().min(1),
  mmsGroupCode: z.string().min(1),
  partnerCode: z.string().min(1),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
  // checkGroupImport matches these against existing Users — an exact email
  // match first, falling back to the name column when the email is blank or
  // doesn't match anyone (real Salesforce exports don't always carry a
  // usable email). Never auto-creates a User either way: the Chair/NA must
  // already exist (via the Users CSV import or the Add user form) before
  // their group can resolve to them.
  responsibleChairName: z.string().min(1),
  responsibleChairEmail: z.string().email().or(z.literal('')),
  responsibleSalesName: z.string().min(1),
  responsibleSalesEmail: z.string().email().or(z.literal('')),
})
export type RawImportRow = z.infer<typeof RawImportRowSchema>

export const CheckGroupImportRequestSchema = z.object({
  rows: z.array(RawImportRowSchema).min(1),
})

export const ImportRowStatusSchema = z.enum(['new', 'unchanged', 'changed'])
export type ImportRowStatus = z.infer<typeof ImportRowStatusSchema>

export const ImportCheckResultSchema = z.object({
  row: RawImportRowSchema,
  status: ImportRowStatusSchema,
  existingGroupId: z.string().nullable(),
  suggestedChairEmail: z.string().nullable(),
  // True when suggestedChairEmail/suggestedNetworkAdvisorEmail came from a
  // name fallback (the row's email cell was blank) rather than the email
  // itself — the review screen flags these for a closer look, since a name
  // match is a weaker signal than an exact email match.
  chairMatchedByName: z.boolean(),
  suggestedNetworkAdvisorEmail: z.string().nullable(),
  networkAdvisorMatchedByName: z.boolean(),
})
export type ImportCheckResult = z.infer<typeof ImportCheckResultSchema>

const ImportActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create') }),
  z.object({ type: z.literal('overwrite'), groupId: z.string() }),
])

export const FinalizeImportRowSchema = z.object({
  egnGroupName: z.string().min(1),
  egnGroupId: z.string().min(1),
  mmsGroupCode: z.string().min(1),
  partnerCode: z.string().min(1),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
  chairEmail: z.string().email().nullable(),
  networkAdvisorEmail: z.string().email().nullable(),
  action: ImportActionSchema,
})
export type FinalizeImportRow = z.infer<typeof FinalizeImportRowSchema>

export const PutGroupsRequestSchema = z.object({
  rows: z.array(FinalizeImportRowSchema).min(1),
})

export const GroupDtoSchema = z.object({
  id: z.string(),
  egnGroupId: z.string(),
  name: z.string(),
  mmsGroupCode: z.string().nullable(),
  partnerCode: z.string(),
  country: z.string(),
  chairEmail: z.string().nullable(),
  networkAdvisorEmail: z.string().nullable(),
  lifecycleStatus: z.string(),
  noSourceDna: z.boolean(),
  emptySectionCount: z.number(),
  updatedAt: z.string(),
  // Drives the list's own Generate/Score/Launch row actions (issue #47)
  // without a separate per-row detail fetch first.
  latestDnaVersionId: z.string().nullable(),
  latestDnaVersionScore: z.number().nullable(),
  // Mirrors launchGroup's own precondition check exactly (latest version's
  // author is 'Ai') — the list can gate the Launch button on this instead
  // of duplicating that business rule client-side.
  hasPendingAiDraft: z.boolean(),
})
export type GroupDto = z.infer<typeof GroupDtoSchema>

export const DnaVersionSummarySchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  author: z.string().nullable(),
  score: z.number().nullable(),
  scoreStage: z.string().nullable(),
  createdAt: z.string(),
  content: DnaContentSchema,
})
export type DnaVersionSummary = z.infer<typeof DnaVersionSummarySchema>

export const GetGroupRequestSchema = z.object({
  groupId: z.string().min(1),
})

export const GroupDetailSchema = z.object({
  id: z.string(),
  egnGroupId: z.string(),
  mmsGroupCode: z.string().nullable(),
  partnerCode: z.string(),
  name: z.string(),
  country: z.string(),
  chairEmail: z.string().nullable(),
  networkAdvisorEmail: z.string().nullable(),
  lifecycleStatus: z.string(),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
  latestDnaVersion: DnaVersionSummarySchema.nullable(),
})
export type GroupDetail = z.infer<typeof GroupDetailSchema>

// Admin-only correction of a group's own imported metadata/profile text —
// e.g. fixing a Salesforce data-entry mistake — without a full CSV
// re-import. Chair/NA assignment has its own Reassign action; this is
// deliberately just the raw content, and egnGroupId stays immutable (it's
// the natural key re-import matching relies on).
export const EditGroupRequestSchema = z.object({
  groupId: z.string().min(1),
  egnGroupName: z.string().min(1),
  mmsGroupCode: z.string().min(1),
  partnerCode: z.string().min(1),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
})
export type EditGroupRequest = z.infer<typeof EditGroupRequestSchema>

export const EditGroupResponseSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  mmsGroupCode: z.string().nullable(),
  partnerCode: z.string(),
  country: z.string(),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
  pendingReapproval: z.boolean(),
})
export type EditGroupResponse = z.infer<typeof EditGroupResponseSchema>

// Admin-only, and deliberately narrow: refuses whenever the group has any
// DNA versions, comments, review events, or AI conversation history — spec
// §12 already has a deliberate "Closed" status for retiring a real group,
// so in practice this only ever succeeds on a freshly imported row nobody
// has touched yet (e.g. a duplicate/mis-imported one).
export const DeleteGroupRequestSchema = z.object({
  groupId: z.string().min(1),
})
export const DeleteGroupResponseSchema = z.object({
  groupId: z.string(),
})
export type DeleteGroupResponse = z.infer<typeof DeleteGroupResponseSchema>

// null unassigns — matches the CSV-import review flow's own "— unmatched —"
// option, not a distinct "leave unchanged" sentinel (this endpoint always
// sets both fields explicitly, same as putGroups does today).
export const ReassignGroupRequestSchema = z.object({
  groupId: z.string().min(1),
  chairEmail: z.string().email().nullable(),
  networkAdvisorEmail: z.string().email().nullable(),
})
export const ReassignGroupResponseSchema = z.object({
  groupId: z.string(),
  chairEmail: z.string().nullable(),
  networkAdvisorEmail: z.string().nullable(),
})
export type ReassignGroupResponse = z.infer<typeof ReassignGroupResponseSchema>
