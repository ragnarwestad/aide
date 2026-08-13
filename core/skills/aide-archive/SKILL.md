---
name: aide-archive
description: >-
  Archive a finished report and feed its durable knowledge back into the
  project's living documentation.
  Use when: a JIRA issue or TODO plan is done, closing out a report,
  cleaning up the reports root.
  Do NOT use for: creating reports (use aide-create), unfinished work,
  deleting reports.
disable-model-invocation: true
argument-hint: "[<JIRA-KEY> or task number]"
effort: medium
---

Archive a finished report: stamp it, move it to `archive/`, and merge what
should outlive it into the project's living documentation.

**Input:** $ARGUMENTS (a JIRA key, a task number, or a full folder ID)

## Why this step exists

Reports are write-only until they are archived: the analysis and the
decisions stay buried in the report folder. Archiving closes the loop —
the folder moves out of the active list, and the durable knowledge moves
into documentation that future work actually reads.

## Workflow

### Step 1: Resolve the report

- Reports root: `$AIDE_REPORTS_PATH` if set, otherwise `reports/` in the
  project root
- Resolve the argument to a folder (same rules as the other aide skills:
  number shorthand, JIRA key, or full `NN-slug`)
- If the folder is already under `archive/`: say so and stop
- If nothing is found: list the active folders and stop

### Step 2: Check that the work is done

Read `4-status.md`. If it does not clearly show finished work (open
checkboxes, no conclusion), show the status and ask the user whether to
archive anyway. Never archive silently past an unfinished status.

### Step 3: Close the loop

Read all four report files and identify what should OUTLIVE the report:

- Decisions and their reasons (chosen approach, rejected alternatives)
- New conventions or patterns the change introduced
- Gotchas discovered during implementation (things that will bite again)

Propose where each item belongs — the project's docs, `CLAUDE.md`/rules,
or a README — with the concrete text to add. Ask for confirmation, then
write it. If nothing qualifies, say so plainly; not every report leaves
something behind.

### Step 4: Stamp and move

1. Append to `4-status.md`: `**Archived:** <today's date, YYYY-MM-DD>`
2. Create `<reports-root>/archive/` if missing
3. Move the folder INTO `archive/` with its name unchanged:
   `git mv` if the reports root is git-tracked, plain `mv` otherwise

The folder keeps its `NN-slug` name — the date lives in `4-status.md`.
Numbers are never reused: `aide_next_report_number` (in
`_aide-report-lib.sh`) scans `archive/` too, and `aide-generate-pdf`/
`aide-generate-html` still find archived reports.

### Step 5: Confirm

```text
Archived: 17-clean-up-console-log

- 4-status.md stamped: Archived: 2026-08-13
- Moved to: reports/archive/17-clean-up-console-log/
- Fed back into docs: docs/CONVENTIONS.md (1 addition)

The report stays findable: /aide-to-pdf 17
```

IMPORTANT:
- Never delete a report — archiving is a move, not a removal
- If `AIDE_REPORTS_PATH` is set, do NOT run `git add`/`git mv` in the
  project's repo for report files (they live in another repo — use the
  reports repo's git if it has one)
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
