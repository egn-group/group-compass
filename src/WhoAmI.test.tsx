import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WhoAmI from './WhoAmI'

describe('WhoAmI', () => {
  it('shows the signed-in email when given one', () => {
    render(<WhoAmI email="chair@example.com" />)
    expect(screen.getByTestId('who-am-i')).toHaveTextContent('Signed in as chair@example.com')
  })

  it('shows a loading state when email is not yet known', () => {
    render(<WhoAmI email={null} />)
    expect(screen.getByTestId('who-am-i')).toHaveTextContent('Loading…')
  })

  it('always renders a sign-out link pointing at the SWA logout endpoint', () => {
    render(<WhoAmI email="x@example.com" />)
    const link = screen.getByText('Sign out')
    expect(link).toHaveAttribute('href', '/.auth/logout')
  })
})
