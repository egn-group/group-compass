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
})
