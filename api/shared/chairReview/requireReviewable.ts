import type { Group } from '../prismaClient'
import { errorResponse, type ApiError } from '../errors'

// A Chair may only edit, approve, or discuss a field with the AI assistant
// once the Network Advisor has actually sent their comment (spec §5/§11) —
// mirrors the prototype's dedicated "waiting" view, which showed no editing
// affordances at all while a group sat in Launched. ChairReview (the NA has
// commented) and Approved (re-editing after approval, via reapproveChairGroup)
// are the only two statuses this allows; Launched (still waiting on the NA)
// and anything else (Imported/DraftGenerated — not launched at all; Closed —
// archived) are rejected the same way. Checked server-side in every
// Chair-mutating endpoint scoped to a specific group/field — never just in
// the UI, which is convenience only.
export function requireChairReviewable(group: Pick<Group, 'lifecycleStatus'>): ApiError | null {
  if (group.lifecycleStatus !== 'ChairReview' && group.lifecycleStatus !== 'Approved') {
    return errorResponse(400, 'Waiting on the Network Advisor to comment before this group can be edited.')
  }
  return null
}
