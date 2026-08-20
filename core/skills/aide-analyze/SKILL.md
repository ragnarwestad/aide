---
name: aide-analyze
description: >-
  Analyze the codebase for a JIRA issue or TODO plan.
  Detects complexity (LOW/MEDIUM/HIGH), maps affected files with
  file:line references, and creates an implementation plan with TDD.
  Use when: analyzing the codebase for an existing task,
  filling in 2-analysis.md and 3-solution.md, needing an overview of
  affected files and API impact.
  Do NOT use for: creating a new task (use aide-create),
  implementation (use aide-implement).
argument-hint: "[PROJ-XXXX or task number]"
effort: xhigh
---

Analyze the codebase for a JIRA issue or TODO plan.

**Input:** $ARGUMENTS (all arguments after the command)

## Smart detection

Parse `$ARGUMENTS`:

**JIRA mode:** If the first word is a JIRA key: `[A-Z][A-Z0-9]*-[0-9]+` (any project prefix, e.g. `PROJ-7890`, `MEL-123`). `TODO-` is never a JIRA key — TODO mode wins.
- Example: `/aide-analyze PROJ-7890`

**TODO mode:** If the first word is a number or starts with `TODO-`
- Example: `/aide-analyze 55` or `/aide-analyze TODO-01`

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing argument

Usage:
/aide-analyze PROJ-XXXX     # For JIRA issue
/aide-analyze 55               # For task (number)
/aide-analyze TODO-01           # For TODO plan

Examples:
/aide-analyze PROJ-7890
/aide-analyze 55
```

---

## Workflow

### Step 1: Read the description

- Read `specs/XX-slug/1-description.md`
- Read `.aide/project.yaml` in the project root if it exists — the
  project manifest gives deployment, logging and dependency context
  the analysis should use (refresh it with `/aide-manifest`)
- Identify: What should change? What is the scope? Migration or single fix?

### Step 2: Detect complexity

Classify as LOW/MEDIUM/HIGH based on the number of files, operation type,
and API impact. See `references/complexity-and-analysis.md` for the criteria.

### Step 3: Analyze the codebase

Scale the analysis to the complexity:
- **LOW:** Find the file, read it, check tests. < 15 min.
- **MEDIUM:** Find dependencies, related files, API impact. 20-45 min.
- **HIGH:** Search broadly, categorize files, create a migration plan. 1-3 hours.

See `references/complexity-and-analysis.md` for detailed steps per level.

### Step 4: Update 2-analysis.md

Write to `specs/XX-slug/2-analysis.md`. Follow the spec structure § 2-analysis.
Include: Tracking info, mapping, affected files with file:line, API impact,
test coverage.

Nothing that judges the solution goes here — complexity, estimate and risk
analysis belong to 3-solution.md (spec structure § Separation of content).

### Step 5: Create the implementation plan (3-solution.md)

Write to `specs/XX-slug/3-solution.md`. Follow the spec structure § 3-solution.

**Scope:** the files to change, the complexity grade with the factors behind
it, and the estimate for manual and AI-assisted development.

**Behavior delta:** state what the chosen solution ADDS / MODIFIES / REMOVES
in behavior, relative to how the system works today — not just which files
change (those are listed under Scope).

**Risk analysis:** the risks the chosen solution carries, each with
consequence, probability and mitigation.

**Acceptance criteria:** testable given/when/then scenarios. Each criterion
must be verifiable by a test — if you cannot phrase the test, the criterion
is too vague.

Structure the plan with TDD:
- Step 0: Write tests (RED phase) — at least one failing test per acceptance criterion
- Step 1-N: Implementation (GREEN phase)
- Testing strategy (REFACTOR phase)

### Step 6: Update 4-status.md

Write to `specs/XX-slug/4-status.md`. Follow the spec structure § 4-status.
- LOW: Simple checklist (< 30 lines)
- MEDIUM/HIGH: Phase-based tracking (50-100 lines)

Then record the step on the line the dashboard reads, in Tracking info:

```markdown
- **Workflow steps completed:** create, analyze
```

Add `analyze` once and keep the values already there — the line is the
whole record of how far the spec has got, and rewriting it loses the
steps before this one. Do not record it if the analysis did not complete: an analysis that failed, or that you stopped part-way, leaves the line as it was.

### Step 7: Confirm

Show a summary with complexity, number of affected files, and the next step.

IMPORTANT:
- ALWAYS use the file:line format for references
- ALWAYS consider API impact (frontend ↔ backend)
- Match the scope of the documentation to the complexity
- Code blocks ALWAYS end with just ` ``` `

---

## Next step

```text
/aide-review-plan 55      # MEDIUM/HIGH: review the plan first
/aide-implement 55         # LOW: straight to implementation
```
