# Group DNA Module — build handoff

Purpose of this document: notes for the real build that are not in the spec.
The spec tells you WHAT to build. This document tells you HOW the prototype
works, what you can reuse, and what is still open.

**Source of truth for product behavior:** `Group Compass - Group DNA Module -
Specification v0.10.docx`, in the `documentation` folder. If this document
and the spec ever disagree, the spec wins — update this document to match.

---

## 1. Where the prototype code is, and what to reuse

Folder: `prototypes/group-dna-live-prototype/`

```
server.js                     Express server, all AI calls
public/ai-pipeline-test.html  Admin: run the AI pipeline, launch a group
public/na-review.html         Network Advisor: comment on a launched group
public/chair-groups-live.html Chair: review, edit, approve a group's DNA
```

This prototype has **no auth and no database**. Everything lives in one
in-memory array in `server.js` and is lost on every restart. Auth (Entra
SSO) and a real database come first in the real build, ahead of anything
else here.

### Reuse almost as-is

The AI prompts in `server.js` are real, tested prompts — not placeholders.
They were adapted from your own "AI promptkæde_Group DNA.docx" and verified
against real messy Salesforce export samples and the calibration set:

- `STAGE1_NOTARY_SYSTEM` — structuring only, no rewriting.
- `STAGE2_CONSULTANT_SYSTEM` — the Score-5 rewrite. Includes the objectivity
  rule, the 2-year merger-recency rule, and the roster-input handling.
- `HEADLINE_FORMAT_RULE` — enforces bold subheadings, used in both stage 1
  and stage 2.
- `STAGE3_AUDITOR_SYSTEM` — the change list.
- `CHAIR_CHAT_SYSTEM` — the Chair's "Edit with AI" assistant, including the
  `SPØRGSMÅL:` clarifying-question escape hatch (see section 3 below).
- `SUGGEST_IMPROVEMENTS_SYSTEM` — the optional post-approval suggestions.

Port these prompts directly. Treat any wording change as a product decision,
not a code cleanup — re-test against the calibration set if you change one.

### Treat as a rough sketch, not a real API design

The routes (`/api/pipeline`, `/api/chat`, `/api/edit-feedback`,
`/api/suggest-improvements`, `/api/launch`, `/api/groups`, `/api/na-comment`)
show the right shape of each call, but they have no auth, no persistence,
and no error handling beyond a happy path. The real build needs a proper
data model (see spec section 12, "Core entities") behind these.

### Client-side reference

`chair-groups-live.html`'s per-field chat structure (`f.chatLog`, one
conversation per field, switching fields never mixes them up) matches the
`ai_conversation_turn` table sketched in project memory
(`groupdna-bot-ai-conversation-logging`) — use it as the model for the real
schema.

---

## 2. Environment and secrets

- The prototype reads `ANTHROPIC_API_KEY` from a local `.env` file
  (`.env.example` ships as a placeholder; the real `.env` is gitignored).
- Never commit a real key. Never put a real key in a file you hand off or
  publish anywhere.
- Model used: `claude-sonnet-5` by default (`ANTHROPIC_MODEL` env var
  overrides it; `ANTHROPIC_NOTARY_MODEL` overrides stage 1 only, in case a
  cheaper model is ever wanted there — not currently used).
- For the real build, move the key into proper secrets management (Azure
  Key Vault or equivalent) rather than a `.env` file on a server.

---

## 3. Known issues and findings from testing

- **Stage 1 (Notary) can miscategorize very messy raw input.** On one real
  sample ("Sikkerhedschefer 1"), content that belongs under "Hvad
  kendetegner gruppen" ended up split between "Hvad får man" and
  "Udviklingsfokus" instead. Not a bug to fix blindly — check this against
  a wider sample of real messy imports before launch.
- **Cost control:** Prompt 3 (Auditor) and Prompt 4 (Final) are meant to run
  on demand — the first time an Admin actually opens the change list for a
  group — not eagerly for every group at generation time. This is a spec
  decision (v0.9, section 8), not just a prototype shortcut.
- **Four real bugs were found and fixed in the Chair review page** during
  this round of testing — useful as a checklist of edge cases to test again
  once this logic is rebuilt for real, since a rewrite can easily
  reintroduce the same class of bug:
  1. A group's fields must always carry their own chat history, whether the
     group came from hardcoded demo data or from a real launch — these two
     sources of data diverged once before.
  2. A multi-turn AI conversation must keep working past the first message
     — a "remember which field we're editing" mechanism was accidentally
     one-shot before.
  3. Nonsense or unclear input to the AI assistant must produce a
     clarifying question, never a fabricated proposal.
  4. Editing a field on an already-approved group must never interrupt with
     a blocking modal — see section 4 below, this is still evolving.
- **Testing discipline used throughout:** every fix was verified with a real
  running server, a real Anthropic API call, and a real Playwright browser
  test — never just eyeballed. Worth keeping this standard for the real
  build; the test files (`test.js` etc., not part of the handoff — they were
  throwaway scripts) show the pattern if useful as a starting point.

---

## 4. Open decisions — not yet locked

These need an explicit decision before (or during) the real build. None of
them block starting the auth/database work.

- **Notification flow, recipients per event.** Spec section 13 currently
  says re-approval notifies the Network Advisor, Chair Leader, and Admin,
  same as first approval. The prototype's newest button ("Notify Admin of
  updated Group DNA") reads narrower — Admin only. You asked to leave this
  for a later decision (2026-08-27). Also still open: the full notification
  flow was never finally verified end to end (spec section 6).
- **AI conversation PDF export — exact design.** Spec v0.10 says an Admin
  can export a field's or a group's logged conversation as a PDF styled
  like a phone chat. Not yet designed: exact bubble layout, whether a bulk
  "export everything for one Chair" option is needed, and where the export
  button lives — the Admin screen for browsing logged transcripts doesn't
  exist yet, in the prototype or the spec, beyond "Admin can see them."
  Detail in project memory (`groupdna-bot-ai-conversation-logging`).
- **Final application URL** — not yet decided (spec section 6).
- **Whether Claude is the right LLM for Finnish** — flagged as needing a
  test before Finnish rollout (spec sections 14 and 17).
- **Entra permission scopes** — the Group CTO asked for the exact list of
  scopes the app registration will request, for sign-off. Not yet compiled.
- **Email/notification sending** — the CTO's stated preference is an
  Azure-only email service (Azure Communication Services Email, or
  SendGrid on Azure), not Exchange/Microsoft Graph Mail. Not yet
  implemented or decided for certain.

---

## 5. Spec sections to read alongside each build area

| Build area | Spec section(s) |
|---|---|
| DNA template shape | 7 |
| AI pipeline prompts and rules | 8 |
| Quality scoring | 9 |
| Status, versioning, re-approval | 10 |
| Chair editing experience, AI chat, conversation log + export | 11 |
| Import, export, data model | 12 |
| Notifications | 13 |
| Platform, security, non-functional requirements | 14 |
| Acceptance criteria (launch gate) | 15 |
