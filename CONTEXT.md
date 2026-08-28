# Context: Group DNA module

The Group DNA module of Group Compass. Source of truth for product behavior
is the spec (`documentation/Group Compass - Group DNA Module -
Specification v0.10.docx`); this file is a glossary for terms the spec
leaves loose. See the wayfinder map (GitHub issue #1, "Decisions so far")
for the reasoning behind each definition below.

## Language

**Group lifecycle status**:
One of `Imported`, `DraftGenerated`, `Launched`, `ChairReview`, `Approved`,
or `Closed` — the six-value set a `Group` moves through (spec §10's five
review-pipeline statuses, plus `Closed` for the separate, deliberate
"closing a group" action spec §12 describes).
_Avoid_: "Launched / NA review" (spec's own longhand — the canonical value
is `Launched`), a separate "pending re-approval" status (that's a boolean
flag, not a status).

**DNA version**:
An immutable, timestamped, per-`Group` snapshot of DNA content. Numbered
with a per-group monotonic integer starting at 1, incremented on every
save the spec names (auto-generation/regeneration, an NA comment round, a
Chair edit) — nothing is ever overwritten.

**DNA field**:
One of `GroupProfile`, `MemberProfile`, or `CompaniesProfile` — the three
areas a DNA version, `Comment`, or `AiConversationTurn` can attach to,
matching the group export's three profile columns and the approved
PDF-export design's three tabs.
