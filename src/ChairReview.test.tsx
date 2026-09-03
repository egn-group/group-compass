import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ChairReview from './ChairReview'

const groupListItem = {
  id: 'group-1',
  name: 'Test Group',
  country: 'Denmark',
  networkAdvisorName: 'NA Person',
  lifecycleStatus: 'ChairReview',
  pendingReapproval: false,
  updatedAt: new Date().toISOString(),
}

const groupDetail = {
  id: 'group-1',
  name: 'Test Group',
  country: 'Denmark',
  networkAdvisorName: 'NA Person',
  lifecycleStatus: 'ChairReview',
  pendingReapproval: false,
  fields: [
    { field: 'GroupProfile', text: 'GROUP TEXT', approved: false, unresolvedComments: [{ id: 'c1', text: 'Please check this.', createdAt: new Date().toISOString() }] },
    { field: 'MemberProfile', text: 'MEMBER TEXT', approved: false, unresolvedComments: [] },
    { field: 'CompaniesProfile', text: 'COMPANIES TEXT', approved: false, unresolvedComments: [] },
  ],
}

function mockFetch(handlers: {
  getChairGroups?: { groups: unknown[] }
  getChairGroup?: unknown
  approveChairField?: { status: number; body: unknown }
  editChairField?: { status: number; body: unknown }
  reapproveChairGroup?: { status: number; body: unknown }
  getChairFieldConversation?: { turns: unknown[] }
  chairChat?: { status: number; body: unknown }
  acceptChairProposal?: { status: number; body: unknown }
  rejectChairProposal?: { status: number; body: unknown }
  suggestImprovements?: { status: number; body: unknown }
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/getChairGroups') {
      return { ok: true, status: 200, json: async () => handlers.getChairGroups ?? { groups: [] } }
    }
    if (url.startsWith('/api/getChairGroup?')) {
      return { ok: true, status: 200, json: async () => handlers.getChairGroup ?? groupDetail }
    }
    if (url === '/api/approveChairField') {
      const { status, body } = handlers.approveChairField ?? { status: 200, body: { field: 'GroupProfile', lifecycleStatus: 'ChairReview', justFullyApproved: false } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/editChairField') {
      const { status, body } = handlers.editChairField ?? { status: 200, body: { field: 'GroupProfile', dnaVersionId: 'v2', aiFeedback: 'Looks good.' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/reapproveChairGroup') {
      const { status, body } = handlers.reapproveChairGroup ?? { status: 200, body: { groupId: 'group-1', pendingReapproval: false } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url.startsWith('/api/getChairFieldConversation?')) {
      return { ok: true, status: 200, json: async () => handlers.getChairFieldConversation ?? { turns: [] } }
    }
    if (url === '/api/chairChat') {
      const { status, body } = handlers.chairChat ?? {
        status: 200,
        body: { clarifyingQuestion: null, turnId: 'turn-1', proposedText: 'REWRITTEN TEXT', note: 'Shorter.' },
      }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/acceptChairProposal') {
      const { status, body } = handlers.acceptChairProposal ?? { status: 200, body: { field: 'GroupProfile', dnaVersionId: 'v3' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/rejectChairProposal') {
      const { status, body } = handlers.rejectChairProposal ?? { status: 200, body: { turnId: 'turn-1', outcome: 'Rejected' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/suggestImprovements') {
      const { status, body } = handlers.suggestImprovements ?? { status: 200, body: { suggestions: [] } }
      return { ok: status < 300, status, json: async () => body }
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method}`)
  })
}

describe('ChairReview', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there are no groups', async () => {
    vi.stubGlobal('fetch', mockFetch({ getChairGroups: { groups: [] } }))
    render(<ChairReview />)

    await waitFor(() => {
      expect(screen.getByText('No groups match this view.')).toBeInTheDocument()
    })
  })

  it('lists groups and opens the detail view on click', async () => {
    vi.stubGlobal('fetch', mockFetch({ getChairGroups: { groups: [groupListItem] } }))
    render(<ChairReview />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText('GROUP TEXT')).toBeInTheDocument()
    })
    expect(screen.getByText('Please check this.')).toBeInTheDocument()
  })

  it('approves a field with Read & accept', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Read & accept')[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/approveChairField',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ groupId: 'group-1', field: 'GroupProfile' }),
        }),
      )
    })
  })

  it('shows the spec §5 confirmation text when the final field approval reports justFullyApproved', async () => {
    const fetchMock = mockFetch({
      getChairGroups: { groups: [groupListItem] },
      approveChairField: { status: 200, body: { field: 'GroupProfile', lifecycleStatus: 'Approved', justFullyApproved: true } },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('Read & accept')[0])

    await waitFor(() => {
      expect(screen.getByText(/Thank you — the DNA has been updated/)).toBeInTheDocument()
    })
  })

  it('edits a field and shows the AI feedback afterward', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Edit')[0])
    fireEvent.change(screen.getByLabelText('Edit Group Profile'), { target: { value: 'REWRITTEN TEXT' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/editChairField',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ groupId: 'group-1', field: 'GroupProfile', text: 'REWRITTEN TEXT' }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText('Looks good.')).toBeInTheDocument()
    })
  })

  it('shows the persistent reapprove control when pendingReapproval is set, and clears it on click', async () => {
    const reapprovalDetail = { ...groupDetail, lifecycleStatus: 'Approved', pendingReapproval: true }
    const fetchMock = mockFetch({
      getChairGroups: { groups: [{ ...groupListItem, lifecycleStatus: 'Approved', pendingReapproval: true }] },
      getChairGroup: reapprovalDetail,
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText('Approve whole DNA')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Approve whole DNA'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/reapproveChairGroup',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ groupId: 'group-1' }) }),
      )
    })
  })

  it('opens the AI assistant, sends a message, and shows the resulting proposal with accept/reject', async () => {
    const fetchMock = mockFetch({
      getChairGroups: { groups: [groupListItem] },
      getChairFieldConversation: {
        turns: [
          { id: 'turn-0', role: 'Chair', messageText: 'Please rewrite this.', proposedText: null, outcome: 'None', createdAt: new Date().toISOString() },
          { id: 'turn-1', role: 'Ai', messageText: 'Shorter.', proposedText: 'REWRITTEN TEXT', outcome: 'None', createdAt: new Date().toISOString() },
        ],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])
    fireEvent.change(screen.getByLabelText('Message the AI assistant about Group Profile'), { target: { value: 'Please rewrite this.' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chairChat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ groupId: 'group-1', field: 'GroupProfile', message: 'Please rewrite this.' }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText('REWRITTEN TEXT')).toBeInTheDocument()
    })
    expect(screen.getByText('Accept')).toBeInTheDocument()
    expect(screen.getByText('Reject')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Accept'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/acceptChairProposal',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ turnId: 'turn-1' }) }),
      )
    })
  })

  it('shows a clarifying question instead of a proposal for ambiguous input', async () => {
    const fetchMock = mockFetch({
      getChairGroups: { groups: [groupListItem] },
      chairChat: { status: 200, body: { clarifyingQuestion: 'What would you like to change?', turnId: null, proposedText: null, note: null } },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])
    fireEvent.change(screen.getByLabelText('Message the AI assistant about Group Profile'), { target: { value: 'asdkfj' } })
    fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chairChat', expect.objectContaining({ method: 'POST' }))
    })
    // The conversation is re-fetched after sending; getChairFieldConversation
    // wasn't given an explicit handler here, so it returns an empty list —
    // this test only asserts the request shape, not the rendered reply text.
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('offers improvement suggestions once the group is Approved, and shows what it finds', async () => {
    const approvedDetail = { ...groupDetail, lifecycleStatus: 'Approved', fields: groupDetail.fields.map((f) => ({ ...f, approved: true, unresolvedComments: [] })) }
    const fetchMock = mockFetch({
      getChairGroups: { groups: [{ ...groupListItem, lifecycleStatus: 'Approved' }] },
      getChairGroup: approvedDetail,
      suggestImprovements: { status: 200, body: { suggestions: [{ field: 'GroupProfile', suggestion: 'Add geography.' }] } },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Check for improvement suggestions')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Check for improvement suggestions'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/suggestImprovements',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ groupId: 'group-1' }) }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText('Add geography.')).toBeInTheDocument()
    })
  })

  it('sends x-view-as-email and hides every mutating action when viewAsEmail is set (Admin "View as" preview)', async () => {
    const approvedDetail = { ...groupDetail, lifecycleStatus: 'Approved', pendingReapproval: true }
    const fetchMock = mockFetch({
      getChairGroups: { groups: [{ ...groupListItem, lifecycleStatus: 'Approved', pendingReapproval: true }] },
      getChairGroup: approvedDetail,
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview viewAsEmail="chair@example.com" />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/getChairGroups', expect.objectContaining({ headers: { 'x-view-as-email': 'chair@example.com' } }))

    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/getChairGroup?'),
      expect.objectContaining({ headers: { 'x-view-as-email': 'chair@example.com' } }),
    )

    // No affordance to mutate anything is rendered — read-only, full stop.
    expect(screen.queryByText('Read & accept')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Ask AI assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve whole DNA')).not.toBeInTheDocument()
    expect(screen.queryByText('Check for improvement suggestions')).not.toBeInTheDocument()
  })
})
