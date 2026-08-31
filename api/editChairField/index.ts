import type { Context, HttpRequest } from '@azure/functions'
import { DnaContentSchema } from '../../shared/schemas/dna'
import { EditChairFieldRequestSchema, type EditChairFieldResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { editFeedbackPrompt } from '../shared/chairReview/prompts'
import { EDIT_FEEDBACK_MODEL } from '../shared/chairReview/models'
import { DNA_FIELD_KEY, DNA_FIELD_LABEL } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

// Manual edit path (spec §11): saves the Chair's own rewrite as a new
// versioned DnaVersion snapshot (author 'Chair', scoreStage 'ChairEdited',
// left unscored — issue #31's on-demand scoring covers this stage too),
// updates the group's live text to match, resolves any pending NA comment
// on that field, and (best-effort, never blocking the save that already
// happened) asks the AI for short quality-check feedback posted into that
// field's conversation. Editing a field on an already-Approved group sets
// pendingReapproval instead of a separate status — never re-clears an
// already-earned per-field approval.
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

    const latest = await prisma.dnaVersion.findFirst({ where: { groupId }, orderBy: { versionNumber: 'desc' } })
    if (!latest) {
      context.res = errorResponse(500, 'Group has no DNA version to edit.')
      return
    }
    const latestContent = DnaContentSchema.safeParse(latest.content)
    if (!latestContent.success) {
      context.res = errorResponse(500, 'The latest DNA version has malformed content.')
      return
    }

    const fieldKey = DNA_FIELD_KEY[field]
    const oldText = group[fieldKey]
    const newContent = { ...latestContent.data, [fieldKey]: text }

    const [newVersion] = await prisma.$transaction([
      prisma.dnaVersion.create({
        data: { groupId, versionNumber: latest.versionNumber + 1, content: newContent, author: 'Chair', scoreStage: 'ChairEdited' },
      }),
      prisma.group.update({
        where: { id: groupId },
        data: { [fieldKey]: text, ...(group.lifecycleStatus === 'Approved' ? { pendingReapproval: true } : {}) },
      }),
      prisma.comment.updateMany({ where: { groupId, field, resolved: false }, data: { resolved: true } }),
      prisma.event.create({ data: { groupId, type: 'Edit', actorEmail: principal.email } }),
    ])

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
        model: EDIT_FEEDBACK_MODEL,
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

    const body: EditChairFieldResponse = { field, dnaVersionId: newVersion.id, aiFeedback }
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
