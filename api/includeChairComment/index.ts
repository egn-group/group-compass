import type { Context, HttpRequest } from '@azure/functions'
import { IncludeChairCommentRequestSchema, type IncludeChairCommentResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair, resolveActingAs } from '../shared/auth'
import { chairChatPrompt } from '../shared/chairReview/prompts'
import { CHAIR_REVIEW_MODEL } from '../shared/chairReview/models'
import { requireChairReviewable } from '../shared/chairReview/requireReviewable'
import { parseChatResponse } from '../shared/chairReview/parseChat'
import { saveChairFieldEdit } from '../shared/chairReview/saveField'
import { DNA_FIELD_KEY, DNA_FIELD_LABEL } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

// "Accept/Include" (prototype parity, HANDOFF.md §1's naInclude) — a
// one-click alternative to "Edit with AI" for a specific NA comment: asks
// the AI to fold the comment straight into the field text with a fixed
// instruction (no free-typed Chair message), then saves the result via the
// same saveChairFieldEdit path as a manual edit or an accepted proposal.
// Reuses chairChatPrompt/parseChatResponse rather than a parallel prompt —
// same system prompt, same SPØRGSMÅL guard against fabricating a change out
// of a comment the AI can't actually make sense of.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = IncludeChairCommentRequestSchema.safeParse(req.body)
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

    const { groupId, commentId } = parsed.data
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

    const comment = await prisma.comment.findFirst({ where: { id: commentId, groupId, resolved: false } })
    if (!comment) {
      context.res = errorResponse(404, `Unresolved comment ${commentId} not found.`)
      return
    }

    const field = comment.field
    const currentText = group[DNA_FIELD_KEY[field]]
    const result = await callAi({
      promptVersion: chairChatPrompt,
      messages: [
        {
          role: 'user',
          content: [
            `Feltnavn: ${DNA_FIELD_LABEL[field]}`,
            `Nuværende tekst:\n${currentText}`,
            `Network Advisors kommentar:\n${comment.text}`,
            `Chairs besked: Indarbejd venligst denne kommentar fra Network Advisor direkte i feltteksten.`,
          ].join('\n\n'),
        },
      ],
      model: CHAIR_REVIEW_MODEL,
      maxTokens: 800,
      log: (entry) => context.log(entry),
    })
    const parsedReply = parseChatResponse(result.text)
    if (parsedReply.clarifyingQuestion || !parsedReply.proposedText) {
      // This call always sends a well-formed instruction (never free-typed
      // Chair text), so the AI should never come back needing more context —
      // guarded anyway rather than writing a clarifying question into the
      // field text if it ever does (prototype parity, HANDOFF.md §1).
      context.res = errorResponse(422, 'The AI needed more context to include this comment — try "Edit with AI" instead.')
      return
    }

    const saved = await saveChairFieldEdit(group, field, parsedReply.proposedText, effectiveEmail)
    if (!saved.ok) {
      context.res = errorResponse(500, saved.reason === 'no-dna-version' ? 'Group has no DNA version to edit.' : 'The latest DNA version has malformed content.')
      return
    }
    await prisma.aiConversationTurn.create({
      data: {
        groupId,
        field,
        chairEmail: effectiveEmail,
        role: 'Ai',
        messageText: parsedReply.note || 'Included the Network Advisor’s comment into this field.',
        outcome: 'None',
      },
    })

    const body: IncludeChairCommentResponse = { field, text: parsedReply.proposedText, dnaVersionId: saved.dnaVersionId }
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
