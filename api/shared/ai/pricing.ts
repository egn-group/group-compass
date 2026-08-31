// Per-1M-token USD list pricing, keyed by model id — used only for the
// cost logged per call (CLAUDE_1.md), never for billing. Extend as new
// models are actually used; an unlisted model logs a null cost rather than
// guessing (same honesty policy as partnerCodeCountry.ts's lookup table).
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

// The API resolves some bare model aliases to a dated snapshot in its
// response (confirmed while building issue #22: requesting
// "claude-haiku-4-5" gets served by, and reports back, "claude-haiku-4-5-
// 20251001" — while "claude-sonnet-5" reports back unchanged). Strip a
// trailing date suffix before the lookup so pricing.ts only needs the
// bare id, regardless of which models the API happens to date-stamp.
function stripDateSuffix(model: string): string {
  return model.replace(/-\d{8}$/, '')
}

export function costForCall(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING_PER_MILLION_TOKENS[stripDateSuffix(model)]
  if (!pricing) return null
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}
