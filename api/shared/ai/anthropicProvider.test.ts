import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { mapAnthropicError } from './anthropicProvider'
import { AiPermanentError, AiTransientError } from './types'

describe('mapAnthropicError', () => {
  it('classifies a rate limit as transient', () => {
    const mapped = mapAnthropicError(new Anthropic.RateLimitError(429, {}, 'Rate limited', new Headers()))
    expect(mapped).toBeInstanceOf(AiTransientError)
  })

  it('classifies a 5xx as transient', () => {
    const mapped = mapAnthropicError(new Anthropic.InternalServerError(500, {}, 'Overloaded', new Headers()))
    expect(mapped).toBeInstanceOf(AiTransientError)
  })

  it('classifies a connection failure as transient', () => {
    const mapped = mapAnthropicError(new Anthropic.APIConnectionError({ message: 'ECONNRESET' }))
    expect(mapped).toBeInstanceOf(AiTransientError)
  })

  it('classifies a connection timeout as transient', () => {
    const mapped = mapAnthropicError(new Anthropic.APIConnectionTimeoutError())
    expect(mapped).toBeInstanceOf(AiTransientError)
  })

  it('classifies a bad request as permanent, not retryable', () => {
    const mapped = mapAnthropicError(new Anthropic.BadRequestError(400, {}, 'Invalid model', new Headers()))
    expect(mapped).toBeInstanceOf(AiPermanentError)
  })

  it('classifies an auth failure as permanent, not retryable', () => {
    const mapped = mapAnthropicError(new Anthropic.AuthenticationError(401, {}, 'Invalid API key', new Headers()))
    expect(mapped).toBeInstanceOf(AiPermanentError)
  })

  it('passes through an unrecognized error unchanged', () => {
    const original = new Error('something else entirely')
    expect(mapAnthropicError(original)).toBe(original)
  })
})
