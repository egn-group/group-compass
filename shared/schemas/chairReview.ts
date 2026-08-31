import { z } from 'zod'
import { DnaFieldSchema } from './dna'

// A Chair's own group as the "My groups" list shows it. No score, no
// change-list data anywhere — spec §4/§15 says the Chair never sees
// scores, and this DTO never touches DnaVersion at all.
export const ChairGroupListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  networkAdvisorName: z.string().nullable(),
  lifecycleStatus: z.string(),
  pendingReapproval: z.boolean(),
  updatedAt: z.string(),
})
export type ChairGroupListItem = z.infer<typeof ChairGroupListItemSchema>

export const GetChairGroupsResponseSchema = z.object({
  groups: z.array(ChairGroupListItemSchema),
})
export type GetChairGroupsResponse = z.infer<typeof GetChairGroupsResponseSchema>

const ChairFieldCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
})

const ChairFieldSchema = z.object({
  field: DnaFieldSchema,
  text: z.string(),
  approved: z.boolean(),
  // At most one unresolved comment is expected in the pilot's single NA
  // comment round, but this is an array (not nullable) so a future
  // multi-round flow isn't a breaking response-shape change.
  unresolvedComments: z.array(ChairFieldCommentSchema),
})
export type ChairField = z.infer<typeof ChairFieldSchema>

export const ChairGroupDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  networkAdvisorName: z.string().nullable(),
  lifecycleStatus: z.string(),
  pendingReapproval: z.boolean(),
  fields: z.array(ChairFieldSchema),
})
export type ChairGroupDetail = z.infer<typeof ChairGroupDetailSchema>

export const GetChairGroupRequestSchema = z.object({
  groupId: z.string().min(1),
})

export const ApproveChairFieldRequestSchema = z.object({
  groupId: z.string().min(1),
  field: DnaFieldSchema,
})
export const ApproveChairFieldResponseSchema = z.object({
  field: DnaFieldSchema,
  lifecycleStatus: z.string(),
  // True exactly on the transition into Approved (all 3 fields now
  // approved) — the client's cue to show spec §5's confirmation text,
  // not shown again on a field approved after the group already was.
  justFullyApproved: z.boolean(),
})
export type ApproveChairFieldResponse = z.infer<typeof ApproveChairFieldResponseSchema>

export const EditChairFieldRequestSchema = z.object({
  groupId: z.string().min(1),
  field: DnaFieldSchema,
  text: z.string().min(1),
})
export const EditChairFieldResponseSchema = z.object({
  field: DnaFieldSchema,
  dnaVersionId: z.string(),
  // The AI quality-check feedback (spec §11) — always present on success;
  // never blocks the save that already happened by the time this returns.
  aiFeedback: z.string(),
})
export type EditChairFieldResponse = z.infer<typeof EditChairFieldResponseSchema>

export const ReapproveChairGroupRequestSchema = z.object({
  groupId: z.string().min(1),
})
export const ReapproveChairGroupResponseSchema = z.object({
  groupId: z.string(),
  pendingReapproval: z.boolean(),
})
export type ReapproveChairGroupResponse = z.infer<typeof ReapproveChairGroupResponseSchema>

// --- AI assistant chat (issue #26) ---

export const ConversationRoleSchema = z.enum(['Chair', 'Ai'])
export const ConversationOutcomeSchema = z.enum(['Accepted', 'Rejected', 'None'])

export const ConversationTurnDtoSchema = z.object({
  id: z.string(),
  role: ConversationRoleSchema,
  messageText: z.string().nullable(),
  proposedText: z.string().nullable(),
  outcome: ConversationOutcomeSchema,
  createdAt: z.string(),
})
export type ConversationTurnDto = z.infer<typeof ConversationTurnDtoSchema>

export const GetChairFieldConversationRequestSchema = z.object({
  groupId: z.string().min(1),
  field: DnaFieldSchema,
})
export const GetChairFieldConversationResponseSchema = z.object({
  turns: z.array(ConversationTurnDtoSchema),
})
export type GetChairFieldConversationResponse = z.infer<typeof GetChairFieldConversationResponseSchema>

export const ChairChatRequestSchema = z.object({
  groupId: z.string().min(1),
  field: DnaFieldSchema,
  message: z.string().min(1),
})
// A discriminated-ish shape: exactly one of clarifyingQuestion or the
// proposal fields is present, matching the AI's own SPØRGSMÅL/TEKST+NOTE
// response format (shared/chairReview/parseChat.ts).
export const ChairChatResponseSchema = z.object({
  clarifyingQuestion: z.string().nullable(),
  turnId: z.string().nullable(),
  proposedText: z.string().nullable(),
  note: z.string().nullable(),
})
export type ChairChatResponse = z.infer<typeof ChairChatResponseSchema>

export const ChairProposalActionRequestSchema = z.object({
  turnId: z.string().min(1),
})
export const AcceptChairProposalResponseSchema = z.object({
  field: DnaFieldSchema,
  dnaVersionId: z.string(),
})
export type AcceptChairProposalResponse = z.infer<typeof AcceptChairProposalResponseSchema>

export const SuggestImprovementsRequestSchema = z.object({
  groupId: z.string().min(1),
})
const SuggestionSchema = z.object({
  field: DnaFieldSchema,
  suggestion: z.string(),
})
export const SuggestImprovementsResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema),
})
export type SuggestImprovementsResponse = z.infer<typeof SuggestImprovementsResponseSchema>
