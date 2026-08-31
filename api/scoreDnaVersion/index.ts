import type { Context, HttpRequest } from '@azure/functions'
import { DnaContentSchema, ScoreDnaVersionRequestSchema, type DnaContent } from '../../shared/schemas/dna'
import { callAi } from '../shared/ai/client'
import { getPrincipal, getUserByEmail, prisma, requireAdminOrChairLeader, requireAuth } from '../shared/auth'
import { SCORE_MODEL } from '../shared/dna/models'
import { parseScore } from '../shared/dna/parseScore'
import { scoreDnaPrompt } from '../shared/dna/prompts'
import { errorResponse, serverError } from '../shared/errors'

// On-demand scoring for an already-existing DnaVersion (issue #31) — the
// Imported-stage version is deliberately left unscored at import time (spec
// §9 treats it as reference-only, not a launch gate), and any version may
// be re-scored later (e.g. after the scoring prompt is retuned). Reuses
// scoreDna's own callAi+parseScore logic rather than an HTTP call to it —
// api/scoreDna itself is untouched by this ticket.
function textForScoring(content: DnaContent): string {
  return `GROUP PROFILE:\n${content.groupProfile}\n\nMEMBER PROFILE:\n${content.memberProfile}\n\nCOMPANIES PROFILE:\n${content.companiesProfile}`
}

const httpTrigger = async function (context: Context, req: HttpRequest): Promise<void> {
  const authFailure = requireAuth(req)
  if (authFailure) {
    context.res = authFailure
    return
  }

  const parsed = ScoreDnaVersionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    context.res = errorResponse(400, 'Invalid request body.', parsed.error.flatten())
    return
  }

  try {
    const principal = getPrincipal(req)!
    const caller = await getUserByEmail(principal.email)
    const roleFailure = requireAdminOrChairLeader(caller)
    if (roleFailure) {
      context.res = roleFailure
      return
    }

    const { dnaVersionId } = parsed.data
    const dnaVersion = await prisma.dnaVersion.findUnique({ where: { id: dnaVersionId } })
    if (!dnaVersion) {
      context.res = errorResponse(404, `DNA version ${dnaVersionId} not found.`)
      return
    }

    const content = DnaContentSchema.safeParse(dnaVersion.content)
    if (!content.success) {
      context.res = errorResponse(500, 'This DNA version has malformed content.')
      return
    }

    const result = await callAi({
      promptVersion: scoreDnaPrompt,
      messages: [{ role: 'user', content: textForScoring(content.data) }],
      model: SCORE_MODEL,
      maxTokens: 8,
      log: (entry) => context.log(entry),
    })

    const score = parseScore(result.text)
    if (score === null) {
      context.res = errorResponse(502, 'Scoring model did not return a valid 1-5 score.', { raw: result.text })
      return
    }

    await prisma.dnaVersion.update({ where: { id: dnaVersionId }, data: { score } })

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dnaVersionId, score }),
    }
  } catch (err) {
    context.res = serverError(context.log.error, err)
  }
}

module.exports = httpTrigger
