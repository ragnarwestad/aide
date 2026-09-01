---
name: aide-reopen
description: >-
  Take an archived spec back into the active list for another round:
  reset the analysis, the plan and the status, keep the description and
  the archive trail, and mark the point after which nothing counts as
  having run.
  Use when: archived work has to be done again, a spec was archived too
  early, a shipped change has to be redone from its own description.
  Do NOT use for: creating a new spec (use aide-create), analysis (use
  aide-analyze), archiving (use aide-archive).
argument-hint: "[<JIRA-KEY> or task number]"
effort: medium
---

Reopen an archived spec: remove the branch it left behind, put the
folder back among the active specs, reset three of its four files, and
write the mark that makes everything counting steps start over.

**Input:** $ARGUMENTS (a JIRA key, a task number, or a full folder ID)

---

## Workflow

### Step 1: Find the spec

Resolve `$ARGUMENTS` to a folder, looking under `archive/` — that is
where the spec is. `aide_resolve_spec` in `_aide-spec-lib.sh` already
searches both and returns `archive/<NN>-slug` for an archived spec.

If it is NOT archived, stop and say so: a spec already in the active
list has nothing to reopen, and resetting its files would throw away the
round that is running.

### Step 2: Remove the branch the earlier round left behind

`aide/<NN>-slug` can be in four places, and the one that is missed is
the one the next run refuses on:

| Repository | Where |
|---|---|
| the project | the local ref in the checkout |
| the project | `origin` |
| the specs repo | the local ref in the checkout |
| the specs repo | `origin` |

Delete all four. Write it as ONE loop over the pairs, not as four
separately typed commands — four commands is how one of them ends up
different from the others.

Every deletion tolerates "already gone". A spec whose branch was cleaned
up by the landing that archived it is the normal case, not a failure,
and an origin that cannot be reached is not a reason to stop either.

**In a headless run this is already done.** Check first, and do nothing
when there is nothing to do. This step exists for `/aide-reopen` typed
at a keyboard, where no worktree stands in the way.

### Step 3: Record where the new round starts

Read the specs repository's default-branch tip and keep it — that SHA is
the boundary. Every commit reachable from it belongs to the earlier
round; every commit made from now on is a descendant of it and belongs
to the new one.

Short form (`git rev-parse --short HEAD` on the default branch) is what
goes in the file. Seven hex characters or more.

### Step 4: Move the folder back

`git mv <specs-root>/archive/<NN>-slug <specs-root>/<NN>-slug` when the
specs root is git-tracked, plain `mv` otherwise. The folder keeps its
`NN-slug` name — numbers are never reused, and the spec is the same
spec.

### Step 5: Reset three files, keep two

**Regenerate** `2-analysis.md`, `3-solution.md` and `4-status.md`
exactly as `/aide-create` Step 4 would for a new spec — from
`core/skills/aide-create/references/file-templates.md`, with the same
placeholders replaced (TITLE, FOLDER, DATE). Do not describe the layout
here.

**Leave `1-description.md` and `0-README.md` byte for byte as they are.**
The description is why the spec exists, and it is what the new round is
for. Rewriting it would delete the one thing the reopen is keeping.

### Step 6: Write the marks into `4-status.md`

Two lines in Tracking info, both of them:

```markdown
- **Archived:** 2026-08-22
- **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)
```

- The `**Archived:**` line is carried over from the file being replaced,
  verbatim, with every earlier one it already had. The spec's archive
  trail still has to read.
- The `**Reopened:**` line is new, in exactly that grammar — this exact
  grammar matters to several readers, and a line that does not carry a
  backticked SHA is not a boundary to any of them. The date is
  today's, `YYYY-MM-DD`.
- A spec reopened twice keeps both `**Reopened:**` lines. The last one
  wins; the earlier one is history, the same way the `**Archived:**`
  lines are.

Leave the `**Workflow steps completed:**` line out. `aide-run-spec`
writes it from the spec's own commits, and after the boundary there are
none to write about.

### Step 7: Commit

A headless run gets its commit for free — this session does not run
`git commit` or `git push` itself, headless or not. Working
interactively, ASK whether to commit, and suggest this message:

```text
Run /aide-reopen for <spec-folder>
```

### Step 8: Confirm

```text
Reopened: 17-clean-up-console-log

- Branch aide/17-clean-up-console-log removed: aide (local), aide-specs (local, origin)
- Moved to: specs/17-clean-up-console-log/
- Reset: 2-analysis.md, 3-solution.md, 4-status.md
- Kept: 1-description.md, 0-README.md
- Reopened: 2026-08-23 (history before `1d0fe79` does not count)

Next: /aide-analyze 17
```

---

IMPORTANT:
- Never delete a commit, and never rewrite the default branch's history.
  The mark is what stops the earlier round counting; the repository keeps
  it.
- Never touch `1-description.md` or `0-README.md`
- If the specs root lies outside the project root, do NOT run
  `git add`/`git mv` in the project's repo for spec files (they live in
  another repo — use the specs repo's git if it has one)
- Code blocks ALWAYS end with just ` ``` ` — NEVER ` ```text ` as the
  closing fence
