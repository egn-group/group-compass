// The single module every AI-calling endpoint goes through (CLAUDE_1.md:
// "Add — not present in the prototype: a real AI call layer"). Retry
// policy, the timeout budget, prompt-version threading, cost lookup, and
// logging all live here — provider-specific code lives only in
// anthropicProvider.ts (or whatever adapter provider.ts resolves to).
//
// Timeout/retry budget: SWA hard-caps every request at 45 seconds
// (CLAUDE_1.md), with no way to raise it. timeoutMs * (maxRetries + 1)
// must leave real margin under that cap, not just fit under it — the
// defaults below (15s * 2 = 30s) suit small, fast calls; a caller with a
// known larger realistic latency should override both via AiCallOptions
// rather than lean on retries to cover an unrealistically tight timeout
// (issue #22 hit exactly this: a 15s timeout is provably too tight for a
// call whose real worst-case latency is ~18-19s — both attempts would
// time out on every genuinely large input, not just occasionally). Each
// provider adapter must disable its own SDK's built-in retry (see
// anthropicProvider.ts) so this is the only retry loop — two independent
// retriers could stack past the cap without either one knowing about the
// other.
import { costForCall } from './pricing'
import { getAiProvider } from './provider'
import { AiPermanentError, AiTransientError, type AiCallOptions, type AiCallResult } from './types'

export const DEFAULT_CALL_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_RETRIES = 1
const RETRY_BASE_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function callAi(options: AiCallOptions): Promise<AiCallResult> {
  const provider = options.provider ?? getAiProvider()
  const log = options.log
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const startedAt = Date.now()

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await provider.complete({
        system: options.promptVersion.system,
        messages: options.messages,
        model: options.model,
        maxTokens: options.maxTokens,
        timeoutMs,
      })

      const latencyMs = Date.now() - startedAt
      const costUsd = costForCall(result.model, result.usage.inputTokens, result.usage.outputTokens)

      log({
        event: 'ai_call',
        promptKey: options.promptVersion.key,
        promptVersion: options.promptVersion.version,
        model: result.model,
        stopReason: result.stopReason,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        latencyMs,
        attempts: attempt + 1,
      })

      return {
        text: result.text,
        stopReason: result.stopReason,
        model: result.model,
        promptKey: options.promptVersion.key,
        promptVersion: options.promptVersion.version,
        usage: result.usage,
        costUsd,
        latencyMs,
        attempts: attempt + 1,
      }
    } catch (err) {
      lastError = err
      if (!(err instanceof AiTransientError) || attempt === maxRetries) break
      log({
        event: 'ai_call_retry',
        promptKey: options.promptVersion.key,
        promptVersion: options.promptVersion.version,
        attempt: attempt + 1,
        error: err.message,
      })
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  log({
    event: 'ai_call_failed',
    promptKey: options.promptVersion.key,
    promptVersion: options.promptVersion.version,
    latencyMs: Date.now() - startedAt,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  })
  if (lastError instanceof AiTransientError || lastError instanceof AiPermanentError) throw lastError
  throw new AiPermanentError(lastError instanceof Error ? lastError.message : String(lastError))
}
