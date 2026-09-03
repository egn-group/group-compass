import type { HttpRequest } from '@azure/functions'
import { describe, expect, it } from 'vitest'
import { getPrincipal, requireAdmin, requireAdminOrChairLeader, requireAuth, requireChair, requireNetworkAdvisor, resolveViewAs } from './auth'

function reqWithHeader(value?: string): HttpRequest {
  return { headers: value === undefined ? {} : { 'x-ms-client-principal': value } } as unknown as HttpRequest
}

function reqWithViewAs(viewAsEmail?: string): HttpRequest {
  return { headers: viewAsEmail === undefined ? {} : { 'x-view-as-email': viewAsEmail } } as unknown as HttpRequest
}

function principalHeader(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
}

describe('getPrincipal', () => {
  it('returns null when the header is missing', () => {
    expect(getPrincipal(reqWithHeader())).toBeNull()
  })

  it('returns null when the header is not valid base64/JSON', () => {
    expect(getPrincipal(reqWithHeader('not-base64-json'))).toBeNull()
  })

  it('returns null when userDetails is absent', () => {
    const header = principalHeader({ userId: 'abc' })
    expect(getPrincipal(reqWithHeader(header))).toBeNull()
  })

  it('decodes a valid principal and lowercases the email', () => {
    const header = principalHeader({ userId: 'abc', userDetails: 'Admin@Example.com' })
    expect(getPrincipal(reqWithHeader(header))).toEqual({ userId: 'abc', email: 'admin@example.com' })
  })
})

describe('requireAuth', () => {
  it('returns a 401 response when there is no principal', () => {
    const result = requireAuth(reqWithHeader())
    expect(result?.status).toBe(401)
  })

  it('returns null (allowed) when a valid principal is present', () => {
    const header = principalHeader({ userId: 'abc', userDetails: 'user@example.com' })
    expect(requireAuth(reqWithHeader(header))).toBeNull()
  })
})

describe('requireAdmin', () => {
  it('returns a 403 response when the user is null (no stored User row)', () => {
    const result = requireAdmin(null)
    expect(result?.status).toBe(403)
  })

  it('returns a 403 response when the user lacks the Admin role', () => {
    const result = requireAdmin({ roles: ['Chair'] })
    expect(result?.status).toBe(403)
  })

  it('returns null (allowed) when the user has the Admin role', () => {
    expect(requireAdmin({ roles: ['Admin'] })).toBeNull()
    expect(requireAdmin({ roles: ['Chair', 'Admin'] })).toBeNull()
  })
})

describe('requireNetworkAdvisor', () => {
  it('returns a 403 response when the user is null (no stored User row)', () => {
    const result = requireNetworkAdvisor(null)
    expect(result?.status).toBe(403)
  })

  it('returns a 403 response when the user lacks the NetworkAdvisor role', () => {
    const result = requireNetworkAdvisor({ roles: ['Chair'] })
    expect(result?.status).toBe(403)
  })

  it('returns null (allowed) when the user has the NetworkAdvisor role', () => {
    expect(requireNetworkAdvisor({ roles: ['NetworkAdvisor'] })).toBeNull()
    expect(requireNetworkAdvisor({ roles: ['Chair', 'NetworkAdvisor'] })).toBeNull()
  })
})

describe('requireAdminOrChairLeader', () => {
  it('returns a 403 response when the user is null (no stored User row)', () => {
    const result = requireAdminOrChairLeader(null)
    expect(result?.status).toBe(403)
  })

  it('returns a 403 response when the user has neither role', () => {
    const result = requireAdminOrChairLeader({ roles: ['Chair'] })
    expect(result?.status).toBe(403)
  })

  it('returns null (allowed) when the user has the Admin role', () => {
    expect(requireAdminOrChairLeader({ roles: ['Admin'] })).toBeNull()
  })

  it('returns null (allowed) when the user has the ChairLeader role', () => {
    expect(requireAdminOrChairLeader({ roles: ['ChairLeader'] })).toBeNull()
  })
})

describe('resolveViewAs', () => {
  const principal = { userId: 'abc', email: 'admin@example.com' }

  it('falls back to the caller\'s own email when no header is sent, even for a real Admin', () => {
    expect(resolveViewAs(reqWithViewAs(), principal, { roles: ['Admin'] })).toEqual({
      effectiveEmail: 'admin@example.com',
      isAdminViewingAs: false,
    })
  })

  it('ignores the header when the caller has no stored User row', () => {
    expect(resolveViewAs(reqWithViewAs('chair@example.com'), principal, null)).toEqual({
      effectiveEmail: 'admin@example.com',
      isAdminViewingAs: false,
    })
  })

  it('ignores the header when the real caller is not an Admin', () => {
    expect(resolveViewAs(reqWithViewAs('chair@example.com'), principal, { roles: ['Chair'] })).toEqual({
      effectiveEmail: 'admin@example.com',
      isAdminViewingAs: false,
    })
  })

  it('honors the header, lowercased, when the real caller is a genuine Admin', () => {
    expect(resolveViewAs(reqWithViewAs('Chair@Example.com'), principal, { roles: ['Admin'] })).toEqual({
      effectiveEmail: 'chair@example.com',
      isAdminViewingAs: true,
    })
  })
})

describe('requireChair', () => {
  it('returns a 403 response when the user is null (no stored User row)', () => {
    const result = requireChair(null)
    expect(result?.status).toBe(403)
  })

  it('returns a 403 response when the user lacks the Chair role', () => {
    const result = requireChair({ roles: ['NetworkAdvisor'] })
    expect(result?.status).toBe(403)
  })

  it('returns null (allowed) when the user has the Chair role', () => {
    expect(requireChair({ roles: ['Chair'] })).toBeNull()
  })
})
