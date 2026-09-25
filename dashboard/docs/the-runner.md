# The runner and its checkouts

What a run does to the repositories it touches: the clones the dashboard keeps of its own, the `git worktree`
checkouts a step works in, what a finished step publishes — and, last, how to run one step by hand.

**Where the code is.** `core/scripts/aide-run-spec` is the entry point and holds little else; the mechanics are in
`core/scripts/lib/run-spec-*.sh`, eighteen files named for what they do. The ones this page describes:

| For a change to                                     | Open                      |
|-----------------------------------------------------|---------------------------|
| The flags and what each refuses                     | `run-spec-arguments.sh`   |
| The worktrees, their paths and the links into them  | `run-spec-checkouts.sh`   |
| Branching each root, and the per-root lock it takes | `run-spec-branch.sh`      |
| The gates before a step starts, and the lock itself | `run-spec-gates.sh`       |
| Committing and pushing afterwards                   | `run-spec-publish.sh`     |
| Whether a step counts as having run                 | `run-spec-status-line.sh` |
| The test gate an implement ends on                  | `run-spec-step-tests.sh`  |
| Where the specs root comes from, and the model turn | `run-spec-spec-paths.sh`  |

The per-root lock is `$root/.git/aide-run-spec-worktree.lock` (`acquire_worktree_lock`, `run-spec-gates.sh`). Every
move of a shared checkout takes it: the switch, the fetch, the fast-forward and the `worktree add`.

Two pages sit beside this one:

- [Running specs](running-specs.md) — the queue that starts these runs
- [Branches and landing](landing.md) — how a step's branch is merged afterwards

## Table of contents

- [What a run does, in order](#what-a-run-does-in-order)
- [The dashboard's own checkouts](#the-dashboards-own-checkouts)
- [How a run touches the repositories](#how-a-run-touches-the-repositories)
- [What counts as a step having run](#what-counts-as-a-step-having-run)
- [What a finished step publishes](#what-a-finished-step-publishes)
- [Running a step by hand](#running-a-step-by-hand)

---

## What a run does, in order

1. The checkouts it will touch are put onto their default branch and brought up to date, under the per-root lock.
2. A `git worktree` is cut from each one, on the branch `aide/<spec-folder>`.
3. The gitignored paths the project needs are symlinked into each worktree, and the dashboard's own
   `.aide/project.yaml` and a repointed `.aide/config` are copied in.
4. The step runs there — one turn of the chosen CLI, under the step's time limit.
5. Whatever it wrote is committed in every root it touched.
6. Each root is pushed, or not, by the three conditions below.
7. One JSON line is written to stdout and to `--result-file`, and the worktrees are removed.

Each of those is a section below, except the step's own turn, which is
[Running specs](running-specs.md)'s business.

## The dashboard's own checkouts

**The checkout a run is cut from is not the one a user edits.** Cutting a worktree from
`<projects root>/<project>` — the directory Add clones into and the directory somebody works in — puts two writers on
one tree: the runner puts every root it touches onto its default branch before it starts, and a landing merges and
pushes from the same tree, while a user edits it meanwhile. The per-repo lock serializes the dashboard against itself. Nothing serializes it against a person's own git
client.

So the dashboard keeps clones of its own, under
`~/.aide/dashboard/checkouts/<project>/` — `code/`, plus `specs/` when the specs root is a separate repository. One per
project, never one per run;
`--dashboard-checkouts <dir>` moves them. They are made the first time they are needed, by cloning the user's
checkout's own `origin`, and reused ever after. Everything that MUTATES goes there: `aide-run-spec
--project-dir`, a landing's merge and push, Save, Update, the dependency gate's fetches, the drift poll. The user's
checkout is read and never written: the project list, the manifests, its `.aide/config`, its `AIDE_SPECS_PATH`,
the sources its worktree links point at, and the `origin` a clone is made from.

**The spec list itself is read from the dashboard's own checkout, not the user's.** Every reader-facing
listing —
`GET /projects/:name`, `GET /projects` and the home page's queue rows, archived rows included — lists from
`resolvedCheckouts.get(project)?.specs`
when the dashboard's own clone exists, falling back to the user's checkout otherwise (a new project, or one whose
clone failed). This is the same clone `aide-run-spec` resolves a spec folder against, so a folder that only exists in
the user's checkout, committed but never pushed, does not appear in the list — a row for it would offer a step that
fails with `unknown spec: ... (not under
<dashboard-checkout>/specs/<project>)`. The fetch that keeps the dashboard's clone current is
`ensureDashboardCheckout`'s, run for every allowed project on `refreshSpecCaches`'s schedule — and awaited inside
the few requests that write, such as a Settings save. A render never waits on it: the read-only paths ask
`peekMachinerySpecDir`, which reads the cache and spawns no git.

Two consequences worth knowing:

- **A landed run and a Save do not show up in a user's own checkout until they pull it.** Nothing auto-syncs into
  it, deliberately: an auto-pull would recreate exactly the collision this removes. An operator closes that gap with a cron entry for `aide-pull-specs` — every two minutes on the serving host — set
  up by hand; see [Hosting the dashboard](hosting.md#keeping-the-hosts-specs-current).
- **`.aide/config` is gitignored, so a clone never carries it.** It is copied from the user's checkout on every
  ensure, because it is the file an operator edits by hand between merges: a copy taken once would go stale.
  `AIDE_SPECS_PATH` is the one key that does not survive the copy: it names a directory in the user's checkout, and is
  replaced with the dashboard's own specs. The file is written once, finished, through a rename — a run starting for
  another job never reads a copy that still names the user's path.

A project whose checkout has no `origin` gets no clone of its own. It runs in the user's checkout, and its readiness
line says so, so a reader sees which project that is.

## How a run touches the repositories

**`aide-run-spec` branches EVERY repo it touches, not just the project.** An `analyze` step changes only the specs
repo, so branching the project alone would leave the analysis committed on `main` — the one thing `push branch` exists
to prevent. Three conditions decide it (`run-spec-publish.sh`), in this order:

1. The branch holds something beyond its own default branch. A branch with nothing of its own is never pushed.
2. Origin does not already have that tip.
3. Either this run moved the root's HEAD, or the run ended `completed` — `terminalReason` in the result, the one
   word saying how the step ended (`completed`, `tests-red`, `no-progress`, `timeout`, `scope-violation` and the
   rest). A root the run did move is pushed whatever
   the run's terminal reason; a root it did not move is pushed only by a completed run.

The third condition is what lets a later run retry a commit whose push failed in an earlier one: a rule that asked
only "did THIS run move it" would strand that commit, since no later run would ever pick it up. **It is never
`changedFiles`** — that field counts only what the run's own commit loop found uncommitted, and a step that commits
its own work, as archive does, leaves it at `0` with real commits on the branch. The compare link
is built from the repos that were pushed (`branchUrls` in the result; `branchUrl` keeps the single most interesting
one).

**It branches them in `git worktree` checkouts of its own**, under `$HOME/.aide/dashboard/worktrees/`. The path is
`<basename of --project-dir>/<spec>/<basename of each root>` — and since the dashboard passes its own clone,
`<base>/<project>/code`, the first segment reads `code` for every project on a serving host, not the project's
name. A project with no `origin`, which runs in the person's own checkout, is the one case where that segment is
the project's directory name. The real
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

**A run reaches the project and its specs root, and under the specs root only its own spec's folder.** A step
that writes another spec's folder ends `scope-violation`, with those changes discarded before the commit. A repo the run was not told about is not touched,
and there is no flag to name a third one. A spec that has to change two projects at once needs that naming built,
deliberately.

**`aide-run-spec` runs from a private copy of itself.** an `implement` step reinstalls Aide,
which copies the script over itself while bash is still reading it by byte offset. The copy's marker holds its own
path and is unset before `claude` starts — a bare exported flag would be inherited by `claude`, and the next nested
invocation would delete the installed script.

**`aide-run-spec`'s shebang finds `/bin/bash` on this machine, and that is bash 3.2 — `mapfile` is bash 4 and is not
available.** Anything added to this script that wants an array built from multiple lines has to set it via repeated
`array+=(...)` instead.

## What counts as a step having run

A step's own claim of success is not what puts it on a spec's `Workflow steps completed:` line. The runner
rebuilds that line after every step, and cross-checks the claim first, because a model's turn ending cleanly is
not evidence that the phase happened. What the line is FOR is on
[A spec's lifecycle](spec-lifecycle.md#what-has-had-a-phase-means); what follows is how it is decided.

**The runner writes it, not the model.** After every step, `completed_steps_for` in
`core/scripts/lib/run-spec-records.sh`
rebuilds the line from the specs repo's own history: the commits whose subject reads `Run /aide-<step> for <folder>`
since the current work round began, plus the step that has just completed. A step that ended `stopped` or `failed`
is committed with the reason in its subject (`(stopped: timeout)`) and is not counted. A spec made by hand, with no runner commit behind it, has no line and
reads as having had nothing — deliberately, because a spec that reads as unfinished is fixed by running the step, where
a guess is not.

**A step's own claim of success is cross-checked before it counts**, because the model's turn ending cleanly is not
evidence that the phase happened:

- `implement` counts only if the project's HEAD moved, its tree changed, or its branch differs from the default
  branch — the third catches a re-pressed implement that finds an earlier run's code already on the branch and
  writes nothing itself. Otherwise the step ends `no-progress` and
  the line is not extended. It also ends only on a green test run the runner made ITSELF
  (`run-spec-step-tests.sh`): the same `aide-resolve-test-cmd` and `aide-record-test-run` the landing's gate calls run
  on the step's result in its worktree, and the record on the branch is the runner's. Red goes back to the same
  session first — the failing lines as a follow-up turn, up to two more rounds within what is left of the step's
  time limit (`AIDE_TEST_FIX_ROUNDS`; claude resumes its session, Codex its thread through `codex exec resume`). Still red after
  that, the step ends `tests-red` with the failing lines as its detail, and Implement is the button to press again.
  A change no test command covers has nothing to run and passes as before. A record the session wrote through
  `aide-record-test-run` on exactly the delivered tree (its `tree` hash), green and naming the same commands, is
  accepted as that run; anything the session changed afterwards makes the runner run the suite itself.
- `archive` runs no suite of its own, merged with main or not: its landing runs the project's tests once, on
  exactly what the default branch is about to become, and that is the one run an archive gets
  ([Branches and landing](landing.md#the-tests-run-on-the-landing-once)).
- `archive` counts only if the folder is under `archive/` afterwards. A folder that stayed put because
  `aide-archive-spec` refused (`not-implemented-yet`, `acceptance-criteria-unticked`) ends as that refusal, the same
  as when the refusal came before the session; otherwise `no-progress`. An archive handed a merge with the default
  branch OPEN (`update_branch_to_base`) counts only if the branch contains that base tip afterwards — a session
  that aborted the merge and still moved the folder ends `merge-unfinished`, since the landing would meet the same
  conflict again.
- `analyze` is refused as `scope-violation` if it changed the project, advanced a status row, or wrote a step onto the
  line that it did not run.

**A stamp counts only while nothing cancels it.** An `**Archived:**` or `**Closed:**` line is in effect until a
later `**Round boundary:**`, `**Reopened:**` or `**Reset:**` mark follows it, and every reader applies that same
rule — `spec-transitions.sh` and `spec-state.sh` in bash, `stampInEffect` in `discover/spec-files.ts` on the
dashboard's side. A new stamp written after the boundary counts again.

What the cross-check does not cover: whether the step's commit reached origin, and whether the landing that
follows succeeded. The line is rebuilt from local history, so a step whose push was refused is still on it, and a
landing that fails afterwards does not take it off.

## What a finished step publishes

What the queue passes as `--push`: `push` from the queue config, or `pr` regardless of it for a project whose
manifest says `codeLanding: pr`.

- `none` — commit and stop. The commits are on `aide/<spec-folder>` in the checkout `--project-dir` named, not in
  the worktree, which is deleted when the run ends; review them there, or fetch that branch from the host.
- `branch` (the queue's default) — also push `aide/<spec-folder>`, and the specs repo's own commits. The specs page and the
  notification then link to the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving host; a broken `gh` records the error and leaves
  the run successful.

**What the commits and the pull request say.** The specs repo's commit is the step's record, `Run /aide-<step> for
<folder>`, and is where the steps are read back from. A code repo's commit describes the change and names no tool, spec
or step, because the project may have nothing to do with Aide: the session writes the message to a file the prompt
names, the spec's title stands in when it wrote none, and a stopped step's is marked `WIP:`. The pull request takes
that message's subject as its title and the rest as its description.

## Running a step by hand

The queue is what normally drives `aide-run-spec`, but it runs ONE workflow step for ONE spec from a terminal
too, with the same guards. **A by-hand run works in the checkout you point it at** — your own, if that is what
`--project-dir` names. It puts that checkout on its default branch and cuts its worktrees from it, so do not run
one against a directory you are editing in another window. The dashboard avoids that by pointing at its own clone;
from a terminal, the choice is yours.

```bash
aide-run-spec --project-dir ~/develop/myproject --command analyze --spec 81 \
              --timeout-sec 1200 \
              --permission-mode acceptEdits \
              --result-file /tmp/step.json
```

`--command` takes any of the nine step names in `core/scripts/lib/workflow-steps.json`, not only the four phases,
and some of them need one more flag: `--title` and `--description` for a `create` whose `--spec` names no existing
folder, `--prompt-file` for `schedule`, `--reason` for `close`. Beyond those: `--tool claude|codex|opencode`
chooses the CLI, `--model` and `--effort` what it runs as, `--push none|branch|pr` what is published,
`--kill-grace-sec` (30) how long the step has between SIGTERM and SIGKILL, and `--worktree-base` where the
worktrees go. `run-spec-arguments.sh` is the whole list.
It refuses to start when the spec folder does not exist or when a required value is missing — but not over a dirty
checkout: the work happens in a worktree cut from origin's default branch, so what somebody left uncommitted in the
main checkout stops nobody. `--permission-mode` is never defaulted: the most dangerous flag has to be typed out. The queue passes
`bypassPermissions` for the steps that run Aide's own git-writing scripts and `acceptEdits` for the rest. It enforces the step's own time limit (SIGTERM to the process group, then SIGKILL), commits
whatever the step managed to write in BOTH roots — the project and the specs repo — and writes one JSON line to
stdout and to `--result-file`. `--worktree-base` relocates the worktrees; a base inside any of the repos is refused.
The worktrees go when the run ends, and one left behind by a killed run is swept by the next run for that spec.
`--dry-run` prints the command line it would use and starts nothing.

**A run started by hand publishes nothing unless it is told to.** `--push` defaults to `none` here, deliberately,
where the queue passes `branch` — so the section above describes what the QUEUE does with a finished step, not
what a terminal does.

A step started this way reports nothing to a board unless `AIDE_RUN_URL` is set (see
[Live runs](running-specs.md#live-runs)); a step the
queue starts needs no such setting.
