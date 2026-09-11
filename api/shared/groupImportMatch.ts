export interface ImportMatchUser {
  email: string
  name: string
  roles: string[]
}

export interface ImportMatchResult {
  email: string | null
  matchedByName: boolean
}

// Resolves a CSV row's Chair/Network Advisor to an existing User. Email is
// the definitive match whenever the row has one — an email that doesn't
// match any existing User surfaces as unmatched rather than falling through
// to a name guess (issue #6 already settled that: no auto-creating, no
// blind trust). Only a genuinely blank email cell falls back to matching
// the row's name (trimmed, case-insensitive) against Users holding the
// given role — real Salesforce exports don't always carry both columns.
export function resolveImportMatch(rawEmail: string, rawName: string, role: string, users: ImportMatchUser[]): ImportMatchResult {
  const email = rawEmail.trim().toLowerCase()
  if (email) {
    const known = users.some((u) => u.email === email)
    return { email: known ? email : null, matchedByName: false }
  }
  const name = rawName.trim().toLowerCase()
  const match = users.find((u) => u.roles.includes(role) && u.name.trim().toLowerCase() === name)
  return { email: match?.email ?? null, matchedByName: match !== undefined }
}
