import { describe, expect, it } from 'vitest'
import { parseScore } from './parseScore'

describe('parseScore', () => {
  it('parses a bare digit', () => {
    expect(parseScore('4')).toBe(4)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseScore('  5\n')).toBe(5)
  })

  it('rejects a digit outside 1-5', () => {
    expect(parseScore('0')).toBeNull()
    expect(parseScore('6')).toBeNull()
  })

  it('rejects anything with extra text, not just the leading digit', () => {
    expect(parseScore('4 - strong')).toBeNull()
    expect(parseScore('Score: 4')).toBeNull()
  })

  it('rejects empty output', () => {
    expect(parseScore('')).toBeNull()
  })
})
