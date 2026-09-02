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

  it('gives an Admin a Groups tab (default) and a Users tab, switching between them', async () => {
    vi.stubGlobal('fetch', mockFetch(['Admin']))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Groups', { selector: 'h2' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument()
    // Groups is the default tab — Users' own content isn't shown yet.
    expect(screen.queryByText('Users', { selector: 'h2' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Users' }))
    await waitFor(() => expect(screen.getByText('Users', { selector: 'h2' })).toBeInTheDocument())
    // Switching tabs actually swaps the content — Groups' own content is gone.
    expect(screen.queryByText('Groups', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('gives a Network Advisor a single "My groups" tab', async () => {
    vi.stubGlobal('fetch', mockFetch(['NetworkAdvisor']))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Network Advisor — comment on your groups')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'My groups' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Groups' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('gives a Chair a single "My groups" tab', async () => {
    vi.stubGlobal('fetch', mockFetch(['Chair']))
    render(<App />)

    // Both the tab button and ChairReview's own heading read "My groups".
    await waitFor(() => expect(screen.getAllByText('My groups')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'My groups' })).toBeInTheDocument()
  })

  it('shows only the Users tab (no Groups tab) for a signed-in caller with no roles yet', async () => {
    vi.stubGlobal('fetch', mockFetch([]))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Users', { selector: 'h2' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Groups' })).not.toBeInTheDocument()
    expect(screen.queryByText('Groups', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('shows a fallback message for a role with no screens built yet', async () => {
    vi.stubGlobal('fetch', mockFetch(['SalesLeader']))
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('No screens are available for your role(s) yet.')).toBeInTheDocument()
    })
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
