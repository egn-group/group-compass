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

---

## 6. Recommended stack for the real build

Chosen to match the existing "My Path" (EGN performance review) app as closely
as possible, with two deliberate differences. Full reasoning and the real
timing data behind it are in project memory
(`groupdna-bot-real-build-architecture`).

### Keep, same as My Path

- **Vite + React SPA.** No meta-framework, no SSR — every user signs in, there
  are no public/SEO pages.
- **Azure Static Web Apps**, with the API in `api/` as **managed Functions**
  (not a separate App Service — see below for why this stays true).
- **SWA's built-in Entra ID auth at the edge.** SWA validates the token and
  injects `x-ms-client-principal`. Trust that header for *who* is calling;
  look up *what they may do* (role, manager relationships) server-side —
  same rule My Path already follows.
- `staticwebapp.config.json` gating all routes behind authenticated, 401 →
  Entra login.
- **Vitest + Testing Library + Playwright.**

### Change 1 — TypeScript, not plain JavaScript

Group Compass has a much larger, more relational data model than My Path
(groups/members/companies/DNA versions/per-field AI conversations/multi-role
users), and an AI agent writes much of the code — TypeScript catches a wrong
field name or wrong shape before it runs, instead of at run time.

### Change 2 — PostgreSQL, not Table Storage

Use **Azure Database for PostgreSQL Flexible Server** (Single Server is
retired) with **Prisma** for schema, types and migrations. Enable Flexible
Server's **built-in PgBouncer** (off by default — enable `pgbouncer.enabled`
in the Azure Portal Parameters pane; listens on port 6432, not 5432; not
available on the Burstable pricing tier) and point Prisma's runtime
`DATABASE_URL` at the pooled port — serverless function instances each open
their own DB connection and can exhaust the connection limit under burst
load otherwise. Use a second, direct, unpooled `DIRECT_URL` (port 5432) for
`prisma migrate` — the Prisma Schema Engine needs a single dedicated
connection and does not work through PgBouncer's transaction-pooling mode.

Why not Table Storage, in order of weight: (1) multi-entity transactions —
approving a DNA writes status + version + notification + export-queue rows
together, which needs a real transaction, not four independent partition
writes; (2) referential integrity for conversation-turn → field → version →
group; (3) real multi-condition queries (retention sweep, export queue,
Chair Leader views, reconciliation against the 420-row Salesforce export)
instead of hand-maintained index tables that drift; (4) the spec has moved
v0.1→v0.10 in about two months — a real migration tool beats ad hoc backfill
scripts for a schema that keeps changing.

### Confirmed safe to stay on SWA — real timing data

SWA's request cap is a **hard 45 seconds**, for managed *and* linked/BYO
Functions alike — there is no configuration to raise it. `/api/pipeline`
today runs Stage 1 + Stage 2 as two sequential Claude calls in one request.
Tested against real samples pulled from the 425-active-row
`DK-Groups-30-06-2026.xlsx` export (`sample_longest.txt` /
`sample_messiest.txt`, in the `documentation` folder):

- Messiest sample: combined ~24–26.6s. Safe margin.
- **Longest sample: combined 42.3–42.5s — only ~2.5s under the 45s cap.**

That margin is too thin once the Azure Functions cold start and extra
network hop this localhost test didn't capture are added in. **Splitting
`/api/pipeline` into two endpoints (one per stage) is therefore required,
not optional**, before this goes to production. Split, each stage alone has
large margin: Stage 1 ~18.7–19.2s (~26s margin), Stage 2 ~23.3–23.7s (~21s
margin). The client should hold the Stage 1 result and pass it to the Stage
2 call — same pattern `chair-groups-live.html` already uses for
`/api/change-list`.

Side finding, cost not latency: Stage 1 (Haiku) never triggered prompt
caching on any test run (`cache_read=0 cache_write=0` throughout) — Claude
Haiku 4.5 needs a 4,096-token system prompt to be cacheable, vs. 1,024 for
Sonnet models, and `STAGE1_NOTARY_SYSTEM` is too short for Haiku's
threshold. Every Stage 1 call currently pays full input price. Worth a
decision during the real build (accept the cost, or move Stage 1 to a
Sonnet-tier model).

### Drop: the Auditor stage / change list

The app can launch without it. **This needs a spec update, not just a code
change** — spec v0.9 §8 and the Admin-only change list in §11 both describe
this feature; it should be removed in the next spec version rather than
silently absent from the build.

### Add (not present in My Path or the prototype)

- A real **AI call layer**: retry with backoff, per-call timeout, prompt
  versioning (version each system prompt in code, store which version
  produced each DNA — prompt wording is already a product decision per
  section 1 above), token/cost/latency logged per call to Application
  Insights, secrets in **Azure Key Vault** via managed identity (not
  `.env`).
- **Authorization as one tested policy module** — who sees scores, who sees
  another Chair's AI transcript. These are spec §15 acceptance criteria; a
  leak is the worst failure mode this system can have. Tests written before
  the code.

### API layer: no framework, Zod for validation

SWA managed Functions is not a persistent server — it's one function per
endpoint, matching My Path's existing pattern (`function.json` + `index.js`
per folder). Running a full Express or Fastify app inside a Function does
not fit that model; use the file-per-endpoint model instead, in TypeScript.

For request/response type safety, use **Zod alone** — no framework needed to
carry it. Put schemas in a shared `shared/schemas/` folder imported by both
the API functions and the React app, so `z.infer<typeof Schema>` gives one
TypeScript type generated from one runtime-checked shape, instead of two
hand-written copies that can drift apart. This also covers the type-safety
gap that tRPC would otherwise fill, without the hosting mismatch.

**Still to verify, not yet confirmed**: whether SWA *managed* functions
support the Azure Functions Node.js v4 programming model
(`app.http()`-style registration) or only the classic v3 style
(`function.json` + `index.js`). Build on the classic v3 pattern — confirmed
working in My Path today — and only try v4 syntax in a throwaway test
function first, rather than assuming it works on managed functions.
