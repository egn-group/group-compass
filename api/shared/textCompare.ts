// Spec §12: "Incoming profile text is compared to the stored version
// ignoring insignificant whitespace, so only genuine wording changes are
// flagged."
function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function textEqualsIgnoringWhitespace(a: string, b: string): boolean {
  return normalizeWhitespace(a) === normalizeWhitespace(b)
}
