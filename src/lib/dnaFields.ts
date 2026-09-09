// The DNA generator (api/shared/dna/prompts.ts's TEMPLATE_SHAPE) emits each
// profile field as a "**Heading**" marker followed by its text, e.g.
// "GRUPPEPROFIL\n**Hvem er gruppen for**\nGruppen henvender sig til...".
// Parses that back into label/value pairs for display — never reflows,
// translates, or drops content; a heading with no body keeps its literal
// "(ikke eksplicit defineret)" value as-is.
export interface DnaFieldEntry {
  label: string
  value: string
}

const HEADING_RE = /\*\*(.+?)\*\*/g

export function parseDnaFields(text: string): DnaFieldEntry[] {
  if (!text) return []
  const matches = [...text.matchAll(HEADING_RE)]
  return matches.map((m, i) => {
    const start = m.index! + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    return { label: m[1].trim(), value: text.slice(start, end).trim() }
  })
}
