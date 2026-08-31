import type { Context, HttpRequest } from '@azure/functions'
import { GenerateDnaStage2RequestSchema } from '../../shared/schemas/dna'
import { getPrincipal, getUserByEmail, requireAdmin, requireAuth } from '../shared/auth'
import { errorResponse, serverError } from '../shared/errors'
import { CONSULTANT_MODEL } from '../shared/dna/models'
import { stage2ConsultantPrompt } from '../shared/dna/prompts'
import { callAi } from '../shared/ai/client'

// Stage 2 ("Strict consultant") of the 4-prompt pipeline (spec §8) — its
// own endpoint for the same 45s-cap reason as generateDnaStage1. Takes
// Stage 1's output (held client-side, per issue #22) rather than looking
// it up itself, matching the ticket's on-demand-continuation pattern.
const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = GenerateDnaStage2RequestSchema.safeParse(req.body)
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

    const { stage1Text, roster } = parsed.data
    const todayStr = new Date().toISOString().slice(0, 10)
    const userParts = [`Dags dato: ${todayStr}`, `Struktureret original (fra trin 1):\n\n${stage1Text}`]
    if (roster && roster.trim()) {
      userParts.push(
        `Gruppens deltagerliste (titel + virksomhed pr. medlem). Brug dette til at skærpe ` +
          `Medlemsprofil og Virksomhedsprofil — men opfind ikke noget der modsiger kilden ovenfor:\n\n${roster.trim()}`,
      )
    }

    const result = await callAi({
      promptVersion: stage2ConsultantPrompt,
      messages: [{ role: 'user', content: userParts.join('\n\n---\n\n') }],
      model: CONSULTANT_MODEL,
      maxTokens: 2000,
      log: (entry) => context.log(entry),
      // Same reasoning as generateDnaStage1: measured ~19s for a genuine
      // rewrite of the real sample's longest profile.
      timeoutMs: 30_000,
      maxRetries: 0,
    })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage2Text: result.text }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
