import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Header from './Header'

describe('Header', () => {
  it('shows the app name, initials, and name', () => {
    render(<Header email="chair@example.com" name="Chair Person" initials="CP" isAdmin={false} onOpenViewAs={() => {}} />)

    expect(screen.getByText('Group Compass')).toBeInTheDocument()
    expect(screen.getByText('CP')).toBeInTheDocument()
    expect(screen.getByTestId('who-am-i')).toHaveTextContent('Chair Person')
  })

  it('falls back to the email (and its first letter) when name/initials are not yet loaded', () => {
    render(<Header email="chair@example.com" name={null} initials={null} isAdmin={false} onOpenViewAs={() => {}} />)

    expect(screen.getByTestId('who-am-i')).toHaveTextContent('chair@example.com')
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('shows "Loading…" when nothing has loaded yet', () => {
    render(<Header email={null} name={null} initials={null} isAdmin={false} onOpenViewAs={() => {}} />)
    expect(screen.getByTestId('who-am-i')).toHaveTextContent('Loading…')
  })

  it('shows the "View as…" button only for Admins, and calls the callback when clicked', () => {
    const onOpenViewAs = vi.fn()
    const { rerender } = render(<Header email="chair@example.com" name="Chair Person" initials="CP" isAdmin={false} onOpenViewAs={onOpenViewAs} />)
    expect(screen.queryByText('View as…')).not.toBeInTheDocument()

    rerender(<Header email="admin@example.com" name="Admin Person" initials="AD" isAdmin={true} onOpenViewAs={onOpenViewAs} />)
    fireEvent.click(screen.getByText('View as…'))
    expect(onOpenViewAs).toHaveBeenCalledTimes(1)
  })

  it('links Sign out to the SWA logout route', () => {
    render(<Header email="chair@example.com" name="Chair Person" initials="CP" isAdmin={false} onOpenViewAs={() => {}} />)
    expect(screen.getByLabelText('Sign out')).toHaveAttribute('href', '/.auth/logout')
  })
})
