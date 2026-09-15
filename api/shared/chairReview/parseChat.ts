// Parses CHAIR_CHAT_SYSTEM / SUGGEST_IMPROVEMENTS_SYSTEM's response formats
// (prompts.ts). Regexes ported VERBATIM from
// prototypes/group-dna-live-prototype/server.js's /api/chat and
// /api/suggest-improvements handlers — parsed strictly here rather than
// trusting free-form text, same reasoning as shared/dna/parseScore.ts.
import type { AiMessage } from '../ai/types'

export interface ChatParseResult {
  clarifyingQuestion: string | null
  proposedText: string | null
  note: string | null
}

export function parseChatResponse(raw: string): ChatParseResult {
  // The model can decline to propose an edit when the Chair's message
  // doesn't give it enough to work with (see the SPØRGSMÅL rule in
  // CHAIR_CHAT_SYSTEM) — a clarifying question, never a fabricated proposal.
  const questionMatch = raw.match(/SPØRGSMÅL:\s*([\s\S]*)/i)
  if (questionMatch) {
    return { clarifyingQuestion: questionMatch[1].trim(), proposedText: null, note: null }
  }
  const textMatch = raw.match(/TEKST:\s*([\s\S]*?)\nNOTE:/i)
  const noteMatch = raw.match(/NOTE:\s*([\s\S]*)/i)
  return {
    clarifyingQuestion: null,
    proposedText: textMatch ? textMatch[1].trim() : raw.trim(),
    note: noteMatch ? noteMatch[1].trim() : '',
  }
}

export interface RawSuggestion {
  fieldLabel: string
  suggestion: string
}

export function parseSuggestions(raw: string): RawSuggestion[] {
  if (/INGEN FORSLAG/i.test(raw.trim())) return []
  const suggestions: RawSuggestion[] = []
  raw.split('\n').forEach((line) => {
    const m = line.match(/FELT:\s*(.+?)\s*\|\s*FORSLAG:\s*(.+)/i)
    if (m) suggestions.push({ fieldLabel: m[1].trim(), suggestion: m[2].trim() })
  })
  return suggestions.slice(0, 3)
}

// Reconstructs a field's persisted AiConversationTurn rows as AI-call
// history (issue: "the AI seems to know its own previous message" — before
// this, chairChat sent only the newest message, with nothing from earlier
// in the SAME conversation, so a reply like "ok, implement your
// suggestions" had nothing to point at). An 'Ai' turn that carries a
// proposal is reconstructed in the same TEKST:/NOTE: shape the model
// originally produced it in, so its own past reasoning reads back
// consistently; a plain-feedback or clarifying-question turn (proposedText
// null) is just its messageText.
export function buildChatHistory(turns: Array<{ role: string; messageText: string | null; proposedText: string | null }>): AiMessage[] {
  return turns.map((t) => {
    if (t.role === 'Chair') return { role: 'user', content: t.messageText ?? '' }
    const content = t.proposedText ? `TEKST: ${t.proposedText}\nNOTE: ${t.messageText ?? ''}` : (t.messageText ?? '')
    return { role: 'assistant', content }
  })
}
