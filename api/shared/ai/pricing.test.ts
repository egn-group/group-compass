import { describe, expect, it } from 'vitest'
import { costForCall } from './pricing'

describe('costForCall', () => {
  it('computes cost from per-1M-token pricing', () => {
    expect(costForCall('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(2 + 10)
  })

  it('matches a model id the API resolved to a dated snapshot', () => {
    // issue #22: requesting the bare "claude-haiku-4-5" alias, the API
    // reports back "claude-haiku-4-5-20251001" in the response.
    expect(costForCall('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBeCloseTo(1 + 5)
  })

  it('returns null for a model with no pricing entry, rather than guessing', () => {
    expect(costForCall('some-future-model', 1000, 1000)).toBeNull()
  })
})
