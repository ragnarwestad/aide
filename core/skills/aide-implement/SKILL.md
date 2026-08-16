---
name: aide-implement
description: >-
  Implement the solution for a JIRA issue or TODO plan with Test-Driven
  Development (RED → GREEN → REFACTOR). Reads the existing analysis and plan,
  writes tests first, implements, and runs the quality check.
  Use when: implementing a solution with TDD, having a completed analysis and
  implementation plan, coding based on 3-solution.md.
  Do NOT use for: creation (use aide-create),
  analysis (use aide-analyze), tests only without implementation (use aide-make-tests).
argument-hint: "[PROJ-XXXX or task number]"
effort: high
---

Implement the solution for a JIRA issue or TODO plan with TDD.

**Input:** $ARGUMENTS (all arguments after the command)

## Smart detection

Parse `$ARGUMENTS`:

**JIRA mode:** If the first word is a JIRA key: `[A-Z][A-Z0-9]*-[0-9]+` (any project prefix, e.g. `PROJ-7890`, `MEL-123`). `TODO-` is never a JIRA key — TODO mode wins.
- Example: `/aide-implement PROJ-7890`

**TODO mode:** If the first word is a number or starts with `TODO-`
- Example: `/aide-implement 55` or `/aide-implement TODO-01`

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing argument

Usage:
/aide-implement PROJ-XXXX     # For JIRA issue
/aide-implement 55               # For task (number)
/aide-implement TODO-01           # For TODO plan
```

---

## Workflow

### Preparation

1. Read `specs/XX-slug/2-analysis.md` (affected files)
2. Read `specs/XX-slug/3-solution.md` (implementation plan)
3. If the spec is MEDIUM/HIGH and `3-solution.md` has no "Plan review"
   section: suggest running `/aide-review-plan` first (proceed if the
   user declines)
4. Read the relevant coding standard (frontend or backend)

### Phase 1: RED — Write failing tests

1. Read "Step 0" and the acceptance criteria from 3-solution.md
2. Run `aide-emit-run --phase red --spec <ID>` (see [Reporting the phase](#reporting-the-phase))
3. Create test files — at least one failing test per acceptance criterion
4. Run the tests — verify that they FAIL
5. Report the RED result briefly and continue to GREEN

### Phase 2: GREEN — Implement until tests pass

1. Run `aide-emit-run --phase green --spec <ID>`
2. Implement each step from 3-solution.md
3. Run the tests after each step
4. Verify that the tests PASS
5. Report the GREEN result briefly and continue to REFACTOR

### Phase 3: REFACTOR — Quality check

1. Run `aide-emit-run --phase refactor --spec <ID>`
2. Full test suite (no regressions)
3. TypeScript check
4. ESLint
5. Build
6. Update 4-status.md
7. Show a summary — ready for commit

### Reporting the phase

One Bash call at the start of each phase, with the spec's ID:

```bash
aide-emit-run --phase red --spec 81
```

It is a fire-and-forget report, not a gate: it prints nothing, never
asks anything, always exits 0, and does nothing at all unless
`AIDE_RUN_URL` is set. A run that reports its phases can be followed
from the dashboard while it works; the three phases still run through
without stopping.

See `references/tdd-phases.md` for the detailed workflow with commands
and expected output per phase.

IMPORTANT:
- Run all three phases through WITHOUT stopping to ask for
  confirmation — report each phase's result as you pass it. Stop only
  when genuinely blocked (a decision only the user can make, or a
  phase that cannot be completed)
- NEVER skip tests
- Follow the coding standard strictly
- Code blocks ALWAYS end with just ` ``` `

---

## Quality check

Use the project's own test/lint/build commands — detect them, never assume
a toolchain (see the "Project commands" section of the tools-and-scripts
rules). Example for a pnpm/TypeScript project:

```bash
pnpm test -- --run    # All tests
npx tsc --noEmit      # TypeScript check
pnpm run eslint       # ESLint
pnpm run build        # Build
```

Example for a Maven/Gradle backend:

```bash
./gradlew test        # or: mvn test
./gradlew build       # or: mvn verify
```

---

## After implementation

1. Test manually (follow the test plan from 3-solution.md)
2. Commit the changes
