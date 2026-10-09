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
- **Read the project's wiki, when it has one, before anything else —
  in a later round too, before the earlier round's files.** The specs
  root is the folder that holds this spec's folder. If `wiki/` is beside
  it, run `aide-wiki status --specs-root <root> --project-dir .`, read
  `wiki/index.md`, then the pages that concern the change. A page whose
  state is `changed` or `unknown` is a map of where to look, and the
  code decides. Read only the ordinary pages that status returns; they
  hold the current rules and their reasons, whatever an older index
  still links to.

  When the answer is `"wiki":false`, or `aide-wiki` is not installed, or
  it answers `unknown-subcommand`, skip this and write nothing about a
  wiki.

  With a wiki, always read `wiki/overview.md` — the project's stack, the
  services it depends on, how it is built and deployed, and its docs —
  and `wiki/reusable-parts.md`, whatever the change. A page `status`
  lists under `missing` is noted `missing` on the **Wiki pages used**
  line (Step 5), and nothing is read in its place.
- **Read the project's reusable parts, after the wiki and before
  Step 2.** With a wiki, they are the files `wiki/reusable-parts.md`
  names, each a path from the project root, and the rules it gives for
  using them. Without a wiki, they are the paths the manifest's `reuse`
  key lists: the files and folders where the project keeps its reusable
  parts and the rules for using them. Read a file whole, and a folder
  file by file. Note each path as `read`, or `missing` when it does not
  exist, for Step 5. A project with neither has nothing named to read,
  and Step 2's search runs all the same.
- **Only in a project with no wiki,** read `.aide/project.yaml` in the
  project root if it exists — the project manifest gives deployment,
  logging and dependency context the analysis should use (refresh it
  with `/aide-manifest`). With a wiki, the project's context comes from
  `wiki/overview.md` and the manifest is not read.
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


Search the code from where the wiki pages read in Step 1 point. For each
function, format or interface the change modifies, ask once what depends
on it — how many callers, in how many parts — and keep the count with the
files it names. Step 3 grades the change from that count; how far to read
those files is the grade's to say.

**Look for what the project already has.** List every part the change
needs that it does not have yet: a component, a dialog, a form, a
helper, a script, a parser, a style rule, a test fixture. For each, look
in the reusable parts Step 1 read (the files `wiki/reusable-parts.md`
named, or what the `reuse` key named without a wiki) and search the code for one that
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

One exception: when `2-analysis.md`'s Tracking info reads `Result:
stopped (acceptance-criteria)`, the earlier run stopped on the
acceptance criteria, and the description has been put right since.
Treat every section that run wrote as unwritten, and write the three
files afresh. On a held-back round, replace that round's own `## Round
N` subsections rather than appending a new round.

A second exception: the newest round of `3-solution.md` records a
`**Chosen approach:** Approach X` line under its Approaches heading, and
that approach's lead is not the one marked `(recommended)`. The person
chose another approach on the Specs list. Move `(recommended)` to the
chosen approach's lead and give the lead that carried it `(real
alternative)`; keep every other lead and the chosen line word for word.
Write `### Recommended:` and every section below it afresh for the chosen
approach, and `4-status.md`'s phase tables for the new plan. Leave
`2-analysis.md` as it stands. A chosen line on the recommended approach
needs nothing: the choice is made, and is never asked again.

A third exception: `aide-spec-overlap --specs-root <root> --spec XX-slug`
lists a spec under `landed`. The analysis was made against code that has
changed since, so treat every section as unwritten and write the three
files afresh, keeping `### Overlapping specs` as it stands. Step 6's
`--record` then drops the archived spec from the record, so the rewrite
happens once.

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

When Step 1 read the wiki, the `## Mapping` section gets a line **Wiki
pages used** listing each page with its state: `current`;
`changed since its commit — files: <changedFiles>`; `unknown`; or
`hand-written — freshness not tracked`; and each page `status` lists
under `missing` as `missing`. Without a wiki, no such line.

When Step 1 read the reusable parts, the `## Mapping` section gets a
line **Reuse paths read** listing each path with `read` or `missing`:
the files `wiki/reusable-parts.md` named, or with no wiki the paths the
`reuse` key names. With neither, no such line.

Sections already filled in per Step 4 are left untouched.

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

**Scope:** the files to change, the complexity grade with each factor that
set it and the files that show it (Step 3), and the estimate for manual and
AI-assisted development.

**Approaches:** when the spec asks to choose the approach (Step 1), every
approach lead ends in one of three marks, letters A, B, C in order, as the
spec structure shows: `(recommended)` on exactly one, `(real alternative)`
on each other approach a person could reasonably pick instead, and
`(considered and rejected)` on one that fails a requirement or is plainly
worse. The Specs list offers the person every approach marked recommended
or real alternative, so an approach left unmarked is never offered
(`references/spec-files.md` has the format and the chosen line). When
the spec does not ask, only the recommended lead carries a mark. Never write or remove a
`**Chosen approach:**` line: the dashboard writes it.

**Behavior delta:** state what the chosen solution ADDS / MODIFIES / REMOVES
in behavior, relative to how the system works today — not just which files
change (those are listed under Scope).

**Parts:** a `### Parts` subsection under Recommended solution, with one
line for every part the change needs that it does not have yet (Step 2):

    - **<the part>** — Reused: <what, with file:line>
    - **<the part>** — New, because <why nothing existing does it>

A New reason names what was looked at and why it does not do the job. A
change that needs no part of its own writes the one line
`- None — <why>`, so an empty list is never mistaken for a forgotten one.

**Risk analysis:** the risks the chosen solution carries, each with
consequence, probability and mitigation.

**Acceptance criteria:** testable given/when/then scenarios. Each criterion
must be verifiable by a test — if you cannot phrase the test, the criterion
is too vague. When AC-n ids exist, see `references/requirements-tracing.md`
for how each criterion opens with the AC-id it covers.

Unless the level is `off`, a criterion with a WHEN, WHILE or WHERE
condition, wherever the condition is written, also gets a scenario for
the case where that condition does not hold: what the system does then.

End a criterion with *(browser)* when only a real browser can answer it:
whether something is displayed, where it sits on the screen, what
scrolls, what moves when its text changes. What the markup or the
stylesheet says is not a browser question, and a criterion without the
tag is tested the ordinary way. `/aide-implement` writes a browser test
for every tagged criterion.

**Name the project's test command.** `aide-resolve-test-cmd --project-dir .`
prints it (the manifest's `AIDE_TEST_CMD`, the tools-and-scripts skill,
"Project commands"). Write it into the plan verbatim — never leave the
`<project test command>` placeholder standing.

**Where the tests sit:** a `### Where the tests sit` subsection under
Testing, one line per place: the public interface where the behaviour is
observed, its test file, whether that file exists, and the rules tested
there (the AC-ids). As few places as cover the criteria, and a new place
only where no existing test file observes the behaviour — the testing
rule's "One place per rule", decided before any test is written. A
criterion no test can reach gets no place: the Manual testing note says
why.

    - **<public interface>** in `<test file>` (existing|new) — <AC-ids, or the rule in words>

Structure the plan with TDD:
- Task 0: Write tests (RED phase) — at least one failing test per acceptance criterion with a place, at the places Where the tests sit names
- Task 1-N: Implementation (GREEN phase)
- Testing strategy (VERIFY phase)

Call a plan item a task, never a step: a step is what the queue runs, or
a numbered section of a skill such as this one, and a log that says
"Step 8" must mean one of those.

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

Skip this step only when `3-solution.md` is still an empty template —
nothing was written in Step 7 to review.

When AC-n ids exist, see `references/requirements-tracing.md` for the
must-fix check on missing coverage.

### Step 9 of 11: Update 4-status.md

First write `--- Step 9 of 11: Update 4-status.md — started`, and when this step ends, `--- Step 9 of 11: Update 4-status.md — done`.


Assemble the complete new text of `4-status.md` the same way as Step 5,
then write it with `aide-write-spec --file 4-status.md` (never
Write/Edit). Follow the spec structure § 4-status.
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


Show a summary with complexity, number of affected files, the plan
review's verdict (counts of must-fix/should-fix, what was revised), the
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
