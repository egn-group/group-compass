import { describe, expect, it } from 'vitest'
import { countryForPartnerCode } from './partnerCodeCountry'

describe('countryForPartnerCode', () => {
  it('resolves the one confirmed real partner code', () => {
    expect(countryForPartnerCode('EGDK')).toBe('Denmark')
  })

  it('is case-insensitive', () => {
    expect(countryForPartnerCode('egdk')).toBe('Denmark')
  })

  it('returns an empty string for an unrecognized code, not a guess', () => {
    expect(countryForPartnerCode('XXYY')).toBe('')
  })
})
