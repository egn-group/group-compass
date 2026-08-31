import type { Context, HttpRequest } from '@azure/functions'
import { EditChairFieldRequestSchema, type EditChairFieldResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { editFeedbackPrompt } from '../shared/chairReview/prompts'
import { CHAIR_REVIEW_MODEL } from '../shared/chairReview/models'
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
    const roleFailure = requireChair(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const { groupId, field, text } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: principal.email } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const oldText = group[DNA_FIELD_KEY[field]]
    const saved = await saveChairFieldEdit(group, field, text, principal.email)
    if (!saved.ok) {
      context.res = errorResponse(500, saved.reason === 'no-dna-version' ? 'Group has no DNA version to edit.' : 'The latest DNA version has malformed content.')
      return
    }

    let aiFeedback: string
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
      await prisma.aiConversationTurn.create({
        data: { groupId, field, chairEmail: principal.email, role: 'Ai', messageText: aiFeedback, outcome: 'None' },
      })
    } catch (err) {
      // Never blocks the save, which has already committed by this point —
      // the Chair always decides, feedback is advisory only (spec §11).
      context.log.error(err)
      aiFeedback = "Couldn't reach the AI assistant for feedback on this edit."
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
