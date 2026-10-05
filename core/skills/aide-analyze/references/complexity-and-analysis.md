# Complexity detection and analysis patterns

## Classification

The grade is set in Step 3, from what Step 2's search found: it is the
risk of the change, and the code says what that is. Three factors decide
it, in this order.

**1. Reach** sets the starting band: how much other code depends on the
existing code the change modifies. New code counts for nothing until
something uses it.

| Reach                                                 | LOW                                                   | MEDIUM                                | HIGH                                                                                                |
|-------------------------------------------------------|-------------------------------------------------------|---------------------------------------|-----------------------------------------------------------------------------------------------------|
| What depends on the existing code the change modifies | nothing outside the change, or one caller             | several callers inside one part       | a shared module used across parts, an interface between two parts, or a stored data format          |

**2. Behaviour.** When the change only adds behaviour — every existing
caller and user gets what it got before, and something new is offered
beside it — the band drops by one, to LOW at the least. Every other change
keeps the band: one that alters or removes what callers or users get, a
bug fix included, and one that adds nothing, such as a refactor, which
rewrites the code existing behaviour runs through.

**3. Acceptance criteria.** Four or more raise a LOW to MEDIUM. They never
raise a grade to HIGH: a long list is more to check, not more that can
break.

**What does not decide it.** The number of files is written beside the
grade as a signal and never raises it; many files in a LOW spec are a
reason to look again at what depends on them. The words of the
description decide nothing: "all", "entire", "migrate" or a named file
say what changes, and the code says what depends on it.

**How it is written.** In `3-solution.md`'s Scope, the grade, then one
line per factor with its band or count and the files that show it: for
reach, the code that depends on what the change modifies, with file:line;
for behaviour, the code whose behaviour changes, or, for a change that
only adds, the new files and the existing line that calls them; for the
criteria, `1-description.md`. Then the number of files, marked as a
signal.

### Worked example: shared code, few files

The date helper every page uses returns `—` instead of an empty string
for a missing date. Two files change: `src/format/date.ts` and its test.

- **Reach: HIGH** — `formatDate` (`src/format/date.ts:12`) is called from
  37 files in four parts (`src/pages/report.ts:40`, `src/api/export.ts:88`,
  …).
- **Behaviour: changes** (`src/format/date.ts:15`, the missing-date
  branch) — a caller that showed nothing for a missing date now shows
  `—`, so the band stays HIGH.
- **Acceptance criteria: 1** (`1-description.md`) — raises nothing.
- **Files: 2** — a signal.

**Grade: HIGH.**

### Worked example: a large, self-contained addition

A new report page: its route, renderer, stylesheet and tests, fourteen
new files, and one line in the route table. Nine acceptance criteria.

- **Reach: LOW** — the one existing code modified is the route table
  (`src/routes.ts:20`), read in one place (`src/server.ts:55`); nothing
  existing calls the new code.
- **Behaviour: adds only** (the new files under `src/pages/report/`,
  called from `src/routes.ts:20`) — every existing page works as before;
  the band is already LOW.
- **Acceptance criteria: 9** (`1-description.md`) — raise LOW to MEDIUM.
- **Files: 15** — a signal; it raises nothing.

**Grade: MEDIUM.**

## Analysis per level

### LOW (Quick Fix, < 15 min analysis)

1. Find the single file
2. Read the file, identify line numbers
3. Check whether tests exist
4. Document the findings (< 80 lines in 2-analysis.md)

### MEDIUM (Component analysis, 20-45 min)

1. Find the main file
2. Read it and identify dependencies (imports/exports)
3. Find related files (tests, consumers of the component)
4. Check API impact (use the project's API docs if any, else search the backend code)
5. Document all affected files with file:line (100-200 lines)

### HIGH (Broad analysis, 1-3 hours)

1. Search broadly for patterns in the codebase
2. Categorize files: LOW/MEDIUM/HIGH complexity per file
3. Analyze ripple effects and API impact
4. Create a phase-based migration plan (pilot → batch 1 → batch 2 → complex)
5. Document with categorization and migration plan (200-400 lines)

## Example: Expected output (MEDIUM)

```text
Codebase analysis completed for XX-slug

Findings:
- Complexity: MEDIUM — reach MEDIUM (the forms' callers, inside one part); a refactor keeps the band; 15 files, a signal
- Type: Refactoring
- Risk level: Low

Affected files (categorized):
LOW complexity (8 files):
- src/forms/SimpleForm.tsx:12 (< 10 fields, basic validation)
- src/forms/ContactForm.tsx:45 (simple form)

MEDIUM complexity (5 files):
- src/forms/UserProfileForm.tsx:120 (15 fields, sync validation)
- src/forms/AddressForm.tsx:89 (custom components)

HIGH complexity (2 files):
- src/forms/WizardForm.tsx:234 (multi-step, FieldArray)
- src/forms/DynamicForm.tsx:456 (async validation)

Implementation plan created:
- Phase 1: Pilot (3-5 simple forms) - 1-2 days
- Phase 2: Batch 1 (LOW complexity) - 3-5 days
- Phase 3: Batch 2 (MEDIUM complexity) - 5-7 days
- Phase 4: Complex forms - 2-3 days

Files updated:
- specs/XX-slug/2-analysis.md
- specs/XX-slug/3-solution.md
- specs/XX-slug/4-status.md
```
