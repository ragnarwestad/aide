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

## Workflow

### Step 1: Run the mechanical script

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

Branch on the JSON's `terminalReason`:

- **`refused`:** report the script's own `error` message and stop.
- **`already-archived`:** the folder is already under `archive/`. If the
  script's own JSON also carries a `specFolder` (`aide-run-spec`'s own
  pre-check may have just archived this spec seconds ago, before
  spawning this very session), treat that exactly like a fresh
  `archived` result below and continue to Step 2. Otherwise this is a
  plain re-run against work that was already finished long ago: say so
  and stop.
- **`conflict-open`:** the branch would not merge cleanly with the
  default branch. Follow
  [references/resolve-conflict.md](./references/resolve-conflict.md) in
  full: read the conflict, resolve it or decide not to, finish the
  merge, run the project's test command, then run the script again —
  now past the conflict — before continuing.
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

### Step 2: Close the loop

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
  subfolder automatically). Then continue straight to Step 3.

The question must never block the move: a headless run that stops here
has already archived the folder in Step 1 regardless, reports success,
and leaves only the doc-feedback proposal unrecorded rather than the
whole spec unmoved.

### Step 3: Commit

The move and this step's own write both already happened, in the
working directory — Step 1's script did the stamp-and-move, and Step 2
either wrote the docs directly or appended the deferred-feedback
proposal. This step is only about getting that onto a commit.

`aide-run-spec` writes `Workflow steps completed:` from the spec's own
commits, at whichever address the folder now has — leave that line
exactly as you found it. The same script writes this phase's `Repo`/
`Model`/`Result`/`Time spent`/`Cost` block into `4-status.md`'s own
Tracking info — leave those lines alone too.

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

Offer it only after the move actually happened — a `not-implemented-yet`
or `held-back` decline in Step 1 has nothing to commit here beyond its
own decline, which the ordinary git-add workflow already covers.

### Step 4: Confirm

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
