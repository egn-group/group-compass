// The only file in api/shared/ai that imports @anthropic-ai/sdk — every
// other module here talks to the provider-agnostic shapes in ./types.
//
// maxRetries is 0: client.ts owns the one retry loop every provider goes
// through, so the SDK's own retry can't silently stack with ours and blow
// past SWA's 45-second request cap (worst case would be
// timeout * (our retries + 1) * (SDK retries + 1)).

import Anthropic from '@anthropic-ai/sdk'
import { AiPermanentError, AiTransientError, type AiCompletionRequest, type AiCompletionResult, type AiProvider, type AiStopReason } from './types'

const client = new Anthropic({ maxRetries: 0 })

function stopReasonFrom(reason: string | null): AiStopReason {
  if (reason === 'max_tokens') return 'max_tokens'
  if (reason === 'refusal') return 'refused'
  return 'complete'
}

/** Exported separately so the mapping is unit-testable without a real API call. */
export function mapAnthropicError(err: unknown): Error {
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return new AiTransientError(err.message)
  }
  if (err instanceof Anthropic.APIError) {
    return new AiPermanentError(err.message)
  }
  return err instanceof Error ? err : new Error(String(err))
}

export const anthropicProvider: AiProvider = {
  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    try {
      const response = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          // Current-generation models (Sonnet 5 included) default to
          // adaptive thinking when this is omitted, which can spend the
          // entire max_tokens budget on hidden reasoning and return zero
          // visible text (confirmed while building issue #22 — a real,
          // reproducible failure, not theoretical). Disabling it is safe
          // unconditionally: every model this layer calls accepts the
          // field, and these are short, deterministic transform/scoring
          // tasks with no need for extended reasoning.
          thinking: { type: 'disabled' },
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        { timeout: request.timeoutMs },
      )

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')

      return {
        text,
        model: response.model,
        stopReason: stopReasonFrom(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      }
    } catch (err) {
      throw mapAnthropicError(err)
    }
  },
}
