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
3. Read the relevant coding standard (frontend or backend)

### Phase 1: RED — Write failing tests

1. Read "Step 0" and the acceptance criteria from 3-solution.md
2. Create test files — at least one failing test per acceptance criterion
3. Run the tests — verify that they FAIL
4. **STOP** — ask the user for confirmation before GREEN

### Phase 2: GREEN — Implement until tests pass

1. Implement each step from 3-solution.md
2. Run the tests after each step
3. Verify that the tests PASS
4. **STOP** — ask the user for confirmation before REFACTOR

### Phase 3: REFACTOR — Quality check

1. Full test suite (no regressions)
2. TypeScript check
3. ESLint
4. Build
5. Update 4-status.md
6. Show a summary — ready for commit

See `references/tdd-phases.md` for the detailed workflow with commands
and expected output per phase.

IMPORTANT:
- **STOP** at every phase transition and ask for confirmation
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
