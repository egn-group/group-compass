import { describe, expect, it } from 'vitest'
import { resolveImportMatch } from './groupImportMatch'

const chair = { email: 'chair@example.com', name: 'Chair Person', roles: ['Chair'] }
const advisor = { email: 'na@example.com', name: 'NA Person', roles: ['NetworkAdvisor'] }
const users = [chair, advisor]

describe('resolveImportMatch', () => {
  it('matches a known email regardless of case/whitespace', () => {
    expect(resolveImportMatch(' Chair@Example.com ', 'irrelevant', 'Chair', users)).toEqual({
      email: 'chair@example.com',
      matchedByName: false,
    })
  })

  it('falls back to a name match when a given email matches no known user', () => {
    expect(resolveImportMatch('not-a-user-yet@example.com', 'Chair Person', 'Chair', users)).toEqual({
      email: 'chair@example.com',
      matchedByName: true,
    })
  })

  it('returns unmatched when a given email matches no user and the name matches none either', () => {
    expect(resolveImportMatch('not-a-user-yet@example.com', 'Someone Unknown', 'Chair', users)).toEqual({
      email: null,
      matchedByName: false,
    })
  })

  it('falls back to a name match when the email cell is blank', () => {
    expect(resolveImportMatch('', 'Chair Person', 'Chair', users)).toEqual({
      email: 'chair@example.com',
      matchedByName: true,
    })
  })

  it('name fallback is case/whitespace-insensitive', () => {
    expect(resolveImportMatch('  ', '  chair person  ', 'Chair', users)).toEqual({
      email: 'chair@example.com',
      matchedByName: true,
    })
  })

  it('scopes the name fallback to the given role, so a same-named user in the wrong role is not matched', () => {
    expect(resolveImportMatch('', 'Chair Person', 'NetworkAdvisor', users)).toEqual({
      email: null,
      matchedByName: false,
    })
  })

  it('returns unmatched when neither the email nor the name resolves to a known user', () => {
    expect(resolveImportMatch('', 'Someone Unknown', 'Chair', users)).toEqual({
      email: null,
      matchedByName: false,
    })
  })

  it('returns unmatched, not a guess, when two Users in the same role share a name', () => {
    const secondChair = { email: 'chair2@example.com', name: 'Chair Person', roles: ['Chair'] }
    expect(resolveImportMatch('', 'Chair Person', 'Chair', [...users, secondChair])).toEqual({
      email: null,
      matchedByName: false,
    })
  })
})
