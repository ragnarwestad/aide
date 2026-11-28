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
effort: medium
---

Reopen an archived spec: put the folder back among the active specs. By default every file is kept and
the spec takes a round on what changed in its description; only when
asked are the analysis, the plan and the status reset as well.

**Input:** a spec number, a full folder ID, or an issue key its title began with

The runner does this step itself, with no model turn: it makes the
`aide-reopen-spec` call below, and the board reads this file's step
headings for the lines it shows while the job runs.

---

## Workflow

The steps below are this skill's own, inside the queue's `reopen` step.
Mark each one in the log, so a reader can follow the run: when it
starts, write one line `--- Step N of X: <title> — started`, and when
it ends, one line `--- Step N of X: <title> — done`. A step that ends
the run early says `— stopped: <why>` in place of `— done`, and one that does not apply to this run `— skipped: <why>`.

Step 5, the merge of spec files into the default branch, is Aide's, after
the reopen: Aide writes its marks there. The earlier round's branch is
removed by Aide before this skill starts, in both repositories and on
both origins.

### Step 1 of 5: Find the spec

First write `--- Step 1 of 5: Find the spec — started`, and when this step ends, `--- Step 1 of 5: Find the spec — done`.


Resolve the spec to a folder, looking under `archive/` — that is
where the spec is. `aide_existing_spec` in
`lib/spec-commands/find-spec.sh` searches both, active first, and returns
`archive/<NN>-slug` for an archived spec.

If it is NOT archived, stop and say so: a spec already in the active
list has nothing to reopen, and resetting its files would throw away the
round that is running.

The job says the mode: the reset mode when Reopen on the spec's page
asked for a reset, the keep mode otherwise.

### Step 2 of 5: Move the folder back

First write `--- Step 2 of 5: Move the folder back — started`, and when this step ends, `--- Step 2 of 5: Move the folder back — done`.


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

### Step 3 of 5: Commit spec files

First write `--- Step 3 of 5: Commit spec files — started`, and when this step ends, `--- Step 3 of 5: Commit spec files — done`.


The runner commits the move with this subject:

```text
Run /aide-reopen for <spec-folder>
```

### Step 4 of 5: Confirm

First write `--- Step 4 of 5: Confirm — started`, and when this step ends, `--- Step 4 of 5: Confirm — done`.

```text
Reopened: 17-clean-up-console-log

- Branch aide/17-clean-up-console-log removed: aide (local), aide-specs (local, origin)
- Moved to: specs/17-clean-up-console-log/
- Reset: 2-analysis.md, 3-solution.md, 4-status.md   (reset mode; keep mode: none)
- Kept: 1-description.md, 0-README.md   (keep mode: every file)

Next: Analyze
```

### Step 5 of 5: Merge spec files into main

Aide writes `--- Step 5 of 5: Merge spec files into main — started` itself, after the reopen, and ends it `— done` or `— stopped: <why>`.

Aide merges the spec files committed on the spec's branch into the specs
repository's default branch, and the reopen is finished when that merge
is, not before.

Rules:
- Never delete a commit, and never rewrite the default branch's history.
  The mark is what stops the earlier round counting; the repository keeps
  it.
- Never touch `1-description.md` or `0-README.md`
- Never edit `2-analysis.md`, `3-solution.md` or `4-status.md` by hand;
  `aide-reopen-spec` is the only thing that writes them here
- When the specs root lies outside the project root, spec files are
  moved and staged with the specs repo's git, never the project's
