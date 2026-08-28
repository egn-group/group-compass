# Context: Group DNA module

Source of truth for product behavior is the spec
(`documentation/Group Compass - Group DNA Module - Specification v0.10.docx`).
This file exists to sharpen terms and decisions the spec leaves loose, not to
restate what it already says precisely. See `docs/adr/` for decisions with
real, hard-to-reverse trade-offs.

## Terms

### Group.lifecycleStatus

Spec §10 names five statuses a group moves through: `Imported`,
`Draft generated`, `Launched / NA review`, `Chair review`, `Approved`. The
spec's own shorthand elsewhere (§10, "Relaunch... resets the group's status
to Launched") drops the "/ NA review" suffix, so the canonical enum value is
just **`Launched`** (meaning: admin has launched the group, NA invited to
comment) — not `LaunchedNaReview`.

Spec §12 separately describes "closing a group" as "a separate, deliberate
action" (distinct from the five-status review pipeline). It's not one of
§10's five rows, but it's a real, named action, so the schema adds a sixth
status, **`Closed`**, as a terminal state reachable from any of the other
five (an Admin closing a group that's no longer part of the pilot, e.g. gone
from a later import).

Enum: `Imported | DraftGenerated | Launched | ChairReview | Approved | Closed`

"Pending re-approval" (spec §10: a Chair edit after approval "flags" the
group but "status stays Approved — never a separate status") is **not** a
status value — it's a separate boolean (`Group.pendingReapproval`), exactly
as the spec insists.

### DNA version numbering

Spec §10: "Nothing is ever overwritten... every save... creates a new
version with timestamp and author." The scheme is a per-Group monotonic
integer starting at 1, unique per `(groupId, versionNumber)` — the simplest
reading that satisfies "nothing overwritten" with a real ordering. No gaps
are assumed or enforced; a version is created exactly when spec §10 says a
save happens (auto-generation/regeneration, an NA comment round, a Chair
edit).

### DnaVersion.author

Spec §12's entity table says "author (AI/Chair/Admin)" — three values. But
spec §10 says a "NA comment round" is one of the three things that "creates
a new version with timestamp and author," which has no author among those
three. Read §12's parenthetical as illustrative, not an exhaustive closed
set (compare "roles (additive)" on `User`, clearly not exhaustive either),
and add a fourth value so an NA-triggered version can honestly record who
triggered it.

Enum: `Ai | Chair | Admin | NetworkAdvisor`

### DnaField

Spec §12 doesn't name a closed set of DNA fields, but the approved
PDF-export design (wayfinder map, issue #1 decisions) fixes exactly three
tabs — Group Profile / Member Profile / Companies Profile — matching
`Group`'s three profile columns from the group export (spec §12). Both
`Comment.field` and `AiConversationTurn.field` use this same set.

Enum: `GroupProfile | MemberProfile | CompaniesProfile`

### Event.type

Spec §10's "paper trail" paragraph lists exactly: imports, generations,
launches, comments, edits, approvals, exports — but flags itself as
non-exhaustive ("a change log of events (...)"). Spec §13 separately
describes a Chair/NA reassignment as a real, notification-worthy action on
a group, so it belongs in the same change log even though the §10 sentence
doesn't name it. Added as an eighth value rather than silently dropped.

Enum: `Import | Generate | Launch | Reassign | Comment | Edit | Approve | Export`

Regenerate and Relaunch (spec §10) are not separate enum values — they're
the same *kind* of event (`Generate`, `Launch`) re-triggered, not a new
category.

## Deliberately not modeled

- **`DnaVersion.changeList`** (spec §12 lists this as a DNA-version
  attribute, "for AI versions"): the on-demand AI change-list ("Auditor")
  feature it belongs to was already dropped from the real build (recorded
  in the wayfinder map, issue #1, "Out of scope"). Per that same note, the
  spec section describing it is stale and flagged for a future spec
  revision — not silently built around. Omitted here for the same reason,
  not re-flagged.
