import { render, screen, fireEvent, waitFor } from './test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import NaComments from './NaComments'

const group = {
  id: 'group-1',
  name: 'Test Group',
  chairName: 'Chair Person',
  groupProfile: 'GROUP TEXT',
  memberProfile: 'MEMBER TEXT',
  companiesProfile: 'COMPANIES TEXT',
}

function mockFetch(handlers: {
  getNaGroups?: { groups: unknown[]; showGuidance: boolean }
  putNaComments?: { status: number; body: unknown }
  dismissNaGuidance?: { status: number }
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/getNaGroups') {
      return { ok: true, status: 200, json: async () => handlers.getNaGroups ?? { groups: [], showGuidance: false } }
    }
    if (url === '/api/putNaComments') {
      const { status, body } = handlers.putNaComments ?? { status: 200, body: { groupId: '', lifecycleStatus: 'ChairReview' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/dismissNaGuidance') {
      const { status } = handlers.dismissNaGuidance ?? { status: 200 }
      return { ok: status < 300, status, json: async () => ({ hasSeenNaGuidance: true }) }
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method}`)
  })
}

describe('NaComments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there are no groups waiting', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('No groups are waiting for your comment right now.')).toBeInTheDocument()
    })
  })

  it('renders a group with its three profile fields, and no guidance banner when already seen', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [group], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(screen.getByText('GROUP TEXT')).toBeInTheDocument()
    expect(screen.getByText('MEMBER TEXT')).toBeInTheDocument()
    expect(screen.getByText('COMPANIES TEXT')).toBeInTheDocument()
    expect(screen.queryByText('Got it')).not.toBeInTheDocument()
  })

  it('shows the first-time guidance banner and dismisses it on click, notifying the server', async () => {
    const fetchMock = mockFetch({ getNaGroups: { groups: [], showGuidance: true } })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Got it')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Got it'))

    expect(screen.queryByText('Got it')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/dismissNaGuidance', { method: 'POST' })
    })
  })

  it('blocks sending to the Chair when no comment was entered', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [group], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Send to Chair'))

    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one comment before sending to the Chair.')
  })

  it('sends only the filled-in comments and removes the group from the list on success', async () => {
    const fetchMock = mockFetch({ getNaGroups: { groups: [group], showGuidance: false } })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    // Fill only the Group Profile comment textarea (the first "Comment for the Chair" field).
    const textareas = screen.getAllByLabelText('Comment for the Chair (optional)')
    fireEvent.change(textareas[0], { target: { value: 'check this section' } })
    fireEvent.click(screen.getByText('Send to Chair'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putNaComments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ groupId: 'group-1', comments: [{ field: 'GroupProfile', text: 'check this section' }] }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Test Group')).not.toBeInTheDocument()
    })
  })

  it('shows the server error message when sending is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        getNaGroups: { groups: [group], showGuidance: false },
        putNaComments: { status: 400, body: { error: 'Group is not awaiting a Network Advisor comment.' } },
      }),
    )
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    const textareas = screen.getAllByLabelText('Comment for the Chair (optional)')
    fireEvent.change(textareas[0], { target: { value: 'check this' } })
    fireEvent.click(screen.getByText('Send to Chair'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Group is not awaiting a Network Advisor comment.')
    })
    expect(screen.getByText('Test Group')).toBeInTheDocument()
  })

  it('sends x-view-as-email, disables comment textareas, and hides Send/guidance when viewAsEmail is set (Admin "View as" preview)', async () => {
    const fetchMock = mockFetch({ getNaGroups: { groups: [group], showGuidance: true } })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments viewAsEmail="na@example.com" />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/getNaGroups', expect.objectContaining({ headers: { 'x-view-as-email': 'na@example.com' } }))

    // No affordance to mutate anything — read-only, full stop.
    expect(screen.queryByText('Send to Chair')).not.toBeInTheDocument()
    expect(screen.queryByText('Got it')).not.toBeInTheDocument()
    for (const textarea of screen.getAllByLabelText('Comment for the Chair (optional)')) {
      expect(textarea).toBeDisabled()
    }
  })
})
