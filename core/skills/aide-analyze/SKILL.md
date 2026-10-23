---
name: aide-analyze
description: >-
  Analyze the codebase for a spec.
  Maps affected files with file:line references, grades the change's
  complexity (LOW/MEDIUM/HIGH) by its risk, and creates an implementation
  plan with TDD.
  Use when: analyzing the codebase for an existing task,
  filling in 2-analysis.md and 3-solution.md, needing an overview of
  affected files and API impact.
  Do NOT use for: creating a new task (use aide-create),
  implementation (use aide-implement).
argument-hint: "[PROJ-XXXX or task number]"
effort: xhigh
---

Analyze the codebase for a spec.

**Input:** $ARGUMENTS (all arguments after the command)

## Smart detection

Parse `$ARGUMENTS`:

**The spec:** the first word is its number, its `TODO-<name>` folder, or an issue key its title began with
- Example: `/aide-analyze 55` or `/aide-analyze TODO-01`

**Error handling:** If the argument is missing or has an invalid format, show:

```text
Missing argument

Usage:
/aide-analyze 55               # the spec's number
/aide-analyze TODO-01           # or its folder

Examples:
/aide-analyze 55
```

---

## Workflow

The steps below are this skill's own, inside the queue's `analyze` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `--- Step N of X: <title> — started`, and when
it ends, one line `--- Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 11, the merge into the default branch, is Aide's, after this
session: Aide writes its marks, and the analyze is finished only when it is
done.

### Step 1 of 11: Read the description

First write `--- Step 1 of 11: Read the description — started`, and when this step ends, `--- Step 1 of 11: Read the description — done`.


- Read `specs/XX-slug/1-description.md`
- Identify: What should change? What is the scope? Migration or single fix?
- If `1-description.md` has a `## Acceptance criteria` section, extract
  its `AC-n` ids for Steps 5, 7 and 8 — see `references/requirements-tracing.md`.
- **Learn the acceptance criteria checks level** — `off`, `warn` or
  `stop`, for Steps 7, 8 and 10. A headless run states it in the prompt
  (`criteriaChecks: <level>`). Working interactively, read the
  `Acceptance criteria checks:` line in Tracking info of the spec's own
  `1-description.md`. Absent or any other value is `off`.
- **Learn whether the spec asks to choose the approach**, for Steps 4,
  7 and 8. A headless run says so in the prompt (`Let me choose the
  approach is on for this spec`) and says nothing when it is not.
  Working interactively, read the `Let me choose the approach:` line in
  Tracking info of the spec's own `1-description.md`. Only `yes` is on.
- **Learn whether a short analysis is allowed**, for Steps 3, 5, 7, 8 and
  9. A headless run says so in the prompt, in the line `A short analysis is allowed for this spec, per Step 3`
  followed by the runner's limits, and says nothing when it is not.
  Working interactively there is no such line: write the full analysis. The runner sets
  the limits and checks the analysis against them after the turn. A spec whose
  `1-description.md` has a `Sent back to a full
  analysis:` line in Tracking info is never given a short analysis, run
  headless or not: implement found it is not small.
- If `4-status.md` ALSO already carries that same section plus a
  `**Round boundary:**` stamp, this is a held-back spec taking another
  round on its open checks, not a first analysis — see
  `references/requirements-tracing.md`'s own "A held-back spec's second
  round" section for how Steps 4-9 below scope to it.

**This skill never modifies anything outside the spec's own four
documents** — not application source, not test files, nothing in the
project repo, by any tool (Edit, Write, Bash included). If Step 7's own
"Recommended solution" reads as obviously correct and ready to apply,
stop anyway: applying it is `/aide-implement`'s job, in its own turn, not
something this skill does on its behalf because it happens to be
possible in the same session.

### Step 2 of 11: Analyze the codebase

First write `--- Step 2 of 11: Analyze the codebase — started`, and when this step ends, `--- Step 2 of 11: Analyze the codebase — done`.


Search the code for what the change touches. For each
function, format or interface the change modifies, ask once what depends
on it — how many callers, in how many parts — and keep the count with the
files it names. Step 3 grades the change from that count; how far to read
those files is the grade's to say.

**Look for what the project already has.** List every part the change
needs that it does not have yet: a component, a dialog, a form, a
helper, a script, a parser, a style rule, a test fixture. For each,
search the code for one that
already does the same, or would with a small change. Keep what you find,
with file:line, for the plan's Parts (Step 7).

**Where a symbol is used or defined, ask the language server first.**
When an `LSP` tool is listed, it is usually deferred: load it once with
`ToolSearch` (`select:LSP`) before the first search, then make the FIRST
search for where a function, type or constant is used or defined a
`findReferences` or `goToDefinition` call — never `grep`. It answers with
the real references, not every line that happens to contain the name.
Fall back to `grep` only when the language server gives no answer (it
errors, or the file's language has none), and for text that is not a
symbol — a message, a config key, a CSS class.

### Step 3 of 11: Grade the complexity

First write `--- Step 3 of 11: Grade the complexity — started`, and when this step ends, `--- Step 3 of 11: Grade the complexity — done`.


Grade the change LOW, MEDIUM or HIGH by its risk, from what Step 2 found,
with the criteria and the two worked examples in
`references/complexity-and-analysis.md`, the one place they are written.
Keep each factor with the files that show it, for Step 7's Scope.

Scale the analysis to the complexity:
- **LOW:** Find the file, read it, check tests. < 15 min.
- **MEDIUM:** Find dependencies, related files, API impact. 20-45 min.
- **HIGH:** Search broadly, categorize files, create a migration plan. 1-3 hours.

See `references/complexity-and-analysis.md` for detailed steps per level.

**Choose the analysis.** Write a SHORT analysis only when Step 1 found the
prompt line, this is not a held-back or reopened round, the description
has no `Sent back to a full analysis:` line, and the grade and
the number of source files among the paths the change will create, change
or delete (tests and Markdown pages are listed, as Step 5 says, but not
counted; see `references/spec-files.md`) are both within that line's limits. Otherwise write the
full analysis. In doubt about a count on the limit, write the full one.
A short analysis is the files to change and where the tests sit, under a
plain mark that there is no plan and no plan review; its shape is in
`references/spec-files.md`. The runner fails a short analysis over a
limit, so the choice is never worth stretching.

### Step 4 of 11: Check for work already begun

First write `--- Step 4 of 11: Check for work already begun — started`, and when this step ends, `--- Step 4 of 11: Check for work already begun — done`.


An earlier run stopped by its time limit lands what it wrote, so the
three files may already hold its answers. Read `specs/XX-slug/2-analysis.md`,
`3-solution.md` and `4-status.md` as they stand before writing anything.

A section is UNWRITTEN when it still holds its template's bracketed
placeholder text: `[not analyzed yet]`, `[filled in by analysis]`,
`[How the analysis was performed...]`, `[not started]`, and any other
bracketed stand-in the templates put there. Anything else is written,
whether an earlier run wrote it or this one did. The placeholder is the
only signal: a half-written section has its heading too.

Fill in the sections that still hold their placeholder. Leave every
section that already has real content exactly as it stands.

The `### Overlapping specs` subsection under Findings is never unwritten,
and is copied word for word, in a rewrite too: only `aide-spec-overlap
--record` (Step 6) writes it.

Four cases rewrite the three files instead, and
`references/work-already-begun.md` says what each keeps and what it
writes afresh. Run `aide-spec-overlap --specs-root <root> --spec XX-slug`,
then read that reference before writing anything when one of these holds:

- `2-analysis.md`'s Tracking info reads `Result: stopped
  (acceptance-criteria)` or `Result: stopped (short-analysis-over-limit)`
- the description's Tracking info has a `Sent back to a full analysis:`
  line, and `2-analysis.md` reads `Analysis: short`
- the newest round of `3-solution.md` records a `**Chosen approach:**`
  line under its Approaches heading
- the command lists a spec under `landed`

A held-back round (Step 1) is a different case from the above, not a
variant of it: `2-analysis.md`/`3-solution.md` are already fully
written from an earlier round, holding no placeholder at all, and this
round APPENDS a new `## Round N` subsection to each instead of leaving
them untouched — see `references/requirements-tracing.md`.

### Step 5 of 11: Update 2-analysis.md

First write `--- Step 5 of 11: Update 2-analysis.md — started`, and when this step ends, `--- Step 5 of 11: Update 2-analysis.md — done`.


Assemble the complete new text of `2-analysis.md` (sections already
filled in per Step 4 copied verbatim; placeholder sections replaced with
real content), then write it with:

    aide-write-spec --specs-root <specs-root> --folder XX-slug \
      --file 2-analysis.md <<'SPEC_EOF'
    <the complete file text>
    SPEC_EOF

Never use the Write or Edit tool on a spec file — `aide-write-spec` is
the only legitimate path. Follow the spec structure §
2-analysis. Include: Tracking info, mapping, affected files with
file:line, API impact, test coverage.

Under Findings, write `### Files to change`: one line for every file the
change will create, change or delete, the path from the project root in
backticks and nothing after it. A file the change only reads is not listed.
A held-back round's `## Round N` carries its own `### Files to change`.

    ### Files to change

    - `dashboard/src/queue/steps.ts`
    - `core/scripts/aide-spec-overlap`

Sections already filled in per Step 4 are left untouched.

In Tracking info, on every run and a held-back round's included, write
`- **Analysis:** short` or `- **Analysis:** full`: the analysis Step 3
chose, the latest one this file holds. A short analysis writes only the
sections `references/spec-files.md` names for it.

Nothing that judges the solution goes here — complexity, estimate and risk
analysis belong to 3-solution.md (spec structure § Separation of content).

When AC-n ids exist, see `references/requirements-tracing.md` for how
findings are prefixed with the AC-id(s) they support.

### Step 6 of 11: Compare with the other open specs

First write `--- Step 6 of 11: Compare with the other open specs — started`, and when this step ends, `--- Step 6 of 11: Compare with the other open specs — done`.


Run, with the specs root Step 1 found:

    aide-spec-overlap --specs-root <specs-root> --spec XX-slug --record

It reads the `### Files to change` Step 5 wrote, compares it with the
other analyzed specs of the project that are not archived, and answers
one JSON line.

- **`"overlaps":[]`:** the step ends `— done`, and Step 7 follows.
- **`overlaps` names a spec:** end the step stopped, naming every spec:
  `--- Step 6 of 11: Compare with the other open specs — stopped: shares files with <spec>, …`.
  Write nothing more: no plan, no review, no status. The session's last
  words name each spec, the files it shares with this one, and the two
  choices: add the specs to the spec's Depends on, so that its analysis
  runs again once they are archived, or run Analyze again to go on
  regardless.
- **The command is not installed:** the step ends `— skipped:
  aide-spec-overlap is not installed`, and Step 7 follows.

### Step 7 of 11: Create the implementation plan (3-solution.md)

First write `--- Step 7 of 11: Create the implementation plan (3-solution.md) — started`, and when this step ends, `--- Step 7 of 11: Create the implementation plan (3-solution.md) — done`.


Assemble the complete new text of `3-solution.md` the same way as Step 5,
then write it with `aide-write-spec --file 3-solution.md` (never
Write/Edit). Follow the spec structure § 3-solution.

Sections already filled in per Step 4 are left untouched.

In Tracking info, on every run, write `- **Grade:** LOW` (or `MEDIUM`,
`HIGH`: Step 3's grade) and `- **Acceptance criteria:** <n>`, the number of
`- **AC-n:**` lines in `1-description.md`. The runner reads both.

**A short analysis writes the short shape and nothing more** — the
`## Short analysis` sentence, Scope, and Testing with Where the tests sit,
as `references/spec-files.md` gives it — and the rest of this step does not
apply to it. A full analysis writes everything
`references/implementation-plan.md` gives: Scope, Approaches, Behavior
delta, Parts, Risk analysis, Acceptance criteria, the test command, Where
the tests sit and the TDD tasks. Read it before writing a full
`3-solution.md`.

### Step 8 of 11: Review the plan

First write `--- Step 8 of 11: Review the plan — started`, and when this step ends, `--- Step 8 of 11: Review the plan — done`.


Attack the plan while the mistake is still cheap, before any test is
written: reviewers with distinct perspectives (feasibility, scope,
coherence) attack `3-solution.md`, findings become must-fix/should-fix,
and the plan is REVISED — not just annotated. See
`references/plan-review.md` for the full routine (three reviewers at
every complexity, consolidation, and what gets written where). Hand the Feasibility and
Coherence reviewers the acceptance criteria checks level from Step 1:
Feasibility makes the cannot-be-built check at that level, Coherence the
other four, and the Plan review section's `**Criteria check:**` line
names what still stands of both. Tell the Coherence reviewer, too,
whether the spec asks to choose the approach. The Scope guardian holds
the plan to the description's `## Out of scope` section, when it has
one, at every level.

Skip this step when `3-solution.md` is still an empty template —
nothing was written in Step 7 to review — and for a short analysis, which
has no plan to review: `--- Step 8 of 11: Review the plan — skipped: a
short analysis has no plan to review`.

When AC-n ids exist, see `references/requirements-tracing.md` for the
must-fix check on missing coverage.

### Step 9 of 11: Update 4-status.md

First write `--- Step 9 of 11: Update 4-status.md — started`, and when this step ends, `--- Step 9 of 11: Update 4-status.md — done`.


Assemble the complete new text of `4-status.md` the same way as Step 5,
then write it with `aide-write-spec --file 4-status.md` (never
Write/Edit). Follow the spec structure § 4-status.
- A short analysis: the template's four phase tables, one row each, the
  last one `Run the full test suite`, and no `## Plan review` section
- LOW: Simple checklist (< 30 lines)
- MEDIUM/HIGH: Phase-based tracking (50-100 lines)

Sections already filled in per Step 4 are left untouched.

When AC-n ids exist, see `references/requirements-tracing.md` Step 9
for the `## Acceptance criteria` section this file gains — one row per
AC-n id, unticked, for the user the spec is for to judge and tick,
never for this skill or `/aide-implement` to tick themselves.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits — leave that line exactly as you found it. The same script
writes this phase's `Repo`/`Model`/`Result`/`Time spent`/`Cost` block
into `2-analysis.md`'s own Tracking info — leave those lines alone too.

A headless run gets its commit for free — this session does not run
`git commit` or `git push` itself, headless or not. Working
interactively, ASK whether to commit the analysis, and suggest this
message so the step is recognised the same way:

```text
Run /aide-analyze for <spec-folder> (model: <tool> <model>)
```

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses.

Offer it only when the analysis actually completed; one that failed, or
that you stopped part-way, has nothing to record.

### Step 10 of 11: Confirm

First write `--- Step 10 of 11: Confirm — started`, and when this step ends, `--- Step 10 of 11: Confirm — done`.

In a headless run nothing of this is on the default branch yet: the
analyze is finished only once Step 11, the merge into main, is done. So the
report's first line ends `— not finished, the merge into main is next
(Step 11)`, and the report never calls the analyze done or complete.


Show a summary with complexity, which analysis was written (short or
full), number of affected files, the plan
review's verdict (a short analysis has none) (counts of must-fix/should-fix, what was revised), the
Criteria check line, and the next step.

At `stop` with a fault on that line, a headless run is ended stopped by
Aide after this session, and the next step is to put the description
right and run Analyze again. Working interactively there is no runner
to stop it: say that the analysis would have ended stopped, and that the
description is to be put right before `/aide-implement`.

### Step 11 of 11: Merge into main

Aide writes `--- Step 11 of 11: Merge into main — started` itself, after this session, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. In a headless
run Aide merges what this session committed on the spec's branch into
the default branch once the session has ended, and the analyze is finished
when that merge is, not before. Working interactively there is no such
step: the steps above say what reaches the default branch.

---

## Next step

```text
/aide-implement 55
```
