---
name: aide-reopen
description: >-
  Take an archived spec back into the active list for another round,
  keeping every file as it is, or, when asked, resetting the analysis,
  the plan and the status as well. Keeps the description and the archive
  trail, and marks the point after which nothing counts as having run.
  Use when: archived work has to be done again, a spec was archived too
  early, a shipped change has to be redone from its own description.
  Do NOT use for: creating a new spec (use aide-create), analysis (use
  aide-analyze), archiving (use aide-archive).
argument-hint: "[spec number]"
effort: medium
---

Reopen an archived spec: remove the branch it left behind and put the
folder back among the active specs. By default every file is kept and
the spec takes a round on what changed in its description; only when
asked are the analysis, the plan and the status reset as well.

**Input:** $ARGUMENTS (a spec number, a full folder ID, or an issue key its title began with)

---

## Workflow

The steps below are this skill's own, inside the queue's `reopen` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `--- Step N of X: <title> — started`, and when
it ends, one line `--- Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 6, the merge into the default branch, is Aide's, after a reopen on
the board: Aide writes its marks there.

### Step 1 of 6: Find the spec

First write `--- Step 1 of 6: Find the spec — started`, and when this step ends, `--- Step 1 of 6: Find the spec — done`.


Resolve `$ARGUMENTS` to a folder, looking under `archive/` — that is
where the spec is. `aide_resolve_spec` in `_aide-spec-lib.sh` already
searches both and returns `archive/<NN>-slug` for an archived spec.

If it is NOT archived, stop and say so: a spec already in the active
list has nothing to reopen, and resetting its files would throw away the
round that is running.

Then ask: "Reset the analysis, the plan and the status as well?
(default: no)". No, or no answer, is the keep mode; yes is the reset
mode. A headless run never reaches this skill at all: the runner makes
the same `aide-reopen-spec` call itself.

### Step 2 of 6: Remove the branch the earlier round left behind

First write `--- Step 2 of 6: Remove the branch the earlier round left behind — started`, and when this step ends, `--- Step 2 of 6: Remove the branch the earlier round left behind — done`.


`aide/<NN>-slug` can be in four places, and the one that is missed is
the one the next run refuses on:

| Repository     | Where                         |
|----------------|-------------------------------|
| the project    | the local ref in the checkout |
| the project    | `origin`                      |
| the specs repo | the local ref in the checkout |
| the specs repo | `origin`                      |

Delete all four in ONE loop over the pairs, so the four deletions stay
alike. Every deletion tolerates "already gone" — the landing that
archived the spec usually removed the branch already — and an origin
that cannot be reached is no reason to stop.

### Step 3 of 6: Move the folder back

First write `--- Step 3 of 6: Move the folder back — started`, and when this step ends, `--- Step 3 of 6: Move the folder back — done`.


Run, from the specs repository as it stands before anything is moved:

```bash
aide-reopen-spec --specs-root <specs-root> --spec <NN>                 # keep mode
aide-reopen-spec --specs-root <specs-root> --spec <NN> --reset-files   # reset mode
```

It moves the folder back under its own `NN-slug` name and stages the
move. `0-README.md` and `1-description.md` stay byte for byte in both
modes.

- **Keep mode:** `2-analysis.md` and `3-solution.md` stay too; `archive`
  leaves the `Workflow steps completed:` line, and a `**Round
  boundary:**` line is appended to `4-status.md`.
- **Reset mode:** `2-analysis.md`, `3-solution.md` and `4-status.md` are
  written fresh from the templates, and `4-status.md` gets a
  `**Reopened:**` mark at the specs repository's HEAD.

Either mark is what stops the earlier round's steps counting. On a
refusal, report the script's `error` and stop.

### Step 4 of 6: Commit

First write `--- Step 4 of 6: Commit — started`, and when this step ends, `--- Step 4 of 6: Commit — done`.


ASK whether to commit, and suggest this message:

```text
Run /aide-reopen for <spec-folder>
```

### Step 5 of 6: Confirm

First write `--- Step 5 of 6: Confirm — started`, and when this step ends, `--- Step 5 of 6: Confirm — done`.

```text
Reopened: 17-clean-up-console-log

- Branch aide/17-clean-up-console-log removed: aide (local), aide-specs (local, origin)
- Moved to: specs/17-clean-up-console-log/
- Reset: 2-analysis.md, 3-solution.md, 4-status.md   (reset mode; keep mode: none)
- Kept: 1-description.md, 0-README.md   (keep mode: every file)

Next: /aide-analyze 17
```

### Step 6 of 6: Merge into main

Aide writes `--- Step 6 of 6: Merge into main — started` itself, after a reopen on the board, and ends it `— done` or `— stopped: <why>`.

Not this session's step, and it writes no mark for it. Typed at a
keyboard there is no such step: the commit in Step 4 is what reaches
the specs repository.

IMPORTANT:
- Never delete a commit, and never rewrite the default branch's history.
  The mark is what stops the earlier round counting; the repository keeps
  it.
- Never touch `1-description.md` or `0-README.md`
- Never edit `2-analysis.md`, `3-solution.md` or `4-status.md` by hand;
  `aide-reopen-spec` is the only thing that writes them here
- When the specs root lies outside the project root, spec files are
  moved and staged with the specs repo's git, never the project's
