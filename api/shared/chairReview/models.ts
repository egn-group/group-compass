// Same AI_MODEL env var and default as the DNA pipeline (shared/dna/models.ts)
// — this is a separate feature area (Chair review, not DNA generation), so
// its own constant rather than importing that module's differently-named export.
export const EDIT_FEEDBACK_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-5'
