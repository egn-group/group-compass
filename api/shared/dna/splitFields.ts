// Ported from prototypes/group-dna-live-prototype/server.js's grabSection
// / splitIntoFields: splits a single templated DNA text blob (Stage 1/2's
// output, using the template's own GRUPPEPROFIL / MEDLEMSPROFIL /
// VIRKSOMHEDSPROFIL section headers) back into the 3 fields DnaVersion.content
// and DnaField both expect. If the model didn't include those headers
// verbatim, everything falls into groupProfile rather than silently
// dropping content.
import type { DnaContent } from '../../../shared/schemas/dna'

function grabSection(text: string, startRe: RegExp, endRe: RegExp | null): string {
  const s = text.search(startRe)
  if (s < 0) return ''
  const rest = text.slice(s + 1)
  const e = endRe ? rest.search(endRe) : -1
  const chunk = e >= 0 ? text.slice(s, s + 1 + e) : text.slice(s)
  return chunk.trim()
}

export function splitIntoFields(dnaText: string): DnaContent {
  const text = dnaText || ''
  let groupProfile = grabSection(text, /GRUPPEPROFIL/i, /MEDLEMSPROFIL/i)
  const memberProfile = grabSection(text, /MEDLEMSPROFIL/i, /VIRKSOMHEDSPROFIL/i)
  const companiesProfile = grabSection(text, /VIRKSOMHEDSPROFIL/i, null)
  if (!groupProfile && !memberProfile && !companiesProfile) {
    groupProfile = text.trim()
  }
  return { groupProfile, memberProfile, companiesProfile }
}
