# Group Compass — Group DNA Module

This file is project context for Claude Code (or any AI coding agent) working
in this repository. It is read automatically at the start of a session.

## What this project is

The Group DNA module of Group Compass — an internal EGN Group platform.
Converts raw, messy Salesforce group export text into a structured,
AI-generated "Group DNA" profile, with a Network Advisor comment step and a
Chair review/approval step. Multi-role: Admin, Chair, Network Advisor, Chair
Leader, Sales Leader.

Source of truth for product behavior: **the spec document**
(`Group Compass - Group DNA Module - Specification v0.10.docx`, or later —
always use the newest version number). If this file and the spec disagree,
the spec wins.

A working prototype exists (Node/Express, no auth, no database, in-memory
data only) with real, tested AI prompts and a build handoff document
(`HANDOFF.md`). Both currently live in a separate `group-compass-docs`
folder, alongside the spec and the real Salesforce export data used for
testing. Locate that folder and read `HANDOFF.md` before writing any new
code — it documents what to port from the prototype as-is versus what to
rebuild, and known bugs already found and fixed once.

## Architecture decisions for the real build

Chosen to match an existing internal app ("My Path," an EGN performance
review tool) as closely as possible, with two deliberate differences.

### Keep, matching the existing internal pattern

- **Vite + React SPA.** No meta-framework, no SSR — every user signs in,
  there are no public/SEO pages.
- **Azure Static Web Apps**, with the API in `api/` as **managed
  Functions** — not a separate App Service.
- **Entra ID auth at SWA's edge.** SWA validates the token and injects
  `x-ms-client-principal`. Trust that header for *who* is calling; do
  authorization lookups (role, visibility rules) server-side, never
  client-side.
- `staticwebapp.config.json` gating all routes behind authenticated, 401 →
  Entra login.
- **Vitest + Testing Library + Playwright** for tests.

### Change 1 — TypeScript, not plain JavaScript

The data model here is larger and more relational than a typical internal
tool (groups/members/companies/DNA versions/per-field AI conversations/
multi-role users), and an AI agent writes much of the code. TypeScript
catches a wrong field name or wrong shape before it runs, instead of at run
time.

### Change 2 — PostgreSQL, not Table Storage

Use **Azure Database for PostgreSQL Flexible Server** (Single Server is
retired) with **Prisma** for schema, types and migrations.

- Enable Flexible Server's **built-in PgBouncer** (off by default — enable
  `pgbouncer.enabled` in the Azure Portal Parameters pane; listens on port
  6432, not 5432; **not available on the Burstable pricing tier** — use
  General Purpose or Memory Optimized). Point Prisma's runtime
  `DATABASE_URL` at the pooled port — serverless function instances each
  open their own DB connection and can exhaust the connection limit under
  burst load otherwise.
- Use a second, direct, unpooled `DIRECT_URL` (port 5432) for
  `prisma migrate` — the Prisma Schema Engine needs one dedicated
  connection and does not work through PgBouncer's transaction-pooling
  mode.

Why not a schema-less/NoSQL store, in order of weight:
1. **Multi-entity transactions.** Approving a DNA writes status + version +
   notification + export-queue rows together — this needs a real
   transaction, not several independent writes that can partially fail.
2. **Referential integrity** for conversation-turn → field → version →
   group.
3. **Real multi-condition queries** (retention sweeps, export queues,
   leadership score views, reconciliation against a large Salesforce
   export) instead of hand-maintained index tables that drift out of sync.
4. The spec has already gone through many revisions in a short time — a
   real migration tool beats ad hoc backfill scripts for a schema that
   keeps changing.

### API layer: no framework, Zod for validation

SWA managed Functions is not a persistent server — it's one function per
endpoint (`function.json` + `index.js`/`.ts` per folder — the classic v3
style). Running a full Express or Fastify app inside a Function does not
fit that model. Use the file-per-endpoint pattern, in TypeScript.

For request/response type safety, use **Zod alone** — no framework needed
to carry it. Put schemas in a shared `shared/schemas/` folder imported by
both the API functions and the React app, so `z.infer<typeof Schema>` gives
one TypeScript type generated from one runtime-checked shape, instead of
two hand-written copies that can drift apart.

**Not yet confirmed**: whether SWA *managed* Functions support the newer
Azure Functions Node.js v4 programming model (`app.http()`-style
registration), or only the classic v3 style. Build on the classic v3
pattern (confirmed working elsewhere) and test v4 syntax in a throwaway
function first if it's ever wanted, rather than assuming it works on
managed Functions.

### A hard constraint that shapes the API design: SWA's 45-second cap

Azure Static Web Apps caps every request at **45 seconds** — for managed
*and* linked/"bring your own" Functions alike. There is no configuration to
raise it.

Real timing tests against the two most extreme real samples found in the
production data (the longest group profile by character count, and the
most structurally messy one) showed the two-stage AI pipeline (a
structuring pass, then a rewrite pass) landing at **42.3–42.5 seconds
combined** for the longest sample — only ~2.5 seconds under the cap. That
margin does not account for an Azure Functions cold start or the extra
network hop production adds on top of a local test.

**Conclusion: any multi-stage AI pipeline must run as separate API
endpoints, one per stage — never combined into a single request.** Split,
each stage individually had 20+ seconds of margin. The client holds the
result of one stage in memory and passes it to the next endpoint call, the
same way a pattern already proven in the prototype's on-demand
"change list" feature works.

If a future stage risks approaching 45 seconds on its own even split out,
that stage needs to move off SWA (e.g. a durable/queued function via a
linked backend, or a different host entirely) rather than being squeezed
into the cap.

### Scope change: no "Auditor" / change-list feature

An earlier design included an on-demand AI stage that produced a
before/after change list for Admins. It has been dropped from the real
build. **If the spec still describes this feature, that is now a stale
spec section — flag it for removal in the next spec revision rather than
silently building around it.**

### Add — not present in the prototype

- A real **AI call layer**: retry with backoff, a timeout per call, prompt
  versioning (version each system prompt in code and store which version
  produced each output — prompt wording is a product decision here, not a
  code-cleanup detail, so treat any wording change accordingly), token and
  cost logged per call (e.g. to Application Insights), and secrets in a
  proper secret store (e.g. Azure Key Vault via managed identity) — never
  a `.env` file in production.
- **Authorization as one tested policy module**: who may see AI-generated
  quality scores, who may see another user's AI conversation transcripts,
  and so on. These are launch acceptance criteria — a visibility leak
  between users is the worst failure mode this system can have. Write the
  tests before the code that enforces the rule.

### A known cost gap, not yet acted on

One AI stage runs on a smaller/cheaper model whose system prompt is too
short to qualify for that model's prompt-caching minimum (cheaper models
often require a *longer* minimum prompt to cache than larger models do —
verify the current threshold for whatever model is in use before assuming
caching is active). Every call to that stage was paying full input price
in testing, with caching never engaging. Decide during the real build:
accept the cost, lengthen the prompt to clear the caching threshold, or
move that stage to a model with a lower minimum.

## Working conventions

- Treat the spec document as the product source of truth; treat this file
  and `HANDOFF.md` as build/engineering context that must be kept in sync
  with it, not the other way around.
- A change to an AI system prompt is a product decision — re-verify output
  quality against real sample data after changing one, not just a
  code-review pass.
- Test timing-sensitive changes (anything touching the AI pipeline) against
  real production-shaped data, not synthetic short examples — the margin
  under the 45-second cap only shows up with a genuinely large/messy real
  sample.
