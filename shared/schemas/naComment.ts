import { z } from 'zod'
import { DnaFieldSchema } from './dna'

const NaSubmittedCommentSchema = z.object({
  field: DnaFieldSchema,
  text: z.string(),
  createdAt: z.string(),
})

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
  // 'Launched' (needs the NA's comment — editable), 'ChairReview' (sent,
  // read-only while the Chair works through it) or 'Approved' (read-only,
  // "Approved by Chair"). The group stays in this list through all three —
  // it never disappears the moment it's sent, unlike before.
  lifecycleStatus: z.string(),
  // The NA's own comments already sent for this group, by field — shown
  // read-only once the group leaves Launched (nothing to type anymore, but
  // what was actually sent shouldn't just vanish). Only this NA's own
  // comments (author NetworkAdvisor) are ever included here.
  comments: z.array(NaSubmittedCommentSchema),
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
