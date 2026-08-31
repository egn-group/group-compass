import { describe, expect, it } from 'vitest'
import { splitIntoFields } from './splitFields'

const TEMPLATED_TEXT = `GRUPPEPROFIL
**Hvem er gruppen for**
Erfarne CEO'er i Danmark.

MEDLEMSPROFIL
**Titler / erfaring**
CEO eller adm. direktør.

VIRKSOMHEDSPROFIL
**Størrelse / type**
50-500 ansatte.`

describe('splitIntoFields', () => {
  it('splits a correctly templated blob into its 3 sections', () => {
    const result = splitIntoFields(TEMPLATED_TEXT)
    expect(result.groupProfile).toContain('Erfarne CEO')
    expect(result.groupProfile).not.toContain('MEDLEMSPROFIL')
    expect(result.memberProfile).toContain('CEO eller adm. direktør')
    expect(result.memberProfile).not.toContain('VIRKSOMHEDSPROFIL')
    expect(result.companiesProfile).toContain('50-500 ansatte')
  })

  it('is case-insensitive on the section headers', () => {
    const result = splitIntoFields(TEMPLATED_TEXT.toLowerCase())
    expect(result.groupProfile.toLowerCase()).toContain('erfarne ceo')
    expect(result.memberProfile.toLowerCase()).toContain('adm. direktør')
  })

  it('falls back to putting everything in groupProfile rather than dropping content, when no headers are present', () => {
    const result = splitIntoFields('Just some unstructured text with no headers at all.')
    expect(result.groupProfile).toBe('Just some unstructured text with no headers at all.')
    expect(result.memberProfile).toBe('')
    expect(result.companiesProfile).toBe('')
  })

  it('handles empty input without throwing', () => {
    const result = splitIntoFields('')
    expect(result).toEqual({ groupProfile: '', memberProfile: '', companiesProfile: '' })
  })
})
