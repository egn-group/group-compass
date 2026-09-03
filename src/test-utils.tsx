import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'

export * from '@testing-library/react'

export function render(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options)
}
