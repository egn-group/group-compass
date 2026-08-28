# CLAUDE.md

Project context for Claude Code (or any AI coding agent) working in this repository. See also `documentation/CLAUDE_1.md` for the Group DNA module's architecture decisions and working conventions.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`egn-group/group-compass`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root (not yet created — created lazily by `/domain-modeling` as terms/decisions get resolved). See `docs/agents/domain.md`.
