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

Classify as LOW/MEDIUM/HIGH: Operation, Keywords and API impact decide the
grade, and the grade is the highest band any of them reaches. The number of
files is a signal read last — it never raises a grade the other three read
as LOW. See `references/complexity-and-analysis.md` for the criteria.

### Step 3: Analyze the codebase

Scale the analysis to the complexity:
- **LOW:** Find the file, read it, check tests. < 15 min.
- **MEDIUM:** Find dependencies, related files, API impact. 20-45 min.
- **HIGH:** Search broadly, categorize files, create a migration plan. 1-3 hours.

See `references/complexity-and-analysis.md` for detailed steps per level.

### Step 4: Check for work already begun

A step stopped by its own time limit still commits what it wrote, and
that work is landed on the default branch rather than left on a branch
nobody can see (spec 187) — so the three files may already hold an
earlier run's answers. Read `specs/XX-slug/2-analysis.md`,
`3-solution.md` and `4-status.md` as they stand before writing anything.

A section is UNWRITTEN when it still holds its template's bracketed
placeholder text: `[not analyzed yet]`, `[filled in by analysis]`,
`[How the analysis was performed...]`, `[not started]`, and any other
bracketed stand-in the templates put there. Anything else is written,
whether an earlier run wrote it or this one did.

Counting headings is not enough. A half-written section carries its
heading exactly as a finished one does, so the heading says nothing
about whether the section was ever filled in — the bracketed
placeholder is the signal, and it is the only one.

Fill in the sections that still hold their placeholder. Leave every
section that already has real content exactly as it stands.

### Step 5: Update 2-analysis.md

Write to `specs/XX-slug/2-analysis.md`. Follow the spec structure § 2-analysis.
Include: Tracking info, mapping, affected files with file:line, API impact,
test coverage.

Sections already filled in per Step 4 are left untouched.

Nothing that judges the solution goes here — complexity, estimate and risk
analysis belong to 3-solution.md (spec structure § Separation of content).

### Step 6: Create the implementation plan (3-solution.md)

Write to `specs/XX-slug/3-solution.md`. Follow the spec structure § 3-solution.

Sections already filled in per Step 4 are left untouched.

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

**Name the test command the Scope's file list actually resolves to.** Run
that list through the project's `testScopes` (the tools-and-scripts skill,
"Project commands"): a file matching no scope belongs to the root command,
and every scope with a file in it contributes its own. Write the resulting
command(s) into the plan verbatim — never leave the
`<project test command>` placeholder standing, and never name a command
that covers nothing the change touches.

Structure the plan with TDD:
- Step 0: Write tests (RED phase) — at least one failing test per acceptance criterion
- Step 1-N: Implementation (GREEN phase)
- Testing strategy (REFACTOR phase)

### Step 7: Review the plan

Attack the plan while the mistake is still cheap, before any test is
written: reviewers with distinct perspectives (feasibility, scope,
coherence) attack `3-solution.md`, findings become must-fix/should-fix,
and the plan is REVISED — not just annotated. See
`references/plan-review.md` for the full routine (scaled to complexity,
consolidation, and what gets written where).

Skip this step only when `3-solution.md` is still an empty template —
nothing was written in Step 6 to review.

### Step 8: Update 4-status.md

Write to `specs/XX-slug/4-status.md`. Follow the spec structure § 4-status.
- LOW: Simple checklist (< 30 lines)
- MEDIUM/HIGH: Phase-based tracking (50-100 lines)

Sections already filled in per Step 4 are left untouched.

Nothing in Tracking info records the step. Which steps a spec has had
is read off the spec's own commits, and `aide-run-spec` writes the
`Workflow steps completed:` line from them — leave that line exactly as
you found it.

A headless run gets its commit for free. Working interactively, ASK
whether to commit the analysis, and suggest this message so the step is
recognised the same way:

```text
Run /aide-analyze for <spec-folder>
```

Offer it only when the analysis actually completed; one that failed, or
that you stopped part-way, has nothing to record.

### Step 9: Confirm

Show a summary with complexity, number of affected files, the plan
review's verdict (counts of must-fix/should-fix, what was revised), and
the next step.

IMPORTANT:
- ALWAYS use the file:line format for references
- ALWAYS consider API impact (frontend ↔ backend)
- Match the scope of the documentation to the complexity
- Code blocks ALWAYS end with just ` ``` `

---

## Next step

```text
/aide-implement 55
```
