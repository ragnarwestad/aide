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
  Do NOT use for: finished work (use aide-archive), starting a work
  round over on the same spec (use aide-reset), unfinished work that is
  still worth finishing.
argument-hint: "[<JIRA-KEY> or task number] [reason]"
effort: medium
---

Close a spec that turned out not to work: stamp the reason, move it to
`archive/`, and let the code branch it never used be deleted rather than
merged.

**Input:** $ARGUMENTS (a JIRA key, a task number, or a full folder ID,
plus the reason the person closing it typed)

## Workflow

### Step 1: Run the mechanical script

Resolving the argument to a folder, checking whether a merge is open,
and stamping-and-moving the folder is a script, the same way archive's
own equivalent is — this session never reasons about whether the work is
"done enough" to close, because Close does not ask that question:

```bash
aide-close-spec --project-dir <project root> --spec <argument> \
                 --reason <the reason typed by the person closing it> \
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
  `specFolder` (`aide-run-spec`'s own pre-check may have just closed
  this spec seconds ago, before spawning this very session), treat that
  exactly like a fresh `closed` result below and continue to Step 2.
  Otherwise this is a plain re-run against a spec already closed: say so
  and stop.
- **`already-archived`:** the folder is under `archive/` but was archived
  through the ordinary route, not closed — only `reopen` is legal on it.
  Report that plainly and stop.
- **`conflict-open`:** the specs branch would not merge cleanly with the
  default branch. Follow
  [aide-archive's references/resolve-conflict.md](../aide-archive/references/resolve-conflict.md)
  in full — the same routine `/aide-archive` uses for the same situation,
  since a conflict confined to moving one folder is identical work
  whichever step is doing the moving. Read every "archive"/`aide-archive`
  in it as this step's own equivalent: `aide-close-spec` in place of
  `aide-archive-spec`, this skill's Step 1 in place of `/aide-archive`'s.
  Once past the conflict, run the script again before continuing.
- **`closed`:** the reason was stamped and the folder moved to
  `specFolder` (the new `archive/NN-slug/` path). Continue straight to
  Step 2, reading from that path.

Nobody at a keyboard overrides the script's own refusal for a missing
reason — the same "the check decides, not a conversation" rule
`/aide-archive` already applies to its own gates.

The folder keeps its `NN-slug` name once moved — the date and the reason
live in `4-status.md`. Numbers are never reused.

### Step 2: Commit

The move and the stamp already happened, in the working directory —
Step 1's script did both. This step is only about getting that onto a
commit. Unlike `/aide-archive`, there is no documentation-feedback step
here: work that was closed never shipped, so there is nothing to feed
back into the project's living docs.

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

### Step 3: Confirm

```text
Closed: 17-a-spec-that-turned-out-wrong

- 4-status.md stamped: Closed: 2026-09-05 — the idea does not hold
- Moved to: specs/archive/17-a-spec-that-turned-out-wrong/
- Code branch: deleted (never merged)

The spec stays findable: /aide-to-pdf 17
```

IMPORTANT:
- Never delete a spec — closing is a move, not a removal
- If the specs root lies outside the project root, do NOT run
  `git add`/`git mv` in the project's repo for spec files (they live in
  another repo — use the specs repo's git if it has one)
- Never merge the code branch — the landing that follows this step
  deletes it; nothing in this skill pushes or merges any branch
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
