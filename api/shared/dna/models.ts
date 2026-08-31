// Model choice for the DNA pipeline. Sonnet 5 as the default, Haiku 4.5
// for the Notary stage, a purely mechanical sorting task that doesn't need
// Sonnet's judgment — the wayfinder map (issue #1) already settled
// accepting this pairing's prompt-caching cost gap at pilot volume rather
// than re-tuning it, so unlike the prototype's own conservative default
// (falls back to MODEL unless ANTHROPIC_NOTARY_MODEL is explicitly set),
// this build commits to Haiku for Notary by default.
export const CONSULTANT_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-5'
export const NOTARY_MODEL = process.env.AI_NOTARY_MODEL ?? 'claude-haiku-4-5'
export const SCORE_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-5'
