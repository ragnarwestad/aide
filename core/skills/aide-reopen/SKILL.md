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

### Step 1: Find the spec

Resolve `$ARGUMENTS` to a folder, looking under `archive/` — that is
where the spec is. `aide_resolve_spec` in `_aide-spec-lib.sh` already
searches both and returns `archive/<NN>-slug` for an archived spec.

If it is NOT archived, stop and say so: a spec already in the active
list has nothing to reopen, and resetting its files would throw away the
round that is running.

Then ask: "Reset the analysis, the plan and the status as well?
(default: no)". No, or no answer, is the keep mode; yes is the reset
mode. A headless run has already answered: without `--reset-files` the
runner runs `aide-reopen-spec` itself and this skill is not started, and
a prompt that says the person chose to reset means yes. Do not ask again.

### Step 2: Remove the branch the earlier round left behind

`aide/<NN>-slug` can be in four places, and the one that is missed is
the one the next run refuses on:

| Repository     | Where                         |
|----------------|-------------------------------|
| the project    | the local ref in the checkout |
| the project    | `origin`                      |
| the specs repo | the local ref in the checkout |
| the specs repo | `origin`                      |

Delete all four. Write it as ONE loop over the pairs, not as four
separately typed commands — four commands is how one of them ends up
different from the others.

Every deletion tolerates "already gone". A spec whose branch was cleaned
up by the landing that archived it is the normal case, not a failure,
and an origin that cannot be reached is not a reason to stop either.

**In a headless run this is already done.** Check first, and do nothing
when there is nothing to do. This step exists for `/aide-reopen` typed
at a keyboard, where no worktree stands in the way.

### Step 3: Move the folder back

**Keep mode:** run `aide-reopen-spec --specs-root <specs-root> --spec
<NN>`. It does this step and everything the keep mode changes: it moves
the folder, leaves `0-README.md`, `1-description.md`, `2-analysis.md`
and `3-solution.md` byte for byte, takes `archive` off the `Workflow
steps completed:` line of `4-status.md` and appends one
`**Round boundary:**` line in the `history before` grammar. The
`**Archived:**` or `**Closed:**` line stays as the trail, and the
`**Round boundary:**` line after it is what makes it history. Go to
Step 6.

**Reset mode:** `git mv <specs-root>/archive/<NN>-slug
<specs-root>/<NN>-slug` when the specs root is git-tracked, plain `mv`
otherwise. The folder keeps its `NN-slug` name — numbers are never
reused, and the spec is the same spec.

### Step 4: Reset three files, keep two (reset mode only)

**Regenerate** `2-analysis.md`, `3-solution.md` and `4-status.md`
exactly as `/aide-create` Step 4 would for a new spec — from
`core/skills/aide-create/references/file-templates.md`, with the same
placeholders replaced (TITLE, FOLDER, DATE). Do not describe the layout
here.

**Leave `1-description.md` and `0-README.md` byte for byte as they are.**
The description is why the spec exists, and it is what the new round is
for. Rewriting it would delete the one thing the reopen is keeping.

### Step 5: Carry over the `**Archived:**` line (reset mode only)

Copy the `**Archived:**` line (with every earlier one it already had)
verbatim from the file being replaced into the regenerated
`4-status.md`'s Tracking info. The spec's archive trail still has to
read.

Leave the `**Reopened:**` mark and the `**Workflow steps completed:**`
line out. `aide-run-spec` writes the `**Reopened:**` mark itself, once
this step finishes, from the specs repository's own default-branch tip
at the moment the branch above was cut — not from anything this session
computes — and it writes `**Workflow steps completed:**` from the
spec's own commits, of which there are none yet after the boundary. The
mark it writes reads `- **Reopened:** DATE (history before \`SHA\` does
not count)` — the one grammar `completed_steps_for` in
`core/scripts/aide-run-spec`, `parse-status.ts`, `workflow-history.ts`
and `description-freshness.ts` all parse.

### Step 6: Commit

A headless run gets its commit for free — this session does not run
`git commit` or `git push` itself, headless or not. Working
interactively, ASK whether to commit, and suggest this message:

```text
Run /aide-reopen for <spec-folder>
```

In reset mode `aide-run-spec` adds the `**Reopened:**` mark, with its
boundary sha, in a commit of its own right after this step finishes — it
is not part of what this session commits. In keep mode the
`**Round boundary:**` line is already written by `aide-reopen-spec`.

### Step 7: Confirm

```text
Reopened: 17-clean-up-console-log

- Branch aide/17-clean-up-console-log removed: aide (local), aide-specs (local, origin)
- Moved to: specs/17-clean-up-console-log/
- Reset: 2-analysis.md, 3-solution.md, 4-status.md   (reset mode; keep mode: none)
- Kept: 1-description.md, 0-README.md   (keep mode: every file)

Next: /aide-analyze 17
```

---

IMPORTANT:
- Never delete a commit, and never rewrite the default branch's history.
  The mark is what stops the earlier round counting; the repository keeps
  it.
- Never touch `1-description.md` or `0-README.md`
- In keep mode, never touch `2-analysis.md`, `3-solution.md` or a row of
  `4-status.md`; `aide-reopen-spec` is the only thing that edits it
- If the specs root lies outside the project root, do NOT run
  `git add`/`git mv` in the project's repo for spec files (they live in
  another repo — use the specs repo's git if it has one)
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
