import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NotificationBell from './NotificationBell'

describe('NotificationBell', () => {
  it('opens an empty dropdown on click — dormant, no real notifications yet', () => {
    render(<NotificationBell />)
    expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Notifications'))
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Notifications'))
    expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument()
  })
})
