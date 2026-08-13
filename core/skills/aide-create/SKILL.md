---
name: aide-create
description: >-
  Create the document structure for a JIRA issue or TODO plan with the 4-file
  spec structure (description, analysis, solution, status).
  Use when: creating a new task, a new JIRA issue, a new TODO plan,
  starting new work that needs documentation.
  Do NOT use for: analysis (use aide-analyze), implementation (use aide-implement),
  code review.
argument-hint: "[PROJ-XXXX or TODO <description>]"
effort: medium
---

Create the document structure for a JIRA issue or TODO plan.

**Input:** $ARGUMENTS (all arguments after the command)

## Smart detection

Parse `$ARGUMENTS`:

**JIRA mode:** If the first word is a JIRA key: `[A-Z][A-Z0-9]*-[0-9]+` (any project prefix, e.g. `PROJ-7890`, `MEL-123`). `TODO-` is never a JIRA key — TODO mode wins.
- Example: `/aide-create PROJ-7890`
- Title: JIRA key, description: fetch from JIRA if possible
- JIRA base URL: read `AIDE_JIRA_BASE_URL` from `.aide/config` in the project
  root. If the file or key is missing, ask the user once and offer to save it
  there. Never guess the URL.

**TODO mode (with name):** If the first word starts with `TODO-` (but is not just `TODO`)
- Example: `/aide-create TODO-redux-form-migration Move all forms`
- Title: `TODO-redux-form-migration`, description: the rest of the arguments

**TODO mode (auto-generated):** If the first word is just `TODO`
- Example: `/aide-create TODO Move forms to React Hook Form`
- Title: generated automatically from the description

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing argument

Usage:
/aide-create PROJ-XXXX                    # For JIRA issue
/aide-create TODO-<name> <description>       # TODO with name
/aide-create TODO <description>              # TODO auto-generated

Examples:
/aide-create PROJ-7890
/aide-create TODO-redux-form-migration Move forms from Redux Form
/aide-create TODO Implement dark mode
```

---

## Workflow

### Step 1: Find the specs root

- Read `AIDE_SPECS_PATH` from `.aide/config` in the project root
  (helper: `aide_specs_root` in `_aide-spec-lib.sh` does the whole lookup)
- If the key is set: use that path as the specs root
- Otherwise: use `specs/` in the project root

### Step 2: Find the next available number

- Find the highest number from the `NN-slug` format in the specs root
  AND in `<specs-root>/archive/` — archived specs keep their number,
  and a number must never be reused
- Next number = highest + 1 (or 01 if none exist), leading zero: `01`, `02`, ...
- Helper: `aide_next_spec_number <specs-root>` in `_aide-spec-lib.sh`
  does exactly this

### Step 3: Generate a slug from the title

- Lowercase, spaces → hyphens
- Transliterate non-ASCII letters to their ASCII equivalents
- Remove special characters and double hyphens
- Result: `NN-slug` (e.g. `65-clean-up-console-log`)

### Step 4: Create the directory and 5 files

- Create the directory: `<specs-root>/NN-slug/`
- Create the files with content from `references/file-templates.md`
- Replace placeholders: TITLE, FOLDER, DATE, DESC

### Step 5: Stage in git

- If the specs root lies OUTSIDE the project root: SKIP git add in the
  project's repo (the specs live elsewhere, possibly their own repo)
- Otherwise: `git add <specs-root>/NN-slug/*.md`

### Step 6: Confirm

Show a summary and the next step:

```text
Task created: 55-clean-up-console-log

Files created:
- specs/55-clean-up-console-log/0-README.md
- specs/55-clean-up-console-log/1-description.md (filled in)
- specs/55-clean-up-console-log/2-analysis.md (ready for analysis)
- specs/55-clean-up-console-log/3-solution.md (ready for solution)
- specs/55-clean-up-console-log/4-status.md (ready for status)

Next step: /aide-analyze 55
```

IMPORTANT:
- Follow the workflows rules - Phase 1: Create document structure
- Follow the spec structure for the file layout
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the closing fence

---

## Next step

```text
/aide-analyze PROJ-XXXX   # For JIRA issue
/aide-analyze 55              # For TODO (use the task number)
```
