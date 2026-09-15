import type { Context, HttpRequest } from '@azure/functions'
import { EditChairFieldRequestSchema, type EditChairFieldResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair, resolveActingAs } from '../shared/auth'
import { editFeedbackPrompt } from '../shared/chairReview/prompts'
import { CHAIR_REVIEW_MODEL } from '../shared/chairReview/models'
import { requireChairReviewable } from '../shared/chairReview/requireReviewable'
import { saveChairFieldEdit } from '../shared/chairReview/saveField'
import { DNA_FIELD_KEY, DNA_FIELD_LABEL } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

// Manual edit path (spec §11): saves the Chair's own rewrite via
// saveChairFieldEdit (versioned DnaVersion, live text update, comment
// resolution, pendingReapproval handling — shared with acceptChairProposal,
// issue #26), then (best-effort, never blocking the save that already
// happened) asks the AI for short quality-check feedback posted into that
// field's conversation.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = EditChairFieldRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const { effectiveEmail, isAdminActingAs } = resolveActingAs(req, principal, caller)
    if (!isAdminActingAs) {
      const roleFailure = requireChair(caller)
      if (roleFailure) {
        context.res = roleFailure
        return
      }
    }

    const { groupId, field, text } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: effectiveEmail } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }
    const reviewableFailure = requireChairReviewable(group)
    if (reviewableFailure) {
      context.res = reviewableFailure
      return
    }

    const oldText = group[DNA_FIELD_KEY[field]]
    const saved = await saveChairFieldEdit(group, field, text, effectiveEmail)
    if (!saved.ok) {
      context.res = errorResponse(500, saved.reason === 'no-dna-version' ? 'Group has no DNA version to edit.' : 'The latest DNA version has malformed content.')
      return
    }

    // No actual change (Chair clicked Edit then Save without touching the
    // text) — nothing for the AI to review, so no feedback call and nothing
    // posted to the conversation; the client leaves the AI assistant closed.
    let aiFeedback: string | null = null
    if (text !== oldText) {
      // Both the edit note and the feedback land in this field's own chat
      // conversation (not an inline card) — all AI interaction happens in
      // the chat, and a later reply here ("implement your suggestions")
      // sees this feedback as real history (chairChat's own history build).
      await prisma.aiConversationTurn.create({
        data: { groupId, field, chairEmail: effectiveEmail, role: 'Chair', messageText: `User edited the ${DNA_FIELD_LABEL[field]}.`, outcome: 'None' },
      })
      try {
        const result = await callAi({
          promptVersion: editFeedbackPrompt,
          messages: [
            {
              role: 'user',
              content: `Felt: ${DNA_FIELD_LABEL[field]}\n\nFør Chairs redigering:\n${oldText}\n\nEfter Chairs redigering:\n${text}`,
            },
          ],
          model: CHAIR_REVIEW_MODEL,
          maxTokens: 200,
          log: (entry) => context.log(entry),
        })
        aiFeedback = result.text.trim()
      } catch (err) {
        // Never blocks the save, which has already committed by this point —
        // the Chair always decides, feedback is advisory only (spec §11).
        context.log.error(err)
        aiFeedback = "Couldn't reach the AI assistant for feedback on this edit."
      }
      await prisma.aiConversationTurn.create({
        data: { groupId, field, chairEmail: effectiveEmail, role: 'Ai', messageText: aiFeedback, outcome: 'None' },
      })
    }

    const body: EditChairFieldResponse = { field, dnaVersionId: saved.dnaVersionId, aiFeedback }
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
