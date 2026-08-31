// scoreDnaPrompt (prompts.ts) instructs "output ONLY a single digit from 1
// to 5" — parsed strictly here rather than trusting free-form text, since
// prompt compliance isn't guaranteed. Anything else (extra words,
// punctuation, an out-of-range digit) is treated as the model not having
// followed the format, not as a score to salvage by guessing.
export function parseScore(rawText: string): number | null {
  const trimmed = rawText.trim()
  if (!/^[1-5]$/.test(trimmed)) return null
  return Number(trimmed)
}
