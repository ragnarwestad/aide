# The runner and its checkouts

What a run does to the repositories it touches: the clones the dashboard keeps of its own, the `git worktree`
checkouts a step works in, running one step by hand, and what a finished step publishes. The queue that starts
these runs is on [Running specs](running-specs.md); how a step's branch is merged afterwards is on
[Branches and landing](landing.md).

## Table of contents

- [The dashboard's own checkouts](#the-dashboards-own-checkouts)
- [How a run touches the repositories](#how-a-run-touches-the-repositories)
- [Running a step by hand](#running-a-step-by-hand)
- [What a finished step publishes](#what-a-finished-step-publishes)

---

## The dashboard's own checkouts

**The checkout a run is cut from is not the one a user edits.** Cutting a worktree from
`<projects root>/<project>` — the directory Add clones into and the directory somebody works in — puts two writers on
one tree: the runner puts every root it touches onto its default branch before it starts, and a landing merges and
pushes from the same tree, while a user edits it meanwhile. The per-repo lock serializes the dashboard against
itself; nothing serializes it against a user's own git client, and nothing can.

So the dashboard keeps clones of its own, under
`~/.aide/dashboard/checkouts/<project>/` — `code/`, plus `specs/` when the specs root is a separate repository. One per
project, never one per run;
`--dashboard-checkouts <dir>` moves them. They are made the first time they are needed, by cloning the user's
checkout's own `origin`, and reused ever after. Everything that MUTATES goes there: `aide-run-spec
--project-dir`, a landing's merge and push, Save, Update, the dependency gate's fetches, the drift poll. The user's
checkout is read for the project list and the manifests, and is otherwise asked one read-only question ever — which
origin to clone from.

**The spec list itself is read from the dashboard's own checkout, not the user's.** Every reader-facing
listing —
`GET /projects/:name`, `GET /projects` and the home page's queue rows, archived rows included — lists from
`resolvedCheckouts.get(project)?.specs`
when the dashboard's own clone exists, falling back to the user's checkout otherwise (a new project, or one whose
clone failed). This is the same clone `aide-run-spec` resolves a spec folder against, so a folder that only exists in
the user's checkout, committed but never pushed, does not appear in the list — a row for it would offer a step that
fails with `unknown spec: ... (not under
<dashboard-checkout>/specs/<project>)`. The fetch that keeps the dashboard's clone current happens inside
`refreshSpecCaches`'s existing schedule, never inside a request, so this costs no git spawn on the render path.

Two consequences worth knowing:

- **A landed run and a Save do not show up in a user's own checkout until they pull it.** Nothing auto-syncs into
  it, deliberately: an auto-pull would recreate exactly the collision this removes. The specs cron pulls it every two
  minutes, which is what closes the gap in practice.
- **`.aide/config` is gitignored, so a clone never carries it.** It is copied from the user's checkout on every
  ensure — it is the file an operator edits by hand between merges, and a copy taken once would go on answering with
  whatever was true the day the clone was made.
  `AIDE_SPECS_PATH` is the one key that does not survive the copy: it names a directory in the user's checkout, and is
  replaced with the dashboard's own specs. The file is written once, finished, through a rename — a run starting for
  another job never reads a copy that still names the user's path.

A project whose checkout has no `origin` gets no clone of its own. It runs in the user's checkout, and its readiness
line says so, so the one project where a run and a user's editing can still
meet is named rather than silent.

## How a run touches the repositories

**`aide-run-spec` branches EVERY repo it touches, not just the project.** An `analyze` step changes only the specs
repo, so branching the project alone would leave the analysis committed on `main` — the one thing `push branch` exists
to prevent. A repo is pushed when its branch holds something beyond its own default branch AND origin does not
already have that tip (`run-spec-publish.sh`). **Origin's answer is the test, not `changedFiles`, and not whether
this run moved anything** — `changedFiles` counts only what the run's own commit loop found uncommitted, and a step
that commits its own work (archive does) leaves it at `0` with real commits on the branch; asking only about this
run would strand a commit whose push failed in an earlier one, since no later run would retry it. The compare link
is built from the repos that were pushed (`branchUrls` in the result; `branchUrl` keeps the single most interesting
one).

**It branches them in `git worktree` checkouts of its own**, under `$HOME/.aide/dashboard/worktrees/<project>/<spec>/`. The real
checkouts are put back **onto** their default branch before the worktrees are made and never leave it, so several runs
can go at once, the dashboard's spec list never describes whatever branch a running job is on, and a user can use the
checkout meanwhile. Two consequences worth knowing before changing anything here:

- The result's `repos[].root` is the MAIN checkout, not the directory the work happened in — the dashboard spawns git
  in that path after the run is over, and a worktree path is deleted when the run ends. `repos[].worktree` carries the
  throwaway one.
- A worktree carries tracked files only, so `.venv` and `dashboard/node_modules` reach it through `worktreeLinks:` in
  the `.aide/project.yaml` (committed, or the dashboard's untracked copy, which the run copies into the worktree and
  keeps out of the commit) — symlinked in, and excluded from `git add -A` by pathspec, because a `dir/`
  gitignore rule does not match a symlink. `.aide/config`'s `AIDE_WORKTREE_LINKS` is still read when the manifest names
  none — the manifest wins where both do, and the run reports which file it read (`worktreeLinksSource` in the result
  blob, and a line on stderr).
- The specs root reaches the worktree in one of three shapes. A separate specs repository gets a worktree of its own. A
  specs root inside the project that git ignores — aide's own `/specs/` — is linked in from the main checkout and never
  committed. One inside the project that is tracked, or not committed yet as in a new project's first spec, is part
  of the branch and committed with the step. A `.aide/config` naming the specs root by absolute path is pointed at the
  worktree's copy for the run.

**A run reaches the project and its specs root, and nothing else.** A repo the run was not told about is not touched,
and there is no flag to name a third one. A spec that has to change two projects at once needs that naming built,
deliberately.

**`aide-run-spec` runs from a private copy of itself, and that is load-bearing:** an `implement` step reinstalls Aide,
which copies the script over itself while bash is still reading it by byte offset. The copy's marker holds its own
path and is unset before `claude` starts — a bare exported flag would be inherited by `claude`, and the next nested
invocation would delete the installed script.

**`aide-run-spec`'s shebang finds `/bin/bash` on this machine, and that is bash 3.2 — `mapfile` is bash 4 and is not
available.** Anything added to this script that wants an array built from multiple lines has to set it via repeated
`array+=(...)` instead.

## Running a step by hand

The queue is what normally drives `aide-run-spec`, but it runs ONE workflow step for ONE spec from a terminal too,
with the same guards:

```bash
aide-run-spec --project-dir ~/develop/myproject --command analyze --spec 81 \
              --timeout-sec 1200 \
              --permission-mode acceptEdits \
              --result-file /tmp/step.json [--push none|branch|pr] [--pull]
              [--worktree-base ~/.aide/dashboard/worktrees]
```

It refuses to start when the spec folder does not exist or when a required value is missing — but not over a dirty
checkout: the work happens in a worktree cut from origin's default branch, so what somebody left uncommitted in the
main checkout stops nobody. `--permission-mode` is never defaulted, because the most dangerous knob has to be typed
out by whoever starts the run. It enforces the step's own time limit (SIGTERM to the process group, then SIGKILL), commits
whatever the step managed to write in BOTH roots — the project and the specs repo — and writes one JSON line to
stdout and to `--result-file`. `--worktree-base` relocates the worktrees; a base inside any of the repos is refused.
The worktrees go when the run ends, and one left behind by a killed run is swept by the next run for that spec.
`--dry-run` prints the command line it would use and starts nothing.

A step started this way reports nothing to a board unless `AIDE_RUN_URL` is set (see Live runs below); a step the
queue starts needs no such setting.

## What a finished step publishes

`push` in the queue config, passed on to `aide-run-spec`:

- `none` — commit locally and stop. Review by fetching from the host that ran it.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs repo's own commits. The specs page and the
  notification then link to the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving host; a broken `gh` records the error and leaves
  the run successful.
