import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_RETRIES, callAi } from './client'
import { AiPermanentError, AiTransientError, type AiCompletionRequest, type AiCompletionResult, type AiPromptVersion, type AiProvider } from './types'

const promptVersion: AiPromptVersion = { key: 'test-prompt', version: 1, system: 'Be terse.' }

function fakeResult(overrides: Partial<AiCompletionResult> = {}): AiCompletionResult {
  return {
    text: 'hello',
    model: 'claude-sonnet-5',
    stopReason: 'complete',
    usage: { inputTokens: 100, outputTokens: 20 },
    ...overrides,
  }
}

function fakeProvider(behavior: (request: AiCompletionRequest) => AiCompletionResult): AiProvider {
  return { complete: vi.fn(async (request: AiCompletionRequest) => behavior(request)) }
}

describe('callAi', () => {
  it('returns the completion, cost, and prompt version on success', async () => {
    const log = vi.fn()
    const provider = fakeProvider(() => fakeResult())

    const result = await callAi({ promptVersion, messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-5', maxTokens: 100, log, provider })

    expect(result.text).toBe('hello')
    expect(result.promptKey).toBe('test-prompt')
    expect(result.promptVersion).toBe(1)
    expect(result.attempts).toBe(1)
    expect(result.costUsd).toBeCloseTo((100 / 1_000_000) * 2 + (20 / 1_000_000) * 10)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'ai_call', attempts: 1 }))
  })

  it('passes the fixed call timeout budget to the provider, not a caller-supplied one', async () => {
    const provider = fakeProvider(() => fakeResult())
    await callAi({ promptVersion, messages: [], model: 'claude-sonnet-5', maxTokens: 100, log: vi.fn(), provider })

    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: DEFAULT_CALL_TIMEOUT_MS }))
  })

  it('logs a null cost for a model with no pricing entry, without failing the call', async () => {
    const provider = fakeProvider(() => fakeResult({ model: 'some-future-model' }))
    const result = await callAi({ promptVersion, messages: [], model: 'some-future-model', maxTokens: 100, log: vi.fn(), provider })

    expect(result.costUsd).toBeNull()
  })

  it('retries once on a transient error, then succeeds', async () => {
    let calls = 0
    const provider: AiProvider = {
      complete: vi.fn(async () => {
        calls++
        if (calls === 1) throw new AiTransientError('rate limited')
        return fakeResult()
      }),
    }
    const log = vi.fn()

    const result = await callAi({ promptVersion, messages: [], model: 'claude-sonnet-5', maxTokens: 100, log, provider })

    expect(result.attempts).toBe(2)
    expect(provider.complete).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'ai_call_retry', attempt: 1 }))
  })

  it(`gives up after ${DEFAULT_MAX_RETRIES} retries and throws the transient error`, async () => {
    const provider = fakeProvider(() => {
      throw new AiTransientError('still rate limited')
    })
    const log = vi.fn()

    await expect(callAi({ promptVersion, messages: [], model: 'claude-sonnet-5', maxTokens: 100, log, provider })).rejects.toThrow(AiTransientError)
    expect(provider.complete).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'ai_call_failed' }))
  })

  it('does not retry a permanent error', async () => {
    const provider = fakeProvider(() => {
      throw new AiPermanentError('bad request')
    })

    await expect(callAi({ promptVersion, messages: [], model: 'claude-sonnet-5', maxTokens: 100, log: vi.fn(), provider })).rejects.toThrow(AiPermanentError)
    expect(provider.complete).toHaveBeenCalledTimes(1)
  })

  it('passes through a truncated response as a successful call, not an error', async () => {
    const provider = fakeProvider(() => fakeResult({ stopReason: 'max_tokens' }))

    const result = await callAi({ promptVersion, messages: [], model: 'claude-sonnet-5', maxTokens: 100, log: vi.fn(), provider })

    expect(result.stopReason).toBe('max_tokens')
  })
})
