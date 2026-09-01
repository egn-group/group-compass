import { z } from 'zod'

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
  // Names are kept for a human reading the raw export — not the matching
  // key. Email is: checkGroupImport looks it up directly against existing
  // Users (never auto-creates one), surfacing an unmatched email the same
  // way an unmatched name used to show — the Chair/NA must already exist
  // (via the Users CSV import or the Add user form) before their group can
  // resolve to them.
  responsibleChairName: z.string().min(1),
  responsibleChairEmail: z.string().email(),
  responsibleSalesName: z.string().min(1),
  responsibleSalesEmail: z.string().email(),
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
  suggestedNetworkAdvisorEmail: z.string().nullable(),
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
})
export type GroupDto = z.infer<typeof GroupDtoSchema>
