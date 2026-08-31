import type { Context, HttpRequest } from '@azure/functions'
import type { DnaFieldValue } from '../../shared/schemas/dna'
import { SuggestImprovementsRequestSchema, type SuggestImprovementsResponse } from '../../shared/schemas/chairReview'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAuth, requireChair } from '../shared/auth'
import { CHAIR_REVIEW_MODEL } from '../shared/chairReview/models'
import { parseSuggestions } from '../shared/chairReview/parseChat'
import { suggestImprovementsPrompt } from '../shared/chairReview/prompts'
import { ALL_DNA_FIELDS, DNA_FIELD_KEY, DNA_FIELD_LABEL } from '../shared/dna/fieldKeys'
import { errorResponse, serverError } from '../shared/errors'

const FIELD_BY_LABEL: Partial<Record<string, DnaFieldValue>> = Object.fromEntries(
  ALL_DNA_FIELDS.map((field) => [DNA_FIELD_LABEL[field], field]),
)

// Optional, offered once every field is approved (spec §11) — only if the
// AI sees something clear and concrete to flag, never a requirement to act
// on. Stateless: not persisted as AiConversationTurn rows, same as the
// prototype (re-checked fresh each time, not a running log).
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = SuggestImprovementsRequestSchema.safeParse(req.body)
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

    const { groupId } = parsed.data
    const group = await prisma.group.findFirst({ where: { id: groupId, chairEmail: principal.email } })
    if (!group) {
      context.res = errorResponse(404, `Group ${groupId} not found.`)
      return
    }
    if (group.lifecycleStatus !== 'Approved') {
      context.res = errorResponse(400, 'Group is not fully approved yet.')
      return
    }

    const content = ALL_DNA_FIELDS.map((field) => `Felt: ${DNA_FIELD_LABEL[field]}\n${group[DNA_FIELD_KEY[field]]}`).join('\n\n---\n\n')
    const result = await callAi({
      promptVersion: suggestImprovementsPrompt,
      messages: [{ role: 'user', content }],
      model: CHAIR_REVIEW_MODEL,
      maxTokens: 500,
      log: (entry) => context.log(entry),
    })

    const raw = parseSuggestions(result.text)
    const body: SuggestImprovementsResponse = {
      suggestions: raw.flatMap((s) => {
        const field = FIELD_BY_LABEL[s.fieldLabel]
        return field ? [{ field, suggestion: s.suggestion }] : []
      }),
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
