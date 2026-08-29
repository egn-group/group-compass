import { describe, expect, it } from 'vitest'
import { textEqualsIgnoringWhitespace } from './textCompare'

describe('textEqualsIgnoringWhitespace', () => {
  it('treats identical text as equal', () => {
    expect(textEqualsIgnoringWhitespace('hello world', 'hello world')).toBe(true)
  })

  it('ignores leading/trailing whitespace', () => {
    expect(textEqualsIgnoringWhitespace('  hello world  ', 'hello world')).toBe(true)
  })

  it('collapses internal whitespace runs', () => {
    expect(textEqualsIgnoringWhitespace('hello    world\n\nagain', 'hello world again')).toBe(true)
  })

  it('flags a genuine wording change', () => {
    expect(textEqualsIgnoringWhitespace('hello world', 'hello there')).toBe(false)
  })
})
