// Spec §12: "Country is derived automatically from Partner Code through a
// code-to-country lookup, so it is not entered separately."
//
// The only real sample data available (prototypes/DK-Groups-export-UTF8-sample.csv)
// confirms exactly one code: "EGDK" -> Denmark. There is no authoritative full
// EGN partner-code registry available to this build — extend this table as
// more real partner codes are seen (e.g. when the pilot's other markets
// export data), rather than guessing a pattern from a single data point.
const KNOWN_PARTNER_CODES: Record<string, string> = {
  EGDK: 'Denmark',
}

/** Returns the known country for a partner code, or '' if not (yet) known. */
export function countryForPartnerCode(partnerCode: string): string {
  return KNOWN_PARTNER_CODES[partnerCode.trim().toUpperCase()] ?? ''
}
