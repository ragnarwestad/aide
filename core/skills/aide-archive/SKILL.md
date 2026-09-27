---
name: aide-archive
description: >-
  Archive a finished spec and feed its durable knowledge back into the
  project's living documentation — resolving the branch's merge conflict
  with the default branch first, if there is one.
  Use when: a spec is done, closing it out,
  cleaning up the specs root, a spec's branch conflicts with the default
  branch.
  Do NOT use for: creating specs (use aide-create), unfinished work,
  deleting specs.
argument-hint: "[spec number]"
effort: medium
---

Archive a finished spec: settle any merge conflict on its branch, stamp
it, move it to `archive/`, and merge what should outlive it into the
project's living documentation.

**Input:** $ARGUMENTS (a spec number, a full folder ID, or an issue key its title began with)

## Workflow

The steps below are this skill's own, inside the queue's `archive` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `archive · Step N of X: <title> — started`, and when
it ends, one line `archive · Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 6, the merge into the default branch, is Aide's, after this
session: Aide writes its marks, and the archive is finished only when
it is done.

### Step 1 of 6: Run the mechanical script

First write `archive · Step 1 of 6: Run the mechanical script — started`, and when this step ends, `archive · Step 1 of 6: Run the mechanical script — done`.


Everything mechanical — resolving the argument to a folder, checking
whether a merge is open, reading `4-status.md`'s tables, and (when the
work is done) stamping and moving the folder — is a script now, not
something this session reasons about by hand:

```bash
aide-archive-spec --project-dir <project root> --spec <argument> \
                   [--specs-dir <specs repo root, if separate>]
```

Pass `--specs-dir` whenever the specs root lives in a different git repo
from the project — the specs repo has a branch of its own and can
conflict independently of the project, and the script only checks the
directories it is given.

**Before branching on the answer: a merge that is OPEN in the project
worktree (`git rev-parse -q --verify MERGE_HEAD` succeeds, conflict
markers in files) is this step's own work, whatever the script said.**
`aide-run-spec` hands the conflict with the default branch to `archive`
open on purpose, and it is never leftover dirty state from an earlier
run: aborting it, resetting the tree or committing over it throws the
resolution away, the branch stays behind the default branch, and the
run ends `merge-unfinished` rather than archived. Resolve it first, per
[references/resolve-conflict.md](./references/resolve-conflict.md), then
come back here — an `already-archived` answer from the script does not
change that.

Branch on the JSON's `terminalReason`:

- **`refused`:** report the script's own `error` message and stop.
- **`already-archived`:** the folder is already under `archive/`. If the
  script's own JSON also carries a `specFolder` (`aide-run-spec`'s own
  pre-check may have just archived this spec seconds ago, before
  spawning this very session), treat that exactly like a fresh
  `archived` result below and continue to Step 2. Otherwise an earlier
  run already moved the spec folder on the spec's branch — usually
  because the merge after it stopped: say so and stop, after finishing
  any merge left open, as above, in the words Step 5 gives.
- **`conflict-open`:** the branch would not merge cleanly with the
  default branch. Follow
  [references/resolve-conflict.md](./references/resolve-conflict.md) in
  full: read the conflict, resolve it or decide not to, finish the
  merge, run the tests covering the files the resolution touched, then
  run the script again — now past the conflict — before continuing.
  Never the full suite: the landing runs it once, on exactly this
  merge, before anything reaches the default branch.
- **`not-implemented-yet`:** the spec has not reached `implement` yet.
  That is the workflow working, never a warning — the script has
  already removed any stale `## Archive held back` section on this
  path. Report plainly that the work is not done yet, name the next
  step (`/aide-implement`), and stop: do not continue to Step 2 or
  Step 3, and write nothing else to `4-status.md`.
- **`held-back`:** an open row is genuinely blocked, or `implement` has
  started while a row is still open. The script has already written the
  `## Archive held back` section itself, with its one bullet — that
  bullet is a real checkbox on the spec's own page, and ticking it is
  what makes the next archive run see the work as done. Report the
  hold-back plainly (the script's own `note` names it) and stop: do not
  continue to Step 2 or Step 3.
- **`archived`:** the work was done, and the script has already stamped
  `4-status.md` and moved the folder to `specFolder` (the new
  `archive/NN-slug/` path). Continue straight to Step 2, reading from
  that path — the move has already happened by the time this step runs.

Nobody at a keyboard can override the script's own not-done verdict —
the "ask whether to archive anyway" judgment call the old, fully
AI-driven version of this step made no longer has anywhere to run. An
open row that genuinely should be archived past is closed out by ticking
it on the spec's page (or by editing `4-status.md` directly) and running
archive again, not by talking a session into skipping the check.

The folder keeps its `NN-slug` name once moved — the date lives in
`4-status.md`. Numbers are never reused.

### Step 2 of 6: Rewrite the wiki pages the spec touched

First write `archive · Step 2 of 6: Rewrite the wiki pages the spec touched — started`, and when this step ends, `archive · Step 2 of 6: Rewrite the wiki pages the spec touched — done`.

```bash
aide-wiki status --specs-root <specs root> --project-dir <project root>
```

**No wiki (`"wiki":false`):** write `— skipped: the project has no wiki`
and continue straight to Step 3. Nothing else in this step applies.

**A wiki:** ask which of its pages this spec's own code touched —

```bash
aide-wiki affected --specs-root <specs root> --project-dir <project root>
```

— which answers with the generated (never hand-written) pages whose
declared files overlap the diff between the project's default branch and
this spec's own code, each already narrowed to the files of its own that
still exist at HEAD — a file this spec's own diff deleted is dropped from
that list, never handed to `aide-wiki write`, which refuses any file no
longer in the project. A page whose every named file this spec deleted
has nothing left to rewrite it from and is not named at all: it is left
exactly as it is, for a wiki build or refresh to prune once it goes
stale.
**No pages named:** report that none needed rewriting and continue to
Step 3.

**One or more pages named:** for each, read the files it names as they
are now — after this spec's own changes, in this session's own worktree
— and rewrite the page's body the same way the wiki skill's own Step 3
does, through the script, never by hand, passing exactly the files
`affected` named for that page:

```bash
aide-wiki write --specs-root <specs root> --project-dir <project root> \
                 --page NAME.md --file PATH [--file PATH...]
                 # the page's new body on stdin
```

Rewrite only the pages `affected` named: a page covering no file this
spec changed is left exactly as it is, however stale it may be for
another reason — a wiki build or refresh still covers those. Report
which pages were rewritten, or that none were.

### Step 3 of 6: Close the loop

First write `archive · Step 3 of 6: Close the loop — started`, and when this step ends, `archive · Step 3 of 6: Close the loop — done`.


First, what should NOT outlive it. **If this spec replaced behaviour, the
tests for the behaviour it replaced are deleted here, before the commit
in Step 4** (`core/rules/testing.md`, "Replaced behaviour takes its tests
with it"): a test whose subject is gone, and a check that the old thing
is still absent where the test already checks what replaced it. A check
whose absence IS the rule stays. Run the project's tests afterwards, and
name what was deleted in the summary — the reader has to see it, since
this is the one step that can remove a test nobody asked about.

Then read all four spec files and identify what should OUTLIVE the spec:

- Decisions and their reasons (chosen approach, rejected alternatives)
- New conventions or patterns the change introduced
- Gotchas discovered during implementation (things that will bite again)

If nothing qualifies, say so plainly and move on; not every spec leaves
something behind.

Otherwise, propose where each item belongs — the project's docs,
`CLAUDE.md`/rules, or a README — with the concrete text to add.

Then decide how to close the loop. **If the prompt said the run is
headless, or `AIDE_HEADLESS` is set, nobody can answer** — do not ask.
The prompt is the reliable signal of the two.

- **Someone is there (interactive):** ask for confirmation, then write
  it — the judgment call is worth having when someone can make it.
- **Nobody is there (headless):** do NOT ask. Read the current
  `4-status.md` (it may already be under `archive/` — see Step 1),
  append the proposal under a new `## Deferred documentation feedback`
  heading, one item per entry: the destination file and the exact text
  proposed, then write the result with `aide-write-spec --file
  4-status.md` (never Write/Edit; `aide-write-spec` resolves
  the folder under either the active specs root or its `archive/`
  subfolder automatically). Then continue straight to Step 4.

The question must never block the move: a headless run that stops here
has already archived the folder in Step 1 regardless, reports success,
and leaves only the doc-feedback proposal unrecorded rather than the
whole spec unmoved.

### Step 4 of 6: Commit

First write `archive · Step 4 of 6: Commit — started`, and when this step ends, `archive · Step 4 of 6: Commit — done`.


The move and this step's own write both already happened, in the
working directory — Step 1's script did the stamp-and-move, Step 2
rewrote whichever wiki pages applied, and Step 3 either wrote the docs
directly or appended the deferred-feedback proposal. This step is only
about getting that onto a commit.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits, at whichever address the folder now has — leave that line
exactly as you found it. The same script writes this phase's `Repo`/
`Model`/`Result`/`Time spent`/`Cost` block into `4-status.md`'s own
Tracking info — leave those lines alone too.

A headless run gets its commit for free — this session does not run
`git commit` or `git push` itself, headless or not. Working
interactively, ASK whether to commit the move, and suggest this message
so the step is recognised the same way:

```text
Run /aide-archive for <spec-folder> (model: <tool> <model>)
```

That subject belongs to the specs repository alone. When the step also
changed the project's own documentation, suggest a separate commit there whose
message describes the change as a developer on the project would, and
names no tool, spec or step — the project may have nothing to do with
Aide (the git rules, "No tool in a project's history").

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses.

Offer it only after the move actually happened — a `not-implemented-yet`
or `held-back` decline in Step 1 has nothing to commit here beyond its
own decline, which the ordinary git-add workflow already covers.

### Step 5 of 6: Confirm

First write `archive · Step 5 of 6: Confirm — started`, and when this step ends, `archive · Step 5 of 6: Confirm — done`.


The archive is not finished until the code and the spec are merged into
the default branch, and that is Step 6, after this session. Everything
this session did is on the spec's branches. So the report:

- opens by saying the archive is not finished and the merge is next —
  never "Archived: 17-clean-up-console-log", "Archive complete" or
  "archive step done";
- says for each line whether it is the spec (the specs repository) or
  the code (the project's repository), and that it is on the branch;
- ends with what is still to come: in a headless run, the tests run on
  the merge and, when they pass, the code and the spec go into the
  default branch; working interactively, that the branches still have
  to be merged.

```text
Archive of 17-clean-up-console-log not finished — the merge into main is next (Step 6)

- Spec: 4-status.md stamped (Archived: 2026-08-13) and the folder moved
  to archive/17-clean-up-console-log/, on the spec's branch
- Spec: wiki/queue.md rewritten from the spec's own code, on the spec's branch
- Code: docs/CONVENTIONS.md, one addition, on the spec's branch
- Code: the conflict with main in src/app.ts resolved, merge committed
  on the spec's branch

Still to come, Step 6: the tests run on the merge; when they pass, the
code and the spec go into main, and only then is the archive finished.

The spec stays findable: /aide-to-pdf 17
```

Name the default branch by its own name (`main` above). An
`already-archived` answer in Step 1 is reported the same way: the move
usually happened seconds before this session, in the same run, and the
merge is still to come.

### Step 6 of 6: Merge into main

Aide writes `archive · Step 6 of 6: Merge into main — started` itself, after this session, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. In a headless
run Aide merges the spec's branches into the default branch once this
session has ended: it runs the project's tests on the merge, and only
when they pass do the code and the spec reach the default branch.
Working interactively, the branches are merged by hand. Either way the
archive is finished when the merge is, and not before.

IMPORTANT:
- Never delete a spec — archiving is a move, not a removal
- Never run the project's full test suite: the landing after this step
  runs it once, on exactly the merge
- If the specs root lies outside the project root, do NOT run
  `git add`/`git mv` in the project's repo for spec files (they live in
  another repo — use the specs repo's git if it has one)
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
