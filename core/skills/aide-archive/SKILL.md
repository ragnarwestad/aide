---
name: aide-archive
description: >-
  Archive a finished spec and feed its durable knowledge back into the
  project's living documentation — resolving the branch's merge conflict
  with the default branch first, if there is one.
  Use when: a JIRA issue or TODO plan is done, closing out a spec,
  cleaning up the specs root, a spec's branch conflicts with the default
  branch.
  Do NOT use for: creating specs (use aide-create), unfinished work,
  deleting specs.
argument-hint: "[<JIRA-KEY> or task number]"
effort: medium
---

Archive a finished spec: settle any merge conflict on its branch, stamp
it, move it to `archive/`, and merge what should outlive it into the
project's living documentation.

**Input:** $ARGUMENTS (a JIRA key, a task number, or a full folder ID)

## Why this step exists

Specs are write-only until they are archived: the analysis and the
decisions stay buried in the spec folder. Archiving closes the loop —
the folder moves out of the active list, and the durable knowledge moves
into documentation that future work actually reads.

Archive is also the step that LANDS the spec's branch, which is why a
merge that fails is its problem and not a phase of its own (spec 171).

## Workflow

### Step 1: Finish the merge, if one is open

Before anything else, in the project's working directory:

```bash
git rev-parse -q --verify MERGE_HEAD
```

**It answers nothing:** there is no conflict. Go straight to Step 2 —
this is the ordinary case and costs one command. (Step 2 resolves the
ARGUMENT to a folder; it has nothing to do with the merge.)

**It answers a sha:** the branch would not merge cleanly with the
default branch, and `aide-run-spec` handed you the worktree exactly as
git left it — MERGE_HEAD set, the markers in the files. Follow
[references/resolve-conflict.md](./references/resolve-conflict.md) in
full: read the conflict, resolve it or decide not to, finish the merge,
and run the project's test command.

Continue to Step 2 **only** when the merge is committed and the tests
are green. A resolution abandoned, or one the tests went red on, puts
the branch back where it was found and stops archive here — the spec is
not archived, nothing lands, and the report says which files conflicted,
what stopped you, and which branch the diff is on.

Do this in every repo the run named, not only the project: the specs
repo has a branch of its own and can conflict the same way.

### Step 2: Find the spec's folder

- Specs root: `AIDE_SPECS_PATH` from `.aide/config` in the project
  root if set, otherwise `specs/` in the project root (helper:
  `aide_specs_root` in `_aide-spec-lib.sh`)
- Resolve the argument to a folder (same rules as the other aide skills:
  number shorthand, JIRA key, or full `NN-slug`)
- If the folder is already under `archive/`: say so and stop
- If nothing is found: list the active folders and stop

### Step 3: Check that the work is done

Read `4-status.md`. The decision reads one thing: the Status cell of
every Tasks-table row in every `## Phase`/`## Fase` section — the same
rows the dashboard's own `parseStatusChecks` reads. A row is done when
its Status cell holds `✅` or the Notation table's own word for it
(`Completed`, case-insensitive); anything else is open. The Notes cell
beside it is prose for a reader, never an input to this decision — a
Notes cell that still reads as unfinished next to a done Status mark
changes nothing.

Every row done: continue straight to Step 4, whatever any Notes cell
says. Any row open, name it (its phase heading and Task cell) and:

- **Someone is there (interactive):** show the status and ask whether to
  archive anyway. Never archive silently past an open row.
- **Nobody is there (headless — the prompt said so, or `AIDE_HEADLESS`
  is set):** do NOT archive — but before writing anything, tell ordinary
  progression apart from a genuine block. Read the Tracking info's
  `- **Workflow steps completed:**` line (the commit-derived record
  `aide-run-spec` writes and the dashboard's `parseWorkflowSteps` reads),
  and read every open row's Status cell again asking a narrower
  question: is it UNSTARTED — `⬜`, or the Notation table's own word
  `Not started`, case-insensitively — rather than merely not done.

  - **Ordinary progression — every open row unstarted, and `implement`
    absent from that line (or the line itself absent):** the spec has
    simply not reached implement yet, exactly as a freshly analyzed spec
    has not. That is the workflow working, never a warning. Write no
    `## Archive held back` section, and REMOVE one already in the file —
    stale, left by an earlier run of this shape — so a normal-progression
    decline leaves none behind. Report plainly that the work is not done
    yet and name the next step, `/aide-implement`. Then stop: do not
    continue to Step 4 or Step 5, and write nothing else to
    `4-status.md`.
  - **Genuinely blocked — any open row that is NOT unstarted (`🔄` in
    progress, `❌` blocked, `⚠️` waiting), or `implement` present on that
    line while a row is still open:** work that was supposed to be
    finished is not. Add — or replace, if one is already there — a
    `## Archive held back` section in `4-status.md` holding ONE bullet
    that names what is still open AND where a person closes it out — ONE
    line, e.g.
    `- the Slack webhook (Phase 4, still unchecked) — tick it on the spec's page`
    Then report the hold-back plainly and stop: do not continue to Step 4
    or Step 5.

    The second half is not decoration. The bullet is the only thing the
    reader is shown, in three places on the dashboard, and "still
    unchecked" describes the app's state without saying what to do about
    it. Since spec 182 the row is a real checkbox on the spec's own page:
    one click writes the mark, commits it, and the hold-back is gone.

    One section, one bullet, replaced in place — a spec declined twice
    carries its CURRENT reason, not a growing list of stale ones. The
    dashboard reads that heading directly and shows the bullet as the
    reason the spec's archive phase says "held back" instead of "done".
    It is the only signal there is: the run's own exit status is the
    claude session's, and a run that declined exits just as successfully
    as one that moved the folder.

    Which is why the split above matters: that badge and that panel are
    an alarm, and an alarm every unimplemented spec sets off is one
    nobody reads.

### Step 4: Close the loop

Read all four spec files and identify what should OUTLIVE the spec:

- Decisions and their reasons (chosen approach, rejected alternatives)
- New conventions or patterns the change introduced
- Gotchas discovered during implementation (things that will bite again)

If nothing qualifies, say so plainly and move on; not every spec leaves
something behind.

Otherwise, propose where each item belongs — the project's docs,
`CLAUDE.md`/rules, or a README — with the concrete text to add.

Then decide how to close the loop. **If the prompt said the run is
headless, or `AIDE_HEADLESS` is set, nobody can answer** — do not ask.
The prompt is the reliable signal of the two: an archive run on
2026-08-17 was told to check the variable, grepped the repo for it while
reading the spec that introduced it, never checked its own, and stopped
to ask a question no one could hear.

- **Someone is there (interactive):** ask for confirmation, then write
  it — the judgment call is worth having when someone can make it.
- **Nobody is there (headless):** do NOT ask. Append the
  proposal to `4-status.md` under a new `## Deferred documentation
  feedback` heading, one item per entry: the destination file and the
  exact text proposed. Then continue straight to Step 5.

The question must never block the move: a headless run that stops here
archives nothing, reports success anyway, and leaves the spec in the
active list with its lesson unrecorded.

### Step 5: Stamp and move

1. Append to `4-status.md`: `**Archived:** <today's date, YYYY-MM-DD>`
2. Create `<specs-root>/archive/` if missing
3. Move the folder INTO `archive/` with its name unchanged:
   `git mv` if the specs root is git-tracked, plain `mv` otherwise


Nothing in Tracking info records the step. Which steps a spec has had
is read off the spec's own commits, and `aide-run-spec` writes the
`Workflow steps completed:` line from them — leave that line exactly as
you found it, at whichever address the folder now has.

Which model ran each step is read off those same commits, and the same
script writes the `Model (<step>):` lines from them — leave those lines
alone too.

A headless run gets its commit for free. Working interactively, ASK
whether to commit the move, and suggest this message so the step is
recognised the same way:

```text
Run /aide-archive for <spec-folder> (model: <tool> <model>)
```

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses.

Offer it only after the move actually happened. An archive that was
held back, or a move that did not go through, has nothing to record.

The folder keeps its `NN-slug` name — the date lives in `4-status.md`.
Numbers are never reused: `aide_next_spec_number` (in
`_aide-spec-lib.sh`) scans `archive/` too, and `aide-generate-pdf`/
`aide-generate-html` still find archived specs.

### Step 6: Confirm

```text
Archived: 17-clean-up-console-log

- 4-status.md stamped: Archived: 2026-08-13
- Moved to: specs/archive/17-clean-up-console-log/
- Fed back into docs: docs/CONVENTIONS.md (1 addition)

The spec stays findable: /aide-to-pdf 17
```

IMPORTANT:
- Never delete a spec — archiving is a move, not a removal
- If the specs root lies outside the project root, do NOT run
  `git add`/`git mv` in the project's repo for spec files (they live in
  another repo — use the specs repo's git if it has one)
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
