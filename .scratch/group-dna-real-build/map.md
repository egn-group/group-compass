# Group DNA — Real Build (Pilot) — Wayfinder Map

## Destination

A real, production-grade pilot deployment of the Group DNA module — Admin, Chair, and Network Advisor roles fully working, Danish-only, real Entra ID auth, real Postgres DB — able to run 8 real, hand-picked groups through the full launch → NA comment → Chair review/approve flow with 4 real Chairs and 4 real Network Advisors. Full notification flow, per-field/per-group AI-conversation PDF export, signed-off Entra permission scopes, a chosen and wired-up email provider, and a generic admin user-creation feature all ship. Chair Leader, Sales Leader, Finnish-language support, and the Auditor/change-list feature are explicitly out of scope for this map.

## Notes

- Source of truth for product behavior: `documentation/Group Compass - Group DNA Module - Specification v0.10.docx`. Build-context docs (`documentation/CLAUDE_1.md`, `prototypes/group-dna-live-prototype/HANDOFF.md`) are kept in sync with the spec, not the reverse.
- Architecture template: the My Path app, a sibling repo at `/home/jap/projects/my-path` — same Vite+React SPA / Azure Static Web Apps managed Functions / Entra-ID-at-the-edge pattern. Two deliberate deviations here: TypeScript instead of plain JS, PostgreSQL+Prisma instead of Table Storage.
- Skills to consult per ticket: `/research` for facts, `/prototype` for UI/behavior questions, `/grilling` + `/domain-modeling` for decisions requiring the user's judgment.
- The user already holds the real pilot roster (8 groups, 4 Chairs, 4 Network Advisors) and wants a generic admin user-creation feature — not manual per-user Entra provisioning — modeled on My Path's existing implementation.
- No fixed launch date by design: the user deleted this project's dated timeline document specifically so it wouldn't bias scope here. Optimize for correctness, not a date.
- Judgment calls already settled during charting (recorded here, not as tickets): accept Stage 1 (Haiku)'s prompt-caching cost gap at pilot volume rather than re-engineering the prompt or switching models; omit Chair Leader from the pilot's active notification recipients (Admin is already a recipient on every event Chair Leader would also appear on, so nothing is lost); Sales Leader's score-invisibility acceptance criterion (spec §15) is vacuously satisfied for the pilot since no Sales Leader account will exist — must be re-verified for real before wider rollout.

## Decisions so far

- [Research MyPath's user-creation feature](issues/01-research-mypath-user-creation.md): My Path's user-creation is app-level roster/role management only — it never calls Graph to create/invite Entra accounts, and needs no Graph permission for it. This forked ticket 02 into a live decision: mirror that (no extra Graph scope) vs. actually provision Entra accounts (needs `User.Invite.All`/`User.ReadWrite.All`).
- [Research: email provider](issues/06-research-email-provider.md): use Azure Communication Services Email, not SendGrid — under $1-2/month at pilot volume vs. SendGrid's mandatory ~$20/month floor (its free tier is gone), and ACS is the only genuinely Azure-native option of the two, matching the CTO's "Azure-only" intent better than SendGrid's Azure-Marketplace billing wrapper around a real Twilio account.

## Not yet specified

- DNA version numbering/versioning scheme and lifecycle-status enum values — spec names the fields (`DNA version`, `Group.lifecycle status`) but not their exact value sets; will sharpen once the Prisma schema is drafted.
- Whether Azure Static Web Apps *managed* Functions support the newer Node.js v4 programming model (`app.http()`) — not blocking; building on the classic v3 pattern (confirmed working), test v4 later only if ever wanted.
- Full AI call layer specifics: exact retry/backoff counts, per-call timeout values, exact Application Insights fields to log.
- Email/notification template content and visual design (beyond "email, links to the group").
- Any further pilot acceptance-criteria nuances that surface once the data model and versioning/paper-trail logic are actually built.

## Out of scope

- Auditor/change-list feature, and updating spec v0.10 to remove it — dropped from the real build per `CLAUDE_1.md`, even though the spec still fully describes it across roles, data model, and the 4-prompt pipeline. Flagging the spec for a future revision is the spec owner's task, not this build's.
- Chair Leader and Sales Leader roles — deferred past this pilot entirely; no screens or flows built for them in this map.
- Finnish-language validation — deferred; this pilot is Danish-only.
- Final production application URL — deferred, can wait.
- Full 420-row Salesforce export reconciliation (18 no-DNA groups, 93 empty-section groups, non-peer admin records, unmatchable Chair/Sales values) — deferred to the wider-rollout effort; this pilot imports only the 8 named groups.
