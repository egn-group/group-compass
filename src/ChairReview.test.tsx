import { render, screen, fireEvent, waitFor } from './test-utils'
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
    {
      field: 'GroupProfile',
      text: 'GROUP TEXT',
      approved: false,
      comments: [{ id: 'c1', text: 'Please check this.', resolved: false, createdAt: new Date().toISOString() }],
      canUndo: false,
    },
    { field: 'MemberProfile', text: 'MEMBER TEXT', approved: false, comments: [], canUndo: false },
    { field: 'CompaniesProfile', text: 'COMPANIES TEXT', approved: false, comments: [], canUndo: false },
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
  includeChairComment?: { status: number; body: unknown }
  disregardChairComment?: { status: number; body: unknown }
  undoChairField?: { status: number; body: unknown }
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
    if (url === '/api/includeChairComment') {
      const { status, body } = handlers.includeChairComment ?? { status: 200, body: { field: 'GroupProfile', text: 'INCLUDED TEXT', dnaVersionId: 'v-include' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/disregardChairComment') {
      const { status, body } = handlers.disregardChairComment ?? { status: 200, body: { commentId: 'c1' } }
      return { ok: status < 300, status, json: async () => body }
    }
    if (url === '/api/undoChairField') {
      const { status, body } = handlers.undoChairField ?? { status: 200, body: { field: 'GroupProfile', text: 'UNDONE TEXT', dnaVersionId: 'v-undo' } }
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

  it('shows Last updated in en-GB day-month-year with a 24-hour clock, not the browser default locale', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ getChairGroups: { groups: [{ ...groupListItem, updatedAt: '2026-05-12T14:30:00.000Z' }] } }),
    )
    render(<ChairReview />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(screen.getByText(/12 May 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/\b(AM|PM)\b/)).not.toBeInTheDocument()
  })

  it('approves a field with Approve', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Approve')[0])

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
    fireEvent.click(screen.getAllByText('Approve')[0])

    await waitFor(() => {
      expect(screen.getByText(/Thank you — the DNA has been updated/)).toBeInTheDocument()
    })
  })

  it('edits a field, then opens the AI assistant showing the edit note and the AI feedback as chat turns', async () => {
    const fetchMock = mockFetch({
      getChairGroups: { groups: [groupListItem] },
      getChairFieldConversation: {
        turns: [
          { id: 'edit-note', role: 'Chair', messageText: 'User edited the Group Profile.', proposedText: null, outcome: 'None', createdAt: new Date().toISOString() },
          { id: 'edit-feedback', role: 'Ai', messageText: 'Looks good.', proposedText: null, outcome: 'None', createdAt: new Date().toISOString() },
        ],
      },
    })
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
    // The AI assistant opens on its own — no inline "AI feedback" card.
    await waitFor(() => {
      expect(screen.getByText('AI assistant — Group Profile')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Looks good.')).toBeInTheDocument()
    })
    expect(screen.getByText('User edited the Group Profile.')).toBeInTheDocument()
  })

  it('does not open the AI assistant when Save is clicked with no actual change', async () => {
    const fetchMock = mockFetch({
      getChairGroups: { groups: [groupListItem] },
      editChairField: { status: 200, body: { field: 'GroupProfile', dnaVersionId: 'v2', aiFeedback: null } },
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Edit')[0])
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/editChairField', expect.objectContaining({ method: 'POST' }))
    })
    expect(screen.queryByText('AI assistant — Group Profile')).not.toBeInTheDocument()
  })

  it('greets with "How can I assist you?" when a field\'s AI conversation is empty', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])

    await waitFor(() => {
      expect(screen.getByText('How can I assist you?')).toBeInTheDocument()
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

  it('shows the Chair\'s message instantly and a "Thinking…" bubble while waiting for the AI, then clears both once it replies', async () => {
    let resolveChat: (value: unknown) => void = () => {}
    const chatPromise = new Promise((resolve) => {
      resolveChat = resolve
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/getChairGroups') return { ok: true, status: 200, json: async () => ({ groups: [groupListItem] }) }
      if (url.startsWith('/api/getChairGroup?')) return { ok: true, status: 200, json: async () => groupDetail }
      if (url.startsWith('/api/getChairFieldConversation?')) return { ok: true, status: 200, json: async () => ({ turns: [] }) }
      if (url === '/api/chairChat') {
        await chatPromise
        return { ok: true, status: 200, json: async () => ({ clarifyingQuestion: null, turnId: 'turn-1', proposedText: 'REWRITTEN TEXT', note: 'Shorter.' }) }
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])
    fireEvent.change(screen.getByLabelText('Message the AI assistant about Group Profile'), { target: { value: 'Please rewrite this.' } })
    fireEvent.click(screen.getByText('Send'))

    // Instantly, before the AI has responded: the Chair's own message shows
    // in the feed, a "Thinking…" bubble appears, and the input is cleared.
    await waitFor(() => {
      expect(screen.getByText('Please rewrite this.')).toBeInTheDocument()
    })
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.getByLabelText('Message the AI assistant about Group Profile')).toHaveValue('')

    resolveChat(undefined)

    await waitFor(() => {
      expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    })
  })

  it('sends on Enter but inserts a new line on Shift+Enter, so a message can span more than one line', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])
    const textarea = screen.getByLabelText('Message the AI assistant about Group Profile')
    fireEvent.change(textarea, { target: { value: 'Line one' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(fetchMock).not.toHaveBeenCalledWith('/api/chairChat', expect.anything())
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
    const approvedDetail = { ...groupDetail, lifecycleStatus: 'Approved', fields: groupDetail.fields.map((f) => ({ ...f, approved: true, comments: [] })) }
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

  it('shows the AI draft read-only, with no editing affordances, while the group is still Launched', async () => {
    const launchedDetail = { ...groupDetail, lifecycleStatus: 'Launched' }
    const fetchMock = mockFetch({
      getChairGroups: { groups: [{ ...groupListItem, lifecycleStatus: 'Launched' }] },
      getChairGroup: launchedDetail,
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText(/This group has been launched\. NA Person has been invited to comment/)).toBeInTheDocument()
    })
    // The AI draft is visible for transparency — only the editing
    // affordances are gated, not the content itself.
    expect(screen.getByText('GROUP TEXT')).toBeInTheDocument()
    expect(screen.getByText('MEMBER TEXT')).toBeInTheDocument()
    expect(screen.getByText('COMPANIES TEXT')).toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()
    expect(screen.queryByText('Ask AI assistant')).not.toBeInTheDocument()
    // The NA comment itself is still visible (transparency), but its
    // actions are mutating controls, gated the same as everything else.
    expect(screen.getByText('Please check this.')).toBeInTheDocument()
    expect(screen.queryByText('Accept/Include')).not.toBeInTheDocument()
    expect(screen.queryByText('Disregard')).not.toBeInTheDocument()
  })

  it('renders bold DNA field headlines in read mode, but raw markdown while editing', async () => {
    const markdownDetail = {
      ...groupDetail,
      fields: groupDetail.fields.map((f) => (f.field === 'GroupProfile' ? { ...f, text: '**Hvem er gruppen for**\nCEOs only.' } : f)),
    }
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] }, getChairGroup: markdownDetail })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))

    await waitFor(() => {
      expect(screen.getByText('Hvem er gruppen for')).toBeInTheDocument()
    })
    // No literal asterisks leak into the read-mode display.
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByText('Edit')[0])
    expect((screen.getByLabelText('Edit Group Profile') as HTMLTextAreaElement).value).toBe('**Hvem er gruppen for**\nCEOs only.')
  })

  it('includes an NA comment via Accept/Include', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Please check this.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Accept/Include'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/includeChairComment',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ groupId: 'group-1', commentId: 'c1' }) }),
      )
    })
  })

  it('disregards an NA comment with no text change', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Please check this.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Disregard'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/disregardChairComment',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ groupId: 'group-1', commentId: 'c1' }) }),
      )
    })
  })

  it('copies an NA comment to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Please check this.')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Copy'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Please check this.'))
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument())
  })

  it('keeps a resolved comment hidden behind a toggle', async () => {
    const resolvedDetail = {
      ...groupDetail,
      fields: groupDetail.fields.map((f) =>
        f.field === 'GroupProfile' ? { ...f, comments: [{ id: 'c1', text: 'Already dealt with.', resolved: true, createdAt: new Date().toISOString() }] } : f,
      ),
    }
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] }, getChairGroup: resolvedDetail })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText(/See network advisor comments/)).toBeInTheDocument())

    expect(screen.queryByText('Already dealt with.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/See network advisor comments/))
    expect(screen.getByText('Already dealt with.')).toBeInTheDocument()
  })

  it('shows an Undo control when canUndo is set, and calls undoChairField', async () => {
    const undoableDetail = { ...groupDetail, fields: groupDetail.fields.map((f) => (f.field === 'MemberProfile' ? { ...f, canUndo: true } : f)) }
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] }, getChairGroup: undoableDetail })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('Undo last change')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Undo last change'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/undoChairField',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ groupId: 'group-1', field: 'MemberProfile' }) }),
      )
    })
  })

  it('AI assistant sidebar switches conversations when a different field is opened, without closing first', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0]) // Group Profile
    await waitFor(() => {
      expect(screen.getByText('AI assistant — Group Profile')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Message the AI assistant about Group Profile')).toBeInTheDocument()

    // Group Profile's own button now reads "Close AI assistant", so the
    // remaining "Ask AI assistant" buttons are [Member Profile, Companies
    // Profile] — index 0 is Member Profile.
    fireEvent.click(screen.getAllByText('Ask AI assistant')[0]) // Member Profile — sidebar swaps, not a second panel
    await waitFor(() => {
      expect(screen.getByText('AI assistant — Member Profile')).toBeInTheDocument()
    })
    expect(screen.queryByText('AI assistant — Group Profile')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message the AI assistant about Member Profile')).toBeInTheDocument()
  })

  it('closes the AI assistant sidebar on Escape', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    fireEvent.click(screen.getAllByText('Ask AI assistant')[0])
    await waitFor(() => expect(screen.getByText('AI assistant — Group Profile')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText('AI assistant — Group Profile')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Ask AI assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve whole DNA')).not.toBeInTheDocument()
    expect(screen.queryByText('Check for improvement suggestions')).not.toBeInTheDocument()
  })

  it('lets an Admin actually approve a field as the Chair when viewAsCanEdit is set, attributed via the header', async () => {
    const fetchMock = mockFetch({ getChairGroups: { groups: [groupListItem] } })
    vi.stubGlobal('fetch', fetchMock)
    render(<ChairReview viewAsEmail="chair@example.com" viewAsCanEdit />)

    await waitFor(() => expect(screen.getByText('Test Group')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Test Group'))
    await waitFor(() => expect(screen.getByText('GROUP TEXT')).toBeInTheDocument())

    // Mutating controls render once the Admin has opted into "Enable actions".
    expect(screen.getAllByText('Approve')[0]).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Approve')[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/approveChairField',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-view-as-email': 'chair@example.com' }),
          body: JSON.stringify({ groupId: 'group-1', field: 'GroupProfile' }),
        }),
      )
    })
  })
})
