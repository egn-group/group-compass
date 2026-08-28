import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ message: 'pong' }),
      })),
    )
  })

  it('renders the placeholder page', () => {
    render(<App />)
    expect(screen.getByText('Group Compass')).toBeInTheDocument()
  })

  it('calls /api/ping and shows the response when the button is clicked', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Call /api/ping'))

    await waitFor(() => {
      expect(screen.getByTestId('api-result')).toHaveTextContent('pong')
    })
    expect(fetch).toHaveBeenCalledWith('/api/ping')
  })
})
