import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AdminUsers from './AdminUsers'

const chair = { email: 'chair@example.com', name: 'Chair Person', initials: 'CP', roles: ['Chair'] }

function mockFetch(handlers: {
  getUsers?: unknown
  putUsers?: { status: number; body: unknown } | ((body: unknown) => { status: number; body: unknown })
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/getUsers') {
      return { ok: true, status: 200, json: async () => handlers.getUsers ?? [] }
    }
    if (url === '/api/putUsers') {
      const resolved =
        typeof handlers.putUsers === 'function'
          ? handlers.putUsers(init?.body ? JSON.parse(init.body as string) : null)
          : (handlers.putUsers ?? { status: 200, body: {} })
      return { ok: resolved.status < 300, status: resolved.status, json: async () => resolved.body }
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method}`)
  })
}

// Reads a File as an ArrayBuffer the way the component's own FileReader
// does, so a fireEvent.change with a real File actually triggers parsing —
// jsdom's FileReader needs a real event loop tick to fire onload.
function csvFile(text: string): File {
  return new File([new TextEncoder().encode(text)], 'users.csv', { type: 'text/csv' })
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

  it('parses a users CSV, shows a preview, and imports each row (including multi-role cells) on confirm', async () => {
    const fetchMock = mockFetch({ getUsers: [], putUsers: { status: 200, body: {} } })
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminUsers />)

    const csv = 'Email,Name,Initials,Role\nchair@example.com,Chair Person,CP,Chair\nboth@example.com,Both Person,BP,Chair;NetworkAdvisor\n'
    const input = screen.getByLabelText('Users CSV file')
    fireEvent.change(input, { target: { files: [csvFile(csv)] } })

    await waitFor(() => {
      expect(screen.getByText('Confirm import (2)')).toBeInTheDocument()
    })
    expect(screen.getByText('chair@example.com')).toBeInTheDocument()
    expect(screen.getByText('Chair;NetworkAdvisor')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Confirm import (2)'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putUsers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'both@example.com', name: 'Both Person', initials: 'BP', roles: ['Chair', 'NetworkAdvisor'] }),
        }),
      )
    })
    // The list refreshes and the preview clears once import completes.
    await waitFor(() => {
      expect(screen.queryByText('Confirm import (2)')).not.toBeInTheDocument()
    })
  })

  it('flags an invalid row (bad role) as a rejection, without blocking the valid rows', async () => {
    vi.stubGlobal('fetch', mockFetch({ getUsers: [] }))
    render(<AdminUsers />)

    const csv = 'Email,Name,Initials,Role\nchair@example.com,Chair Person,CP,Chair\nbad@example.com,Bad Person,BX,NotARealRole\n'
    fireEvent.change(screen.getByLabelText('Users CSV file'), { target: { files: [csvFile(csv)] } })

    await waitFor(() => {
      expect(screen.getByText('Rows that will be rejected (invalid)')).toBeInTheDocument()
    })
    expect(screen.getByText('Confirm import (1)')).toBeInTheDocument()
  })

  it('shows an error banner for a CSV missing a required column', async () => {
    vi.stubGlobal('fetch', mockFetch({ getUsers: [] }))
    render(<AdminUsers />)

    const csv = 'Email,Name,Initials\nchair@example.com,Chair Person,CP\n'
    fireEvent.change(screen.getByLabelText('Users CSV file'), { target: { files: [csvFile(csv)] } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Missing required columns')
    })
    expect(screen.queryByText(/Confirm import/)).not.toBeInTheDocument()
  })

  it('rejects a non-UTF-8 users CSV with a clear banner', async () => {
    vi.stubGlobal('fetch', mockFetch({ getUsers: [] }))
    render(<AdminUsers />)

    const badBytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0xe6])
    const file = new File([badBytes], 'users.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Users CSV file'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This file is not saved as UTF-8 — import blocked')
    })
  })

  it('preserves a role not exposed in the UI when editing and saving a user', async () => {
    const chairLeader = { email: 'lead@example.com', name: 'Chair Leader', initials: 'CL', roles: ['ChairLeader'] }
    const fetchMock = mockFetch({ getUsers: [chairLeader], putUsers: { status: 200, body: chairLeader } })
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminUsers />)

    await waitFor(() => {
      expect(screen.getByText('lead@example.com')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putUsers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: chairLeader.email,
            name: chairLeader.name,
            initials: chairLeader.initials,
            roles: ['ChairLeader'],
          }),
        }),
      )
    })
  })
})
