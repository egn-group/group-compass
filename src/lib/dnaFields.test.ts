import { describe, expect, it } from 'vitest'
import { parseDnaFields } from './dnaFields'

describe('parseDnaFields', () => {
  it('splits a templated section into label/value pairs, dropping the leading section header', () => {
    const text = [
      'GRUPPEPROFIL',
      '**Hvem er gruppen for**',
      'Gruppen henvender sig til ledere.',
      '',
      '**Hvad får man**',
      '5 årlige møder.',
    ].join('\n')

    expect(parseDnaFields(text)).toEqual([
      { label: 'Hvem er gruppen for', value: 'Gruppen henvender sig til ledere.' },
      { label: 'Hvad får man', value: '5 årlige møder.' },
    ])
  })

  it('keeps the literal "(ikke eksplicit defineret)" value for an unset field, unchanged', () => {
    const text = '**Udviklingsfokus**\n(ikke eksplicit defineret)'
    expect(parseDnaFields(text)).toEqual([{ label: 'Udviklingsfokus', value: '(ikke eksplicit defineret)' }])
  })

  it('preserves a multi-line value verbatim, including an internal blank line', () => {
    const text = '**Matcher / matcher ikke**\nMatcher: A.\nMatcher ikke: B.'
    expect(parseDnaFields(text)).toEqual([{ label: 'Matcher / matcher ikke', value: 'Matcher: A.\nMatcher ikke: B.' }])
  })

  it('returns an empty array for text with no "**Heading**" markers, so the caller can fall back to raw text', () => {
    expect(parseDnaFields('plain unstructured text')).toEqual([])
  })

  it('returns an empty array for empty input', () => {
    expect(parseDnaFields('')).toEqual([])
  })
})
