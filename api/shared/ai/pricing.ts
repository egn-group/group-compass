// Per-1M-token USD list pricing, keyed by model id — used only for the
// cost logged per call (CLAUDE_1.md), never for billing. Extend as new
// models are actually used; an unlisted model logs a null cost rather than
// guessing (same honesty policy as partnerCodeCountry.ts's lookup table).
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export function costForCall(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING_PER_MILLION_TOKENS[model]
  if (!pricing) return null
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}
