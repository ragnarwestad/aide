---
name: aide-reset
description: >-
  Reset an invalid active spec work round while keeping its README,
  description, commits and earlier job history. Use when an active spec's
  analysis, plan or status belongs to a work round that must not count.
  Do NOT use for archived specs (use aide-reopen).
argument-hint: "[<JIRA-KEY> or task number]"
effort: medium
---

# Reset an active spec work round

## Table of contents

- [Workflow](#workflow)
- [Result](#result)
- [Important](#important)

---

Reset the active spec identified by `$ARGUMENTS` without deleting history.

## Workflow

1. Resolve the argument with `aide_resolve_spec`. Refuse unless it resolves to
   an active folder directly under the specs root.
2. Leave `0-README.md` and `1-description.md` byte for byte unchanged.
3. Regenerate `2-analysis.md`, `3-solution.md` and `4-status.md` from
   `core/skills/aide-create/references/file-templates.md`, replacing the same
   TITLE, FOLDER and DATE placeholders as `/aide-create`.
4. Do not carry over `Workflow steps completed`, model lines, phase progress or
   any earlier Reset/Reopened marks. The earlier files, commits and queue jobs
   remain in repository and queue history; the new boundary makes them belong
   to the previous round.
5. Leave the `**Reset:**` mark out. `aide-run-spec` writes it itself once this
   step finishes, from the specs repository's own default-branch tip at the
   moment its branch was cut — not from anything this session computes. The
   mark it writes reads `- **Reset:** DATE (history before \`SHA\` does not
   count)` — the same grammar `/aide-reopen`'s `**Reopened:**` mark uses.
6. In a headless run, branch cleanup and the commit are handled by
   `aide-run-spec`. At a keyboard, remove `aide/<folder>` locally and on origin
   in both the project and specs repositories before editing, and ask before
   committing with `Run /aide-reset for <folder>`.

## Result

Report the kept files and the regenerated files. The next workflow step is
`/aide-analyze <id>`.

## Important

- Never move the folder; Reset is active-only.
- Never delete or rewrite commits or either default branch.
- Never modify `0-README.md` or `1-description.md`.
- Code blocks always end with a plain closing fence.
