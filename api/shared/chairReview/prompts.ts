// EDIT_FEEDBACK_SYSTEM, ported VERBATIM from
// prototypes/group-dna-live-prototype/server.js (issue #25's manual-edit
// AI quality-check guardrail, spec §11). No wording changes — a
// system-prompt wording change is a product decision requiring
// re-verification (CLAUDE_1.md), and this one was already tested against
// the calibration set in the prototype. Kept in Danish, same reasoning as
// the DNA-pipeline prompts (shared/dna/prompts.ts): DNA content and the
// feedback about it are processed in the Chair's own language (spec §14).
import type { AiPromptVersion } from '../ai/types'

const EDIT_FEEDBACK_SYSTEM = `Du giver en Chair kort, konstruktiv feedback lige efter Chair selv har redigeret et felt i et Group DNA.

Regler:
- Maks 1-2 sætninger.
- Vurdér KUN om feltet stadig er operationelt og skarpt (kan man bruge det til at sige klart ja/nej i matching?).
- Nævn ALDRIG en score, et tal, eller ordet "score". Ingen metodeforklaring.
- Feedbacken blokerer aldrig for at gemme — den er ren rådgivning.
- Svar kun med selve feedback-teksten, intet andet.`

export const editFeedbackPrompt: AiPromptVersion = { key: 'chair-edit-feedback', version: 1, system: EDIT_FEEDBACK_SYSTEM }
