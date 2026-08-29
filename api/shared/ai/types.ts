// The seam every AI-calling endpoint depends on instead of a specific
// provider's SDK (spec: "allow for easy switching to another LLM"). Swapping
// providers means writing one new adapter that satisfies AiProvider —
// nothing in client.ts or its callers changes.

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiCompletionRequest {
  system: string
  messages: AiMessage[]
  model: string
  maxTokens: number
  /** Wall-clock budget for this one attempt — the caller (client.ts) owns the retry loop, not the provider. */
  timeoutMs: number
}

export type AiStopReason = 'complete' | 'max_tokens' | 'refused'

export interface AiCompletionResult {
  text: string
  /** The model that actually served the request — may differ from the request if the provider redirects/falls back. */
  model: string
  stopReason: AiStopReason
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

/** Retrying the same request may succeed: rate limit, server error, timeout, connection failure. */
export class AiTransientError extends Error {}

/** Retrying will not help: invalid request, auth failure, unsupported model. */
export class AiPermanentError extends Error {}

export interface AiProvider {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>
}

/**
 * A system prompt is a product decision (CLAUDE_1.md), not a code-cleanup
 * detail — version it in code and carry the version through to whatever
 * calls callAi, so it can eventually be stored per-output (DnaVersion /
 * AiConversationTurn — wiring that DB write is a different ticket's job).
 * Each feature that calls the AI layer owns its own prompt(s); there is no
 * central prompt registry here, since none of the real prompt text exists
 * yet.
 */
export interface AiPromptVersion {
  key: string
  version: number
  system: string
}

export interface AiCallOptions {
  promptVersion: AiPromptVersion
  messages: AiMessage[]
  model: string
  maxTokens: number
  /** Structured per-call logging (CLAUDE_1.md: token count/cost/latency logged per call) — pass `context.log` from the calling function. */
  log: (entry: Record<string, unknown>) => void
  /** Override for tests; production callers omit this and get provider.ts's env-selected provider. */
  provider?: AiProvider
}

export interface AiCallResult {
  text: string
  stopReason: AiStopReason
  model: string
  promptKey: string
  promptVersion: number
  usage: {
    inputTokens: number
    outputTokens: number
  }
  /** null when the serving model isn't in pricing.ts's table yet. */
  costUsd: number | null
  latencyMs: number
  attempts: number
}
