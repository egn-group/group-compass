import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AdminUsers from './AdminUsers'

const chair = { email: 'chair@example.com', name: 'Chair Person', initials: 'CP', roles: ['Chair'] }

function mockFetch(handlers: { getUsers?: unknown; putUsers?: { status: number; body: unknown } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/getUsers') {
      return { ok: true, status: 200, json: async () => handlers.getUsers ?? [] }
    }
    if (url === '/api/putUsers') {
      const { status, body } = handlers.putUsers ?? { status: 200, body: {} }
      return { ok: status < 300, status, json: async () => body }
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method}`)
  })
}

describe('AdminUsers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and renders the user list', async () => {
    vi.stubGlobal('fetch', mockFetch({ getUsers: [chair] }))
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('chair@example.com')).toBeInTheDocument()
    })
    expect(within(screen.getByRole('table')).getByText('Chair')).toBeInTheDocument()
  })

  it('shows the server error message when a write is rejected (e.g. non-admin caller)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ getUsers: [], putUsers: { status: 403, body: { error: 'Admin access required.' } } }),
    )
    render(<AdminUsers />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Person' } })
    fireEvent.change(screen.getByLabelText('Initials'), { target: { value: 'NP' } })
    fireEvent.click(screen.getByLabelText('Chair'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Admin access required.')
    })
  })

  it('submits the form with the chosen roles on success', async () => {
    const fetchMock = mockFetch({ getUsers: [], putUsers: { status: 200, body: chair } })
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminUsers />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: chair.email } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: chair.name } })
    fireEvent.change(screen.getByLabelText('Initials'), { target: { value: chair.initials } })
    fireEvent.click(screen.getByLabelText('Chair'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putUsers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: chair.email, name: chair.name, initials: chair.initials, roles: ['Chair'] }),
        }),
      )
    })
  })
})
