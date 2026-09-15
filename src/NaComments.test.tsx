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
  lifecycleStatus: 'Launched',
  comments: [],
}

function mockFetch(handlers: {
  getNaGroups?: { groups: unknown[]; showGuidance: boolean } | (() => { groups: unknown[]; showGuidance: boolean })
  putNaComments?: { status: number; body: unknown }
  dismissNaGuidance?: { status: number }
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/getNaGroups') {
      const resolved = typeof handlers.getNaGroups === 'function' ? handlers.getNaGroups() : (handlers.getNaGroups ?? { groups: [], showGuidance: false })
      return { ok: true, status: 200, json: async () => resolved }
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

  it('shows the empty state when no groups are assigned', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('No groups have been assigned to you yet.')).toBeInTheDocument()
    })
  })

  it('lists groups by name/chair/status without their field content, and opens the detail view on click', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [group], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(screen.getByText('Chair Person')).toBeInTheDocument()
    expect(screen.getByText('Needs your comment')).toBeInTheDocument()
    // The list view shows no field content — only the detail view does.
    expect(screen.queryByText('GROUP TEXT')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText('GROUP TEXT')).toBeInTheDocument()
    })
    expect(screen.getByText('MEMBER TEXT')).toBeInTheDocument()
    expect(screen.getByText('COMPANIES TEXT')).toBeInTheDocument()
  })

  it('shows the first-time guidance banner on the list, and dismisses it on click, notifying the server', async () => {
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

  it('no guidance banner once already seen', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [group], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(screen.queryByText('Got it')).not.toBeInTheDocument()
  })

  it('blocks sending to the Chair when no comment was entered', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [group], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Send to Chair')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Send to Chair'))

    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one comment before sending to the Chair.')
  })

  it('sends only the filled-in comments, then shows the group as read-only once its status flips', async () => {
    // getNaGroups is re-fetched after a successful send (invalidateQueries) —
    // this mock reflects the server-side lifecycleStatus transition that
    // putNaComments actually performs, so the refetch sees 'ChairReview'.
    let status = 'Launched'
    const fetchMock = mockFetch({ getNaGroups: () => ({ groups: [{ ...group, lifecycleStatus: status }], showGuidance: false }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Send to Chair')).toBeInTheDocument())

    // Fill only the Group Profile comment textarea (the first "Comment for the Chair" field).
    const textareas = screen.getAllByLabelText('Comment for the Chair (optional)')
    fireEvent.change(textareas[0], { target: { value: 'check this section' } })
    status = 'ChairReview'
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
    // Still open on this group's detail, but now read-only: badge shown, no more Send/comment inputs.
    await waitFor(() => {
      expect(screen.getByText('Sent — waiting on the Chair')).toBeInTheDocument()
    })
    expect(screen.queryByText('Send to Chair')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Comment for the Chair (optional)')).not.toBeInTheDocument()
  })

  it('shows an "Approved by Chair" badge in the list and detail, still read-only, once the Chair has approved', async () => {
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [{ ...group, lifecycleStatus: 'Approved' }], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Approved by Chair')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())
    expect(screen.getByText('Approved by Chair')).toBeInTheDocument()
    expect(screen.queryByText('Send to Chair')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Comment for the Chair (optional)')).not.toBeInTheDocument()
  })

  it('shows the NA\'s own already-sent comments read-only once the group is in ChairReview ("Sent") status', async () => {
    const sentGroup = {
      ...group,
      lifecycleStatus: 'ChairReview',
      comments: [{ field: 'GroupProfile', text: 'Please double-check this section.', createdAt: new Date().toISOString() }],
    }
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [sentGroup], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())
    expect(screen.getByText('Please double-check this section.')).toBeInTheDocument()
    // No comment box for a field with nothing sent on it.
    expect(screen.queryByLabelText('Comment for the Chair (optional)')).not.toBeInTheDocument()
  })

  it('shows nothing extra for a field with no comment sent, once the group is read-only', async () => {
    const sentGroup = { ...group, lifecycleStatus: 'ChairReview', comments: [] }
    vi.stubGlobal('fetch', mockFetch({ getNaGroups: { groups: [sentGroup], showGuidance: false } }))
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())
    expect(screen.queryByText('Your comment:')).not.toBeInTheDocument()
  })

  it('renders bold DNA field headlines instead of raw markdown', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ getNaGroups: { groups: [{ ...group, groupProfile: '**Hvem er gruppen for**\nCEOs only.' }], showGuidance: false } }),
    )
    render(<NaComments />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText('Hvem er gruppen for')).toBeInTheDocument()
    })
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Send to Chair')).toBeInTheDocument())

    const textareas = screen.getAllByLabelText('Comment for the Chair (optional)')
    fireEvent.change(textareas[0], { target: { value: 'check this' } })
    fireEvent.click(screen.getByText('Send to Chair'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Group is not awaiting a Network Advisor comment.')
    })
    expect(screen.getByText('GROUP TEXT')).toBeInTheDocument()
  })

  it('sends x-view-as-email and hides every mutating affordance when viewAsEmail is set (Admin "View as" preview)', async () => {
    const fetchMock = mockFetch({ getNaGroups: { groups: [group], showGuidance: true } })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments viewAsEmail="na@example.com" />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/getNaGroups', expect.objectContaining({ headers: { 'x-view-as-email': 'na@example.com' } }))
    // No guidance banner on the list either, in read-only preview.
    expect(screen.queryByText('Got it')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    // No affordance to mutate anything — read-only, full stop.
    expect(screen.queryByText('Send to Chair')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Comment for the Chair (optional)')).not.toBeInTheDocument()
  })

  it('lets an Admin actually send a comment as the NA when viewAsCanEdit is set, attributed via the header', async () => {
    const fetchMock = mockFetch({ getNaGroups: { groups: [group], showGuidance: false } })
    vi.stubGlobal('fetch', fetchMock)
    render(<NaComments viewAsEmail="na@example.com" viewAsCanEdit />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    // Enabled, not read-only, once the Admin has opted into "Enable actions".
    const textareas = screen.getAllByLabelText('Comment for the Chair (optional)')
    for (const textarea of textareas) expect(textarea).not.toBeDisabled()
    fireEvent.change(textareas[0], { target: { value: 'commenting as the NA, via Admin acting-as' } })
    fireEvent.click(screen.getByText('Send to Chair'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putNaComments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-view-as-email': 'na@example.com' }),
          body: JSON.stringify({ groupId: 'group-1', comments: [{ field: 'GroupProfile', text: 'commenting as the NA, via Admin acting-as' }] }),
        }),
      )
    })
  })
})
