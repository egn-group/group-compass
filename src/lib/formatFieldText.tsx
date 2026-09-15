// Read-mode formatting for DNA field text (prototype parity,
// prototypes/group-dna-live-prototype/public/chair-groups-live.html's
// formatFieldText) — bold `**headline**` markers, everything else as plain
// text. Line breaks are the caller's responsibility (a `white-space:
// pre-wrap` container), not this function's. Edit mode should always show
// the same text completely raw (a textarea's value) — this is only for
// read-only display, wherever a DNA field's text is shown outside an edit
// control (Chair review, Network Advisor comment screen, etc.).
export function formatFieldText(raw: string) {
  const parts = raw.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part)
    return match ? <strong key={i}>{match[1]}</strong> : <span key={i}>{part}</span>
  })
}
