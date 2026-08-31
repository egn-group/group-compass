import 'dotenv/config'
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_RETRIES, callAi } from '../shared/ai/client'
import { AiTransientError, type AiProvider } from '../shared/ai/types'

// Two things this script proves, matching the db:verify* convention from
// issues #11/#14 but with no database involved:
//
// 1. A real call against the real Anthropic API, end to end through
//    callAi — proves env-var credential loading, the provider adapter's
//    request/response mapping, and cost/latency logging all wire together
//    correctly. Costs a fraction of a cent (a handful of tokens).
// 2. The retry-on-transient-failure path, exercised against a fake
//    provider rather than a real one — there's no reliable way to make the
//    real API return a 429/5xx on demand, and retry/backoff/timeout-budget
//    logic is provider-agnostic by design, so a fake provider proves it
//    just as well without depending on live failure injection.
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set — add it to api/local.settings.json before running this script.')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function verifyRealCall() {
  const logs: Record<string, unknown>[] = []
  const result = await callAi({
    promptVersion: { key: 'verify-ai-call-smoke-test', version: 1, system: 'Reply with exactly one word: acknowledged.' },
    messages: [{ role: 'user', content: 'Ready?' }],
    model: 'claude-sonnet-5',
    maxTokens: 16,
    log: (entry) => logs.push(entry),
  })

  assert(result.text.trim().length > 0, 'real call returned non-empty text')
  assert(result.usage.inputTokens > 0 && result.usage.outputTokens > 0, 'real call reported non-zero token usage')
  assert(result.costUsd !== null && result.costUsd > 0, 'real call computed a non-null cost for a priced model')
  assert(result.attempts === 1, 'real call succeeded on the first attempt')
  assert(result.promptKey === 'verify-ai-call-smoke-test' && result.promptVersion === 1, 'prompt version threaded through to the result')
  assert(
    logs.some((l) => l.event === 'ai_call' && l.costUsd === result.costUsd && l.model === result.model),
    'a matching ai_call log entry was emitted',
  )

  console.log(`  real call ok: model=${result.model} tokens=${result.usage.inputTokens}/${result.usage.outputTokens} cost=$${result.costUsd?.toFixed(6)} latency=${result.latencyMs}ms`)
}

async function verifyRetryAndTimeoutBudget() {
  const logs: Record<string, unknown>[] = []
  let calls = 0
  const flakyThenOk: AiProvider = {
    complete: async (request) => {
      calls++
      assert(request.timeoutMs === DEFAULT_CALL_TIMEOUT_MS, `provider received the fixed call timeout budget (${DEFAULT_CALL_TIMEOUT_MS}ms)`)
      if (calls === 1) throw new AiTransientError('simulated 429')
      return { text: 'ok', model: 'claude-sonnet-5', stopReason: 'complete', usage: { inputTokens: 5, outputTokens: 1 } }
    },
  }

  const result = await callAi({
    promptVersion: { key: 'verify-ai-call-retry-test', version: 1, system: 'irrelevant' },
    messages: [],
    model: 'claude-sonnet-5',
    maxTokens: 16,
    log: (entry) => logs.push(entry),
    provider: flakyThenOk,
  })

  assert(result.attempts === 2, 'succeeded on the second attempt after one simulated transient failure')
  assert(
    logs.some((l) => l.event === 'ai_call_retry' && l.attempt === 1),
    'a retry was logged',
  )

  const alwaysFails: AiProvider = { complete: async () => { throw new AiTransientError('simulated persistent 429') } }
  let threw = false
  try {
    await callAi({
      promptVersion: { key: 'verify-ai-call-exhausted-test', version: 1, system: 'irrelevant' },
      messages: [],
      model: 'claude-sonnet-5',
      maxTokens: 16,
      log: () => {},
      provider: alwaysFails,
    })
  } catch (err) {
    threw = err instanceof AiTransientError
  }
  assert(threw, `a persistently transient failure is rethrown after ${DEFAULT_MAX_RETRIES} retries, not swallowed`)

  console.log(`  retry/timeout-budget path ok: recovered after 1 retry, gave up after ${DEFAULT_MAX_RETRIES} retries when the failure persisted`)
}

async function main() {
  await verifyRealCall()
  await verifyRetryAndTimeoutBudget()
  console.log('verify-ai-call: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
