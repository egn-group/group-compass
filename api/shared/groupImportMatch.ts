export interface ImportMatchUser {
  email: string
  name: string
  roles: string[]
}

export interface ImportMatchResult {
  email: string | null
  matchedByName: boolean
}

// Real Salesforce exports name the Responsible Chair/Sales column like
// "SUS - Susanne Svejgaard" — a short record code, then the actual name —
// not the plain name a User row stores. Stripped before comparing so that
// convention doesn't defeat matching entirely. Requires real whitespace on
// both sides of the hyphen, specifically so a genuinely hyphenated name
// (e.g. Danish "Anne-Marie", no surrounding spaces) is never mistaken for a
// code prefix and mangled.
function stripCodePrefix(name: string): string {
  return name.replace(/^\S+\s+-\s+/, '')
}

// Resolves a CSV row's Chair/Network Advisor to an existing User. An exact
// email match wins whenever there is one. Otherwise — the email cell was
// blank, or didn't match any existing User — falls back to matching the
// row's name (trimmed, case-insensitive, and with any leading record-code
// prefix stripped) against Users holding the given role; real Salesforce
// exports don't always carry a usable email, and a name is still enough to
// go on. Never auto-creates a User either way (issue #6): the Chair/NA must
// already exist for their group to resolve to them.
export function resolveImportMatch(rawEmail: string, rawName: string, role: string, users: ImportMatchUser[]): ImportMatchResult {
  const email = rawEmail.trim().toLowerCase()
  if (email) {
    const known = users.some((u) => u.email === email)
    if (known) return { email, matchedByName: false }
  }
  const name = rawName.trim().toLowerCase()
  if (!name) return { email: null, matchedByName: false }
  const strippedName = stripCodePrefix(name)
  const nameVariants = strippedName === name ? [name] : [name, strippedName]
  const matches = users.filter((u) => u.roles.includes(role) && nameVariants.includes(u.name.trim().toLowerCase()))
  // Two Users in the same role sharing a name is a real possibility (a
  // small pool of common names) — surface as unmatched rather than
  // silently picking one of them.
  return matches.length === 1 ? { email: matches[0].email, matchedByName: true } : { email: null, matchedByName: false }
}
