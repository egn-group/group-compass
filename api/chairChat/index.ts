import type { Context, HttpRequest } from '@azure/functions'
import { ChairChatRequestSchema, type ChairChatResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { chairChatPrompt } from '../shared/chairReview/prompts'
import { CHAIR_REVIEW_MODEL } from '../shared/chairReview/models'
import { parseChatResponse } from '../shared/chairReview/parseChat'
import { DNA_FIELD_KEY, DNA_FIELD_LABEL } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

// The Chair's AI assistant chat (spec §11, issue #26). Stateless per
// request — groupId/field are always passed explicitly by the client, so
// there's no server-side "which field are we discussing" session state to
// lose track of past the first message (the prototype's bug #3, HANDOFF.md
// §3 — that bug depended on client-only in-memory tracking this build
// never has). Every turn (Chair's message, and the AI's reply — whether a
// clarifying question or a proposal) is persisted to AiConversationTurn
// scoped to group+field, so switching fields never mixes up conversations
// (bug #1) and history is independent of how the field's current text got
// there (bug #2 — this endpoint only ever reads the group's live text and
// its own conversation rows, nothing else).
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ChairChatRequestSchema.safeParse(req.body)
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

    const { groupId, field, message } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: principal.email } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }

    const currentText = group[DNA_FIELD_KEY[field]]
    const unresolvedComment = await prisma.comment.findFirst({ where: { groupId, field, resolved: false }, orderBy: { createdAt: 'desc' } })

    await prisma.aiConversationTurn.create({
      data: { groupId, field, chairEmail: principal.email, role: 'Chair', messageText: message, outcome: 'None' },
    })

    const parts = [`Feltnavn: ${DNA_FIELD_LABEL[field]}`, `Nuværende tekst:\n${currentText}`]
    if (unresolvedComment) parts.push(`Network Advisors kommentar:\n${unresolvedComment.text}`)
    parts.push(`Chairs besked: ${message}`)

    const result = await callAi({
      promptVersion: chairChatPrompt,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
      model: CHAIR_REVIEW_MODEL,
      maxTokens: 800,
      log: (entry) => context.log(entry),
    })
    const parsedReply = parseChatResponse(result.text)

    const aiTurn = await prisma.aiConversationTurn.create({
      data: {
        groupId,
        field,
        chairEmail: principal.email,
        role: 'Ai',
        messageText: parsedReply.clarifyingQuestion ?? parsedReply.note,
        proposedText: parsedReply.proposedText,
        outcome: 'None',
      },
    })

    const body: ChairChatResponse = {
      clarifyingQuestion: parsedReply.clarifyingQuestion,
      turnId: parsedReply.clarifyingQuestion ? null : aiTurn.id,
      proposedText: parsedReply.proposedText,
      note: parsedReply.note,
    }
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
