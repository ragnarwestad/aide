---
name: aide-close
description: >-
  Close a spec that is not going to work: record the reason, move it to
  archive/, and delete its code branch without merging it — resolving
  the specs branch's merge conflict with the default branch first, if
  there is one.
  Use when: a spec's idea does not hold, its description asked for
  something that cannot be built, a work round needs to end without
  being finished.
  Do NOT use for: finished work (use aide-archive), another round on the
  same spec (change an acceptance criterion and run analyze again),
  unfinished work that is still worth finishing.
argument-hint: "[spec number] [reason]"
effort: medium
---

Close a spec that turned out not to work: stamp the reason, move it to
`archive/`, and let the code branch it never used be deleted rather than
merged.

**Input:** $ARGUMENTS (a spec number, a full folder ID, or an issue key its title began with,
plus the reason the user closing it typed)

## Workflow

The steps below are this skill's own, inside the queue's `close` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `--- Step N of X: <title> — started`, and when
it ends, one line `--- Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 4, the merge into the default branch, is Aide's, after this
session: Aide writes its marks, and the close is finished only when it is
done.

### Step 1 of 4: Run the mechanical script

First write `--- Step 1 of 4: Run the mechanical script — started`, and when this step ends, `--- Step 1 of 4: Run the mechanical script — done`.


A script resolves the argument to a folder, checks whether a merge is
open, and stamps and moves the folder. Close does not ask whether the
work is done:

```bash
aide-close-spec --project-dir <project root> --spec <argument> \
                 --reason <the reason typed by the user closing it> \
                 [--specs-dir <specs repo root, if separate>]
```

The reason is the one thing this script refuses to run without. Read it
from wherever this run was told it (the prompt's own "Use exactly this
reason when closing the spec:" line for a headless run; ask for it
directly when interactive and none was given).

Pass `--specs-dir` whenever the specs root lives in a different git repo
from the project — same reasoning as `/aide-archive`'s own Step 1.

Branch on the JSON's `terminalReason`:

- **`refused`:** report the script's own `error` message and stop. A
  refusal for a missing reason means exactly that: nothing was touched,
  and closing needs a reason before anything else happens.
- **`already-closed`:** the folder is already under `archive/` with a
  `**Closed:**` stamp. If the script's own JSON also carries a
  `specFolder` (the runner may have closed it just before this session
  started), treat it exactly like `closed` below and continue to Step 2.
  Otherwise this is a plain re-run against a spec already closed: say so
  and stop.
- **`already-archived`:** the folder is under `archive/` but was archived
  through the ordinary route, not closed — only `reopen` is legal on it.
  Report that plainly and stop.
- **`conflict-open`:** the specs branch would not merge cleanly with the
  default branch. Follow
  [aide-archive's references/resolve-conflict.md](../aide-archive/references/resolve-conflict.md)
  in full, the routine `/aide-archive` uses. Read every "archive"/`aide-archive`
  in it as this step's own equivalent: `aide-close-spec` in place of
  `aide-archive-spec`, this skill's Step 1 in place of `/aide-archive`'s.
  Once past the conflict, run the script again before continuing.
- **`closed`:** the reason was stamped and the folder moved to
  `specFolder` (the new `archive/NN-slug/` path). Continue straight to
  Step 2, reading from that path.

### Step 2 of 4: Commit

First write `--- Step 2 of 4: Commit — started`, and when this step ends, `--- Step 2 of 4: Commit — done`.


Step 1 left the move and the stamp in the working directory; this step
gets them onto a commit.

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
Run /aide-close for <spec-folder> (model: <tool> <model>)
```

Add the `(model: ...)` part only when you can name your own model with
certainty. A Claude Code session is told which model it is running in
its own context, so it can write `claude claude-opus-5`; an assistant
that cannot name itself offers the bare subject without the suffix and
never guesses.

Offer it only after the move actually happened — a `refused`,
`already-closed` or `already-archived` outcome in Step 1 has nothing to
commit here beyond its own decline.

### Step 3 of 4: Confirm

First write `--- Step 3 of 4: Confirm — started`, and when this step ends, `--- Step 3 of 4: Confirm — done`.

In a headless run nothing of this is on the default branch yet: the
close is finished only once Step 4, the merge into main, is done. So the
report's first line ends `— not finished, the merge into main is next
(Step 4)`, and the report never calls the close done or complete.


```text
Closed: 17-a-spec-that-turned-out-wrong

- 4-status.md stamped: Closed: 2026-09-05 — the idea does not hold
- Moved to: specs/archive/17-a-spec-that-turned-out-wrong/
- Code branch: deleted (never merged)

The spec stays findable: /aide-to-pdf 17
```

### Step 4 of 4: Merge into main

Aide writes `--- Step 4 of 4: Merge into main — started` itself, after this session, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. In a headless
run Aide merges what this session committed on the spec's branch into
the default branch once the session has ended, and the close is finished
when that merge is, not before. Working interactively there is no such
step: the steps above say what reaches the default branch.

IMPORTANT:
- Closing is a move: a spec is never deleted
- When the specs root lies outside the project root, spec files are
  staged with the specs repo's git, never the project's
- The code branch is left for the landing after this step, which deletes
  it; nothing in this skill pushes or merges any branch
