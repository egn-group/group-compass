import { describe, expect, it } from 'vitest'
import { buildChatHistory, parseChatResponse, parseSuggestions } from './parseChat'

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

describe('buildChatHistory', () => {
  it('maps a Chair turn to a user message', () => {
    expect(buildChatHistory([{ role: 'Chair', messageText: 'Please shorten this.', proposedText: null }])).toEqual([
      { role: 'user', content: 'Please shorten this.' },
    ])
  })

  it('maps a plain-feedback or clarifying-question Ai turn (no proposedText) to its messageText', () => {
    expect(buildChatHistory([{ role: 'Ai', messageText: 'Looks good.', proposedText: null }])).toEqual([{ role: 'assistant', content: 'Looks good.' }])
  })

  it('reconstructs a proposal Ai turn in the TEKST:/NOTE: shape the model originally produced', () => {
    expect(buildChatHistory([{ role: 'Ai', messageText: 'Made it shorter.', proposedText: 'Ny feltekst her.' }])).toEqual([
      { role: 'assistant', content: 'TEKST: Ny feltekst her.\nNOTE: Made it shorter.' },
    ])
  })

  it('preserves turn order across a whole conversation', () => {
    const history = buildChatHistory([
      { role: 'Chair', messageText: 'I edited the Group Profile.', proposedText: null },
      { role: 'Ai', messageText: 'Consider adding revenue range.', proposedText: null },
      { role: 'Chair', messageText: 'Yes, please add that.', proposedText: null },
    ])
    expect(history).toEqual([
      { role: 'user', content: 'I edited the Group Profile.' },
      { role: 'assistant', content: 'Consider adding revenue range.' },
      { role: 'user', content: 'Yes, please add that.' },
    ])
  })
})
