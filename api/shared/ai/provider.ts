// Single switch point for which LLM provider client.ts calls through. One
// branch today — extend when a second provider is actually wired in, not
// before (see api/shared/ai/types.ts for the interface every provider
// satisfies).

import { anthropicProvider } from './anthropicProvider'
import type { AiProvider } from './types'

export function getAiProvider(): AiProvider {
  const name = process.env.AI_PROVIDER ?? 'anthropic'
  switch (name) {
    case 'anthropic':
      return anthropicProvider
    default:
      throw new Error(`Unknown AI_PROVIDER "${name}".`)
  }
}
