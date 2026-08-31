import { z } from 'zod'
import { DnaFieldSchema } from './dna'

// A group as the Network Advisor comment screen shows it. Group.groupProfile/
// memberProfile/companiesProfile are the live text (launchGroup already
// copied the Ai draft into them) — no need to join DnaVersion for display.
// Deliberately no score field anywhere here: spec §4/§15 says NA sees no
// scores, and scores live only on DnaVersion, which this DTO never touches.
export const NaGroupDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  chairName: z.string().nullable(),
  groupProfile: z.string(),
  memberProfile: z.string(),
  companiesProfile: z.string(),
})
export type NaGroupDto = z.infer<typeof NaGroupDtoSchema>

export const GetNaGroupsResponseSchema = z.object({
  groups: z.array(NaGroupDtoSchema),
  // Whether to show the first-time guidance banner (spec §5's three
  // prompts) — the inverse of the caller's own User.hasSeenNaGuidance.
  showGuidance: z.boolean(),
})
export type GetNaGroupsResponse = z.infer<typeof GetNaGroupsResponseSchema>

const NaCommentInputSchema = z.object({
  field: DnaFieldSchema,
  text: z.string().min(1),
})

export const PutNaCommentsRequestSchema = z.object({
  groupId: z.string().min(1),
  comments: z.array(NaCommentInputSchema).min(1),
})
export type PutNaCommentsInput = z.infer<typeof PutNaCommentsRequestSchema>

export const PutNaCommentsResponseSchema = z.object({
  groupId: z.string(),
  lifecycleStatus: z.string(),
})
export type PutNaCommentsResponse = z.infer<typeof PutNaCommentsResponseSchema>
