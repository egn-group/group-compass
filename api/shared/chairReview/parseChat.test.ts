import { describe, expect, it } from 'vitest'
import { parseChatResponse, parseSuggestions } from './parseChat'

describe('parseChatResponse', () => {
  it('parses a clarifying question, ignoring any TEKST/NOTE-shaped content', () => {
    const raw = 'SPØRGSMÅL: Hvad vil du gerne have ændret i teksten?'
    expect(parseChatResponse(raw)).toEqual({
      clarifyingQuestion: 'Hvad vil du gerne have ændret i teksten?',
      proposedText: null,
      note: null,
    })
  })

  it('parses a proposal with both TEKST and NOTE', () => {
    const raw = 'TEKST: Ny feltekst her.\nNOTE: Gjorde teksten kortere.'
    expect(parseChatResponse(raw)).toEqual({
      clarifyingQuestion: null,
      proposedText: 'Ny feltekst her.',
      note: 'Gjorde teksten kortere.',
    })
  })

  it('falls back to the raw trimmed text when the format is not followed, rather than dropping content', () => {
    const raw = '  Some unstructured reply the model gave anyway.  '
    expect(parseChatResponse(raw)).toEqual({
      clarifyingQuestion: null,
      proposedText: 'Some unstructured reply the model gave anyway.',
      note: '',
    })
  })

  it('handles multi-line proposed text', () => {
    const raw = 'TEKST: Line one\nLine two\nNOTE: Explanation.'
    expect(parseChatResponse(raw).proposedText).toBe('Line one\nLine two')
  })
})

describe('parseSuggestions', () => {
  it('returns an empty list for INGEN FORSLAG', () => {
    expect(parseSuggestions('INGEN FORSLAG')).toEqual([])
  })

  it('parses one or more FELT/FORSLAG lines', () => {
    const raw = 'FELT: Group Profile | FORSLAG: Tilføj geografi.\nFELT: Member Profile | FORSLAG: Skarpere match-regel.'
    expect(parseSuggestions(raw)).toEqual([
      { fieldLabel: 'Group Profile', suggestion: 'Tilføj geografi.' },
      { fieldLabel: 'Member Profile', suggestion: 'Skarpere match-regel.' },
    ])
  })

  it('caps at 3 suggestions even if the model returns more', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `FELT: Field ${i} | FORSLAG: Suggestion ${i}.`).join('\n')
    expect(parseSuggestions(raw)).toHaveLength(3)
  })

  it('ignores lines that do not match the expected format', () => {
    const raw = 'Some preamble the model was told not to include.\nFELT: Group Profile | FORSLAG: Fix this.'
    expect(parseSuggestions(raw)).toEqual([{ fieldLabel: 'Group Profile', suggestion: 'Fix this.' }])
  })
})
