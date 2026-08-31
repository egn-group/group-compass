import type { Context, HttpRequest } from '@azure/functions'
import { GenerateDnaStage1RequestSchema } from '../../shared/schemas/dna'
import { getPrincipal, getUserByEmail, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'
import { NOTARY_MODEL } from '../shared/dna/models'
import { buildRawInputText, resolveGenerationInput } from '../shared/dna/pipelineInput'
import { stage1NotaryPrompt } from '../shared/dna/prompts'
import { callAi } from '../shared/ai/client'

// Stage 1 ("Notary") of the 4-prompt pipeline (spec §8) — its own endpoint,
// not combined with Stage 2, because CLAUDE_1.md's 45s SWA cap leaves no
// real margin for two AI calls in one request (issue #22). The client
// holds stage1Text and passes it to generateDnaStage2.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = GenerateDnaStage1RequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireAdmin(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const input = await resolveGenerationInput(parsed.data.groupId)
    if (!input) {
      context.res = errorResponse(404, `Group ${parsed.data.groupId} not found.`)
      return
    }

    const result = await callAi({
      promptVersion: stage1NotaryPrompt,
      messages: [{ role: 'user', content: buildRawInputText(input) }],
      model: NOTARY_MODEL,
      maxTokens: 2000,
      log: (entry) => context.log(entry),
      // Measured against the real sample's longest profile while building
      // this ticket: ~18s for a genuine, successful restructuring of a
      // large real group — the AI call layer's 15s/1-retry default is
      // sized for small, fast calls and would time out on every attempt
      // for content like this. 30s/no-retry leaves real margin under
      // SWA's 45s cap instead of retrying a call that was never going to
      // finish faster.
      timeoutMs: 30_000,
      maxRetries: 0,
    })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage1Text: result.text }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
