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
   with `aide-write-spec --file 4-status.md` (never Write/Edit)
6. Report the RED result briefly and continue to GREEN

### Phase 2: GREEN — Implement until tests pass

1. Run `aide-emit-run --phase green --spec <ID>`
2. Implement each step from 3-solution.md — before writing to a file,
   check its current line count against any limit the project's coding
   standard states (e.g. dashboard/CLAUDE.md's "Code health" section),
   and split by responsibility instead of appending past it
3. Run the tests after each step
4. Verify that the tests PASS
5. Tick this phase's task rows in `4-status.md` as each one's tests turn
   green. Write the result with `aide-write-spec --file 4-status.md`
   (never Write/Edit)
6. Report the GREEN result briefly and continue to REFACTOR

### Phase 3: REFACTOR — Quality check

1. Run `aide-emit-run --phase refactor --spec <ID>`
2. Resolve the full-suite command(s) with `aide-resolve-test-cmd
   --project-dir .` — the same script the archive gate calls, so the
   two agree on what "the tests" means for this commit by construction
   (see [Quality check](#quality-check)). It prints one JSON line whose
   `commands` array holds every command the changed files fall under.
   Hand each of them to the script that runs and records them —
   never run it directly and self-report the result:

   ```bash
   aide-record-test-run --project-dir . --specs-root <specs-root> \
     --folder <NN-slug> --cmd "<command 1>" [--cmd "<command 2>" ...]
   ```

   A missing command (nothing configured, nothing detected) is passed as
   `--cmd ""` — the script still writes a record, naming the gap in
   plain words rather than silently passing, and the step reports that
   gap to whoever is watching.
3. TypeScript check
4. ESLint
5. Build
6. Tick this phase's task rows in `4-status.md` as each check above
   passes — the full-suite row ticks ✅ only once
   `aide-record-test-run`'s own exit code is 0, never because the model
   believes the suite passed. Write the result with `aide-write-spec
   --file 4-status.md` (never Write/Edit)
7. Update 4-status.md — the "Run the full test suite" row's Notes cell
   names the command(s) that ran, and, when the project has `testScopes`
   naming a scope nothing changed in, says that scope was left untested.
   Write it the same way, with `aide-write-spec --file 4-status.md`
8. Before reporting anything: confirm every row in this phase's own
   table now reads ✅. This step is not optional and is not satisfied by
   the checks above having passed — it is a separate, required write,
   the last one this phase makes, and it is the one step reported "done"
   without it having actually happened.
9. Show a summary — ready for commit

**Find a phase's table by its HEADING TEXT, never by its number.** This
skill has three phases; `4-status.md` has four, because its GREEN work
is split into implementing and verifying. So RED is `## Phase 1: RED`
there, this skill's GREEN covers BOTH `## Phase 2: GREEN - Implement`
and `## Phase 3: GREEN - Verify tests`, and REFACTOR is
`## Phase 4: REFACTOR`. A tick placed by matching "Phase 3" to this
skill's third phase lands in the wrong table.

In a Tasks table's Status cell, write the SYMBOL its Notation section
gives — `✅`, `⬜`, `🔄` — never the word beside it, and never both
together (`✅ Completed` is wrong the same way `Completed` alone is
wrong). The dashboard reads both forms, but a file that spells the
same state two ways is a file whose own legend has stopped describing
it.

None of the three phases above ever ticks a row under a `## Acceptance
criteria` heading, if `4-status.md` has one — never tick that section.
Those rows name the spec's own REQ-tagged acceptance criteria, and
ticking one is a judgment only the person the spec is for can make.
Leave them exactly as you found them, in every phase.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits — leave that line exactly as you found it. The same script
writes this phase's `Repo`/`Model`/`Result`/`Time spent`/`Cost` block
into `3-solution.md`'s own Tracking info — leave those lines alone too.

The percentage above it is still yours: it says how far
the TDD phases got, which is the field for partial work.

A headless run gets its commit for free — this session does not run
`git commit` or `git push` itself, headless or not. Working
interactively, ASK whether to commit the work, and suggest this message
so the step is recognised the same way:

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

**A run tests what it changed.** `aide-resolve-test-cmd --project-dir .`
sorts the files this run actually changed (the branch's diff against
the default branch, not the plan's intentions) into the scopes
`.aide/config` declares (`AIDE_TEST_SCOPE_PATHS_N` / `AIDE_TEST_SCOPE_CMD_N`,
the config-file form of the manifest's `testScopes:` — see the
tools-and-scripts skill) and prints every scope's command that has a
file in it. A change reaching both halves runs both; a change reaching
one runs one; a change under no declared scope runs every scope's
command, never none. A project with no scopes declared gets its one
`AIDE_TEST_CMD`, exactly as before. Use the script's answer; never
reason the rule out again in prose.

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
