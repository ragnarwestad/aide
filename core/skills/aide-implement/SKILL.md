---
name: aide-implement
description: >-
  Implement the solution for a JIRA issue or TODO plan with Test-Driven
  Development (RED → GREEN → REFACTOR). Reads the existing analysis and plan,
  writes tests first, implements, and runs the quality check.
  Use when: implementing a solution with TDD, having a completed analysis and
  implementation plan, coding based on 3-solution.md.
  Do NOT use for: creation (use aide-create),
  analysis (use aide-analyze).
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
   section: suggest re-running `/aide-analyze` first (proceed if the
   user declines)
4. Read the relevant coding standard (frontend or backend)
5. Read `specs/XX-slug/4-status.md`'s phase table. A step
   stopped by its time limit commits what it wrote, and that work is
   landed rather than left on a branch — so an earlier run may already
   have finished some of the phases below. A phase whose tasks are all
   ✅ is done: skip it. A phase marked 🔄, with some tasks ✅ and some
   ⬜: keep the ✅ ones and resume at the first ⬜. Start at Phase 1
   only when every phase is still ⬜ Not started.

### Phase 1: RED — Write failing tests

Skip this phase entirely if Preparation step 5 found it already done;
resume it at the first unticked task if it found it in progress.

1. Read "Step 0" and the acceptance criteria from 3-solution.md
2. Run `aide-emit-run --phase red --spec <ID>` (see [Reporting the phase](#reporting-the-phase))
3. Create test files — at least one failing test per acceptance criterion
4. Run the tests — verify that they FAIL
5. Tick this phase's task rows in `4-status.md` — ✅ once a row's test is
   written and confirmed to fail, not merely planned. Write the result
   with `aide-write-spec --file 4-status.md` (never Write/Edit — spec 282)
6. Report the RED result briefly and continue to GREEN

### Phase 2: GREEN — Implement until tests pass

1. Run `aide-emit-run --phase green --spec <ID>`
2. Implement each step from 3-solution.md
3. Run the tests after each step
4. Verify that the tests PASS
5. Tick this phase's task rows in `4-status.md` as each one's tests turn
   green. Write the result with `aide-write-spec --file 4-status.md`
   (never Write/Edit — spec 282)
6. Report the GREEN result briefly and continue to REFACTOR

### Phase 3: REFACTOR — Quality check

1. Run `aide-emit-run --phase refactor --spec <ID>`
2. Full test suite (no regressions) — the command(s) covering the files
   this run ACTUALLY changed, worked out from the project's `testScopes`
   (see [Quality check](#quality-check)), never the whole project's
   command by habit
3. TypeScript check
4. ESLint
5. Build
6. Tick this phase's task rows in `4-status.md` as each check above
   passes. Write the result with `aide-write-spec --file 4-status.md`
   (never Write/Edit — spec 282)
7. Update 4-status.md — the "Run the full test suite" row's Notes cell
   names the command(s) that ran, and, when the project has `testScopes`
   naming a scope nothing changed in, says that scope was left untested.
   Write it the same way, with `aide-write-spec --file 4-status.md`
8. Show a summary — ready for commit

In a Tasks table's Status cell, write the SYMBOL its Notation section
gives — `✅`, `⬜`, `🔄` — never the word beside it, and never both
together (`✅ Completed` is wrong the same way `Completed` alone is —
spec 283). The dashboard reads both forms, but a file that spells the
same state two ways is a file whose own legend has stopped describing
it.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits — leave that line exactly as you found it. The same script
writes this phase's `Repo`/`Model`/`Result`/`Time spent`/`Cost` block
into `3-solution.md`'s own Tracking info — leave those lines alone too.

The percentage above it is still yours: it says how far
the TDD phases got, which is the field for partial work.

A headless run gets its commit for free. Working interactively, ASK
whether to commit the work, and suggest this message so the step is
recognised the same way:

```text
Run /aide-implement for <spec-folder> (model: <tool> <model>)
```

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses.

Offer it only once the verification in this phase has passed. A red
suite, a failing build or a phase you could not finish is not a step
that completed.

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

**A run tests what it changed.** If the project's manifest has a
`testScopes:` list, sort the files this run actually changed
(`git status`/`git diff --name-only`, not the plan's intentions) into
their scopes by the rule the tools-and-scripts skill gives, and run every
scope's command that has a file in it — plus the root command if any file
matched no scope. A change reaching both halves runs both; a change
reaching one runs one. A project with no `testScopes:` runs its one
command, exactly as before.

Then say so in `4-status.md`: the "Run the full test suite" row's Notes
cell names the command(s) that ran, and — only when `testScopes` names a
scope this run changed nothing in — names that scope as **left
untested**, so a reader sees what was not tried instead of assuming
everything was.

---

## After implementation

1. Optional: read the Manual testing note in 3-solution.md. It names what no
   test covers and why — a thing to look at when you get the chance, never a
   step that has to be completed before the spec is done
2. Commit the changes
