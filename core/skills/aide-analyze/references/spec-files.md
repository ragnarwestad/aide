# Spec files in detail

The spec-structure rule holds what every step needs about the four files.
This page holds the rest: what a step writes or reads only in some runs.
Read the section the step at hand needs.

## Table of contents

- [1-description: Tracking info and acceptance criteria](#1-description-tracking-info-and-acceptance-criteria)
- [3-solution: approaches, parts and tests](#3-solution-approaches-parts-and-tests)
- [4-status: the lines the runner writes](#4-status-the-lines-the-runner-writes)
  - [Workflow steps completed](#workflow-steps-completed)
  - [Total progress](#total-progress)
  - [Phase outcome record](#phase-outcome-record)
- [4-status: Acceptance criteria](#4-status-acceptance-criteria)

---

## 1-description: Tracking info and acceptance criteria

- Optionally a `Depends on:` line in Tracking info, naming the specs this
  one builds on (comma-separated; each identifier is either a bare number
  or a full `NN-slug` folder name — narrower than `/aide-analyze`'s
  resolver, which also takes `TODO-NN` and an issue key). `analyze`,
  `implement` and `archive` wait until every named spec has landed on
  the default branch; `create` runs regardless
- Optionally an `Acceptance criteria checks:` line in Tracking info —
  `off`, `warn` or `stop` — saying how strictly `/aide-analyze` checks
  the spec's acceptance criteria. `aide-run-spec` writes it after a
  create from the dashboard's New spec form; absent, or any other value,
  is `off`. It is chosen once, at create
- A `Let me choose the approach:` line in Tracking info — `yes` or `no` —
  written by `aide-run-spec` after every create from the New spec form,
  directly after the `Acceptance criteria checks:` line. `yes` asks
  `/aide-analyze` to mark each approach (see 3-solution below); absent, or any
  other value, is `no`
- A held-back spec taking another round on its open checks (see
  4-status's own Acceptance criteria section below) numbers a new id
  after the highest one already written — the same additive rule,
  applied to a second round rather than to the first draft
- `/aide-create` keeps every criterion a description already has, word
  for word and with its id, and may add criteria after the highest id
  (the aide-create skill has how)
- `/aide-analyze` never retrofits an Acceptance criteria section into
  an existing `1-description.md` on its own initiative — only original
  authoring (via `/aide-create`) adds one

---

## 3-solution: approaches, parts and tests

- Approaches with pros/cons, each a bold-paragraph lead (not a
  heading) — `**Approach A: [Name] (recommended).**` followed by
  Pros/Cons/Estimate. The choice itself stands as its own heading,
  `### Recommended: Approach X`, directly under Approaches, with the
  reasoning as plain text below it and its own line in the table of
  contents — a reader who jumps straight to the heading, or only scans
  the ToC, must still find the pick. The RECOMMENDED one IS the spec —
  every section below it describes that approach and no other, and
  `/aide-implement` builds the plan it finds. Wanting a different one
  means saying so in `1-description.md` and analysing again
  (change an acceptance criterion, then `/aide-analyze` again) — or, on a
  spec whose `Let me choose the approach:` line says `yes`, choosing it on
  the Specs list
- On such a spec every lead ends in one of three marks, and exactly one is
  `(recommended)`. The dashboard offers each approach marked recommended
  or real alternative, and writes the person's choice as a paragraph of
  its own directly under the Approaches heading. Analyze keeps that line;
  when it names an approach that is not the recommended one, the mark
  moves there and the plan below is written afresh for it. With `## Round
  N` sections, only the newest round's leads and chosen line count:

  ```markdown
  **Chosen approach:** Approach B

  **Approach A: [Name] (recommended).** [one-line description]

  **Approach B: [Name] (real alternative).** [one-line description]

  **Approach C: [Name] (considered and rejected).** [one-line description]
  ```

- Parts: one line per part the change needs that it does not have yet,
  `Reused:` or `New, because`, or the single `None — [why]` when it needs
  none
- Behavior delta: what the solution ADDS / MODIFIES / REMOVES relative to
  current behavior — not just which files change
- Acceptance criteria as given/when/then scenarios; the RED phase writes
  at least one failing test per criterion
- TDD approach with RED-GREEN-VERIFY phases
- Where the tests sit: one line per place — the public interface where
  the behaviour is observed, its test file, whether that file exists,
  and the rules tested there. As few places as cover the criteria, and a
  new one only where no existing test file observes the behaviour.
  `/aide-implement` writes its tests there; a criterion no test can reach
  gets no place, and the Manual testing note says why
- Manual testing is a NOTE, not a checklist: it names what no test
  covers and why. Nothing under it is a task, and nothing under it
  blocks archiving — 4-status has no row for it

---

## 4-status: the lines the runner writes

### Workflow steps completed

One line in Tracking info, saying how far a spec has got through the
workflow:

```markdown
- **Workflow steps completed:** create, analyze
```

The allowed values, in workflow order, are `create`, `analyze`, `implement`
and `archive`. A missing line means nothing is known to have completed;
an unknown value is ignored.

**Do not edit this line. It is written by `aide-run-spec`, from the
spec's own commits**: each step leaves a commit whose subject names the
step, `Run /aide-<step> for <spec-folder>`. A step run interactively
counts once committed under the same subject.

The line is only added to, with two exceptions: a reopen that resets
the files starts it afresh, and a completed analysis takes `implement`
and `archive` off, since the plan they were made from has been replaced.
A completed analysis of a spec that stood at `implemented` also clears
every row of `## Acceptance criteria` (a `Not verified` one too) and
rebuilds the table from the criteria in `1-description.md` as they read
now, one open row per `AC-n`; a row keeps its Notes cell only while its
criterion's text is unchanged.

### Total progress

One line, near the top of the file, saying how many of the file's own
Phase-table rows are done:

```markdown
- **Total progress:** 50% (2 of 4 completed)
```

**Do not edit this line by hand. `aide-run-spec` recomputes it** at the
end of every step from the file's own Phase-table rows: a row is done
when its Status cell reads `✅` or `Completed`.

### Phase outcome record

Each of the four phases writes its own outcome into the Tracking info
of the file that is ITS OWN artifact — never into 4-status.md on
another phase's behalf:

| Phase     | Own file         | Date field enriched |
|-----------|------------------|---------------------|
| create    | 1-description.md | `Created:`          |
| analyze   | 2-analysis.md    | `Last analyzed:`    |
| implement | 3-solution.md    | `Last updated:`     |
| archive   | 4-status.md      | `Last updated:`     |

The record, beside the file's own existing date field — never a new
one, the date already exists, only the time of day is new
(`` `YYYY-MM-DD HH:MM UTC` ``):

```markdown
- **Repo:** `repo-name/branch @ sha`
- **Model:** claude claude-sonnet-5
- **Model id:** claude-sonnet-5
- **Result:** completed
- **Time spent:** 4m12s
- **Cost:** $0.1234
```

`Repo` is one line per repo root; it is absent for `create`, since
nothing has been analyzed against yet. `Result` is `completed`, or
`stopped (<reason>)` with a one-line error summary. `Model id` is the model
Claude Code's own log named for the run, so an alias shows what it ran on;
it is absent when the log names none. `Cost` is absent
for a tool that reports no cost (codex) — absence means unknown, never
zero.

**Do not edit these lines. `aide-run-spec` writes them**, never from a
model's own account of itself. Each run OVERWRITES its phase's own
block with the newest outcome, with three exceptions that are added to
across runs: `Attempts` counts every run of the phase, and `Cost` and
`Tokens` are what they used together.

Older specs may carry `Model (create):`-style lines in `4-status.md`;
they are left as they are.

---

## 4-status: Acceptance criteria

When `1-description.md` has a `## Acceptance criteria` section,
`/aide-analyze` adds one more section to `4-status.md`, after the last
implementation phase and before `## Notation`, with exactly one row per
`AC-n` id from `1-description.md`, in ascending id order, carrying that
requirement's own SHALL text — never a scenario from `3-solution.md`'s
Acceptance criteria, which a user cannot judge and which can repeat
one id across several scenarios:

```markdown
## Acceptance criteria

| Task | Status | Notes |
|------|--------|-------|
| AC-1: <requirement text, verbatim from 1-description.md> | ⬜ | |
| AC-2: <requirement text, verbatim from 1-description.md> | ⬜ | |
```

Every row starts `⬜`, a `Not tested:` row too: a criterion no test
proves is one the user checks by hand. `Not verified` is a done mark like
`✅`: archiving does not wait for it, and the user can still tick it
later. Only the user writes it, when a check can only be made after
deploy — never a skill.

A `Not verified` row that was checked after the deploy and did not hold is
marked `❌ Failed`, with a Notes cell that starts `Failed:` and says what did
not hold. `❌ Failed` is not a done mark: archiving waits for it. Only the
user writes it (from the Specs list or the Status tab of an archived spec) —
never a skill. Reopening the spec puts the row back to `⬜` and keeps its
note, and a note starting `Failed:` on an open row counts as a changed
criterion for the rule that a new round needs one.

No Acceptance criteria section: `4-status.md` looks exactly as it does
today — no such section, no change to archiving.

**These rows start unticked, and no skill ever ticks one.** Unlike the
RED/GREEN/VERIFY rows above, an acceptance-criteria row names a
judgment only the user the spec is for can make — ticking it is the
same one-click Overview-tab action any other recognized row offers.
Placing the section after the last implementation phase means it only
becomes tickable once every earlier phase's own rows are done.

**`aide-archive-spec` refuses to archive while any of these rows is
still unticked**, with `terminalReason: "acceptance-criteria-unticked"`
— the one place a "must be ticked" gate exists in this file, scoped to
this section alone. A spec with no such section, or every row ticked,
archives exactly as it did before this section existed.

**A held-back spec may take another round on its open rows.**
`/aide-analyze` and `/aide-implement` may run again on a spec whose
archive is held back this way — a THIRD kind of restart, distinct
from a reopen that resets the files, which regenerates this table from
its template. A held-back round instead APPENDS while the session
works: it never rewrites the table, only an OPEN row's Notes cell may
gain text naming what the round still finds missing, and a genuinely
new `AC-n` id, numbered after the highest one already written, may be
appended as a new unticked row. When the analysis completes, the runner
then clears every tick and rebuilds the rows from the description, so
the person ticks each criterion again against the new code; a round
that starts with Implement keeps its ticks. The round may start
once at least one open row's own requirement text has changed since the
round that held it back, or a new `AC-n` id has been added — when none
has, the spec stays held back on Analyze and Implement alike, not only
on Archive.

**A reopened spec takes the same round.** `/aide-reopen` without a
reset (`aide-reopen-spec`) moves an archived or closed spec back into
the active list with `2-analysis.md`, `3-solution.md` and `4-status.md`
kept, and stamps a `**Round boundary:**` line after its
`**Archived:**` or `**Closed:**` line. A reopened spec has no open row
by construction, so the round it takes works on what changed since that
boundary instead: an `AC-n` id added to `1-description.md`, or an
existing criterion reworded whose row is still unticked. It follows the
rules above: ticked rows are left exactly as found, only `⬜` rows and
new ids are worked on, and with no new or changed criterion the spec
stays held back on Analyze and Implement. A spec reopened WITH a reset
starts from templates and is not in such a round.
