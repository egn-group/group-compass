# Group DNA module

The Group DNA module of Group Compass. Source of truth for product
behavior is the spec (`documentation/Group Compass - Group DNA Module -
Specification v0.10.docx`); this file is a glossary for terms the spec
leaves loose. See the wayfinder map (GitHub issue #1, "Decisions so far")
for the reasoning behind each definition below.

## Language

**Group lifecycle status**:
One of `Imported`, `DraftGenerated`, `Launched`, `ChairReview`, `Approved`,
or `Closed` — the status a `Group` is in.
_Avoid_: "Launched / NA review" (use `Launched`); "pending re-approval" as
a status (it's a separate boolean flag, not a status value).

**DNA version**:
An immutable, per-`Group` snapshot of DNA content, numbered with a
per-group sequence starting at 1.
_Avoid_: editing or replacing a version in place — none is ever changed
after creation.

**DNA field**:
One of `GroupProfile`, `MemberProfile`, or `CompaniesProfile` — the three
areas of a group's DNA that a comment or AI conversation turn can attach
to.

**DNA version author**:
Who triggered a DNA version's creation: `Ai`, `Chair`, `Admin`, or
`NetworkAdvisor`.

**Change-log event type**:
What kind of action produced an `Event`: `Import`, `Generate`, `Launch`,
`Reassign`, `Comment`, `Edit`, `Approve`, or `Export`.
