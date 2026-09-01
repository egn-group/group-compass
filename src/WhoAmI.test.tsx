import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import WhoAmI from './WhoAmI'

describe('WhoAmI', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the signed-in caller\'s email from /api/getMe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/getMe') return { ok: true, status: 200, json: async () => ({ email: 'chair@example.com' }) }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )
    render(<WhoAmI />)

    await waitFor(() => {
      expect(screen.getByTestId('who-am-i')).toHaveTextContent('Signed in as chair@example.com')
    })
  })

  it('shows an error when the identity call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )
    render(<WhoAmI />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load your identity (401).')
    })
  })

  it('always renders a sign-out link pointing at the SWA logout endpoint', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ email: 'x@example.com' }) })))
    render(<WhoAmI />)

    const link = screen.getByText('Sign out')
    expect(link).toHaveAttribute('href', '/.auth/logout')
  })
})
