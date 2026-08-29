import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ImportGroups from './ImportGroups'

const chair = { email: 'chair@example.com', name: 'Chair Person', initials: 'CP', roles: ['Chair'] }
const advisor = { email: 'na@example.com', name: 'NA Person', initials: 'NP', roles: ['NetworkAdvisor'] }

const group = {
  id: 'g1',
  egnGroupId: '38494',
  name: 'Test Group',
  mmsGroupCode: '02092-EGDK',
  partnerCode: 'EGDK',
  country: 'Denmark',
  chairEmail: null,
  networkAdvisorEmail: null,
  lifecycleStatus: 'Imported',
  noSourceDna: false,
  emptySectionCount: 1,
}

function mockFetch(handlers: {
  getUsers?: unknown
  getGroups?: unknown
  checkGroupImport?: unknown
  putGroups?: { status: number; body: unknown }
}) {
  return vi.fn(async (url: string) => {
    if (url === '/api/getUsers') return { ok: true, status: 200, json: async () => handlers.getUsers ?? [] }
    if (url === '/api/getGroups') return { ok: true, status: 200, json: async () => handlers.getGroups ?? [] }
    if (url === '/api/checkGroupImport') return { ok: true, status: 200, json: async () => handlers.checkGroupImport ?? [] }
    if (url === '/api/putGroups') {
      const { status, body } = handlers.putGroups ?? { status: 200, body: { created: [], overwritten: [] } }
      return { ok: status < 300, status, json: async () => body }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('ImportGroups', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders imported groups with quality chips', async () => {
    vi.stubGlobal('fetch', mockFetch({ getGroups: [group] }))
    render(<ImportGroups />)

    await waitFor(() => {
      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })
    expect(screen.getByText('1 empty section(s)')).toBeInTheDocument()
    expect(screen.getByText('no Chair')).toBeInTheDocument()
    expect(screen.getByText('no NA')).toBeInTheDocument()
  })

  it('checks a manually entered group and shows it in the review table', async () => {
    const fetchMock = mockFetch({
      getUsers: [chair, advisor],
      checkGroupImport: [
        {
          row: {
            egnGroupName: 'New Group',
            egnGroupId: '999',
            mmsGroupCode: 'MMS-1',
            partnerCode: 'EGDK',
            groupProfile: '',
            memberProfile: '',
            companiesProfile: '',
            responsibleChairName: 'Chair Person',
            responsibleSalesName: 'NA Person',
          },
          status: 'new',
          existingGroupId: null,
          suggestedChairEmail: chair.email,
          suggestedNetworkAdvisorEmail: advisor.email,
        },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ImportGroups />)

    fireEvent.change(screen.getByLabelText('EGN Group Name'), { target: { value: 'New Group' } })
    fireEvent.change(screen.getByLabelText('EGN Group Id'), { target: { value: '999' } })
    fireEvent.change(screen.getByLabelText('MMSGroup: Name'), { target: { value: 'MMS-1' } })
    fireEvent.change(screen.getByLabelText('Partner Code'), { target: { value: 'EGDK' } })
    fireEvent.change(screen.getByLabelText('Responsible Chair'), { target: { value: 'Chair Person' } })
    fireEvent.change(screen.getByLabelText('Responsible Sales'), { target: { value: 'NA Person' } })
    fireEvent.click(screen.getByText('Check group'))

    await waitFor(() => {
      expect(screen.getByText('Review before import')).toBeInTheDocument()
    })
    expect(screen.getByText('New Group')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    // Best-guess Chair/NA should be pre-selected.
    expect(screen.getByLabelText('Chair for New Group')).toHaveValue(chair.email)
    expect(screen.getByLabelText('Network Advisor for New Group')).toHaveValue(advisor.email)

    fireEvent.click(screen.getByText('Confirm import'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/putGroups',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"egnGroupId":"999"'),
        }),
      )
    })
  })

  it('rejects a non-UTF-8 CSV file with a clear banner', async () => {
    vi.stubGlobal('fetch', mockFetch({}))
    render(<ImportGroups />)

    // 0xE6 alone is invalid UTF-8 (a lone continuation-expecting lead byte).
    const badBytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0xe6])
    const file = new File([badBytes], 'groups.csv', { type: 'text/csv' })
    const input = screen.getByLabelText('CSV file')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This file is not saved as UTF-8 — import blocked')
    })
  })
})
