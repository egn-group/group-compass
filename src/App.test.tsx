import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App from './App.tsx'

function mockFetch(roles: string[]) {
  return vi.fn(async (url: string) => {
    if (url === '/api/getMe') return { ok: true, status: 200, json: async () => ({ email: 'me@example.com', roles }) }
    if (url === '/api/ping') return { ok: true, status: 200, json: async () => ({ message: 'pong' }) }
    if (url === '/api/getUsers') return { ok: true, status: 200, json: async () => [] }
    if (url === '/api/getGroups') return { ok: true, status: 200, json: async () => [] }
    if (url === '/api/getNaGroups') return { ok: true, status: 200, json: async () => ({ groups: [], showGuidance: false }) }
    if (url === '/api/getChairGroups') return { ok: true, status: 200, json: async () => ({ groups: [] }) }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('App', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the placeholder page and shows the signed-in identity', async () => {
    vi.stubGlobal('fetch', mockFetch([]))
    render(<App />)

    expect(screen.getByText('Group Compass')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('who-am-i')).toHaveTextContent('Signed in as me@example.com')
    })
  })

  it('calls /api/ping and shows the response when the button is clicked', async () => {
    vi.stubGlobal('fetch', mockFetch([]))
    render(<App />)
    fireEvent.click(screen.getByText('Call /api/ping'))

    await waitFor(() => {
      expect(screen.getByTestId('api-result')).toHaveTextContent('pong')
    })
    expect(fetch).toHaveBeenCalledWith('/api/ping')
  })

  it('shows only the Admin screens for an Admin', async () => {
    vi.stubGlobal('fetch', mockFetch(['Admin']))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())
    expect(screen.getByText('Import groups')).toBeInTheDocument()
    expect(screen.queryByText('Network Advisor — comment on your groups')).not.toBeInTheDocument()
    expect(screen.queryByText('My groups')).not.toBeInTheDocument()
  })

  it('shows only the Network Advisor screen for a Network Advisor', async () => {
    vi.stubGlobal('fetch', mockFetch(['NetworkAdvisor']))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Network Advisor — comment on your groups')).toBeInTheDocument())
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
    expect(screen.queryByText('Import groups')).not.toBeInTheDocument()
    expect(screen.queryByText('My groups')).not.toBeInTheDocument()
  })

  it('shows only the Chair screen for a Chair', async () => {
    vi.stubGlobal('fetch', mockFetch(['Chair']))
    render(<App />)

    await waitFor(() => expect(screen.getByText('My groups')).toBeInTheDocument())
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
    expect(screen.queryByText('Network Advisor — comment on your groups')).not.toBeInTheDocument()
  })

  it('shows the Users (bootstrap) section for a signed-in caller with no roles yet', async () => {
    vi.stubGlobal('fetch', mockFetch([]))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())
    expect(screen.queryByText('Import groups')).not.toBeInTheDocument()
  })

  it('shows a fallback message for a role with no screens built yet', async () => {
    vi.stubGlobal('fetch', mockFetch(['SalesLeader']))
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('No screens are available for your role(s) yet.')).toBeInTheDocument()
    })
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
  })

  it('shows an error when the identity call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/getMe') return { ok: false, status: 401, json: async () => ({}) }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load your identity (401).')
    })
  })
})
