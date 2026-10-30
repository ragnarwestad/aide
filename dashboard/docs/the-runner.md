# The runner and its checkouts

## Table of contents

- [What a run does, in order](#what-a-run-does-in-order)
- [How a run names its Claude sessions](#how-a-run-names-its-claude-sessions)
- [The dashboard's own checkouts](#the-dashboards-own-checkouts)
- [How a run touches the repositories](#how-a-run-touches-the-repositories)
- [What a step can reach](#what-a-step-can-reach)
- [What counts as a step having run](#what-counts-as-a-step-having-run)
- [What a finished step publishes](#what-a-finished-step-publishes)
- [The run log](#the-run-log)
- [Running a step by hand](#running-a-step-by-hand)

---

What a run does to the repositories it touches: the clones the dashboard keeps of its own, the `git worktree`
checkouts a step works in, what a finished step publishes — and, last, how to run one step by hand.

**Where the code is.** `core/scripts/aide-run-spec` is the entry point and holds little else; the mechanics are in
`core/scripts/lib/run-spec/`, twenty-nine files in five folders named for when they run. The ones this page describes:

| For a change to                                     | Open                                      |
|-----------------------------------------------------|-------------------------------------------|
| The flags and what each refuses                     | `run-spec/setup/arguments.sh`             |
| What a step may not reach, and the sandbox settings | `run-spec/setup/sandbox.sh`               |
| The worktrees, their paths and the links into them  | `run-spec/checkout/checkouts.sh`          |
| Branching each root, and the per-root lock it takes | `run-spec/checkout/branch.sh`             |
| The gates before a step starts, and the lock itself | `run-spec/setup/gates.sh`                 |
| Committing and pushing afterwards                   | `run-spec/publish/publish.sh`             |
| Whether a step counts as having run                 | `run-spec/record/status-line.sh`          |
| The two reviews' lines in the log, and the review   | `run-spec/turn/review.sh`                 |
| Stopping an analyze on its acceptance criteria      | `run-spec/record/criteria-check.sh`       |
| Stopping an analyze on files another spec changes   | `run-spec/record/shared-files-check.sh`   |
| Failing a short analysis that is over a limit       | `run-spec/record/short-analysis-check.sh` |
| Ending an implement that sends its spec back        | `run-spec/record/sent-back-check.sh`      |
| Reading and writing Tracking info bullets           | `lib/tracking-info.sh`                    |
| The test gate an implement ends on                  | `run-spec/turn/step-tests.sh`             |
| Where the specs root comes from                     | `run-spec/turn/spec-paths.sh`             |
| The model turn, and reading what came back          | `run-spec/turn/model-turn.sh`             |
| What the run reports, and the result JSON           | `run-spec/publish/result.sh`              |

The per-root lock is `$root/.git/aide-run-spec-worktree.lock` (`acquire_worktree_lock`, `run-spec/setup/gates.sh`). Every
move of a shared checkout takes it: the switch, the fetch, the fast-forward and the `worktree add`.

Two pages sit beside this one:

- [Running specs](running-specs.md) — the queue that starts these runs
- [Branches and landing](landing.md) — how a step's branch is merged afterwards


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

## How a run names its Claude sessions

Every Claude session a run starts gets a display name, so `claude --resume` on the serving host and the session lists of
a tool that reads Claude Code's session files say which project, spec and step a session belonged to. The runner passes
it as `--name`; `<project>` is the project's name on the board, the same as the first segment of the worktree path.

| The session                                     | Its name                                        |
|-------------------------------------------------|-------------------------------------------------|
| A step on a spec: analyze, implement, archive … | `<project> <spec number> <step>`                |
| The review after an implement                   | `<project> <spec number> review`                |
| The verification of the review's defects        | `<project> <spec number> verify`                |
| A create, which has no number yet               | `<project> new create`                          |
| A scheduled job                                 | `<project> schedule <entry name>`               |

A turn that continues a session passes no name, so the session keeps the one it has: the fix turn after a review or a
red test run stays `<project> <spec number> implement`, and an implement that continues its analysis's session stays
`<project> <spec number> analyze`. Codex and OpenCode sessions get no name: `codex exec` has no way to name one. The
code is in `run-spec/setup/invocation.sh`, and the review's name in `run-spec/turn/review.sh`.

## The dashboard's own checkouts

**The checkout a run is cut from is not the one a user edits.** Cutting a worktree from
`<projects root>/<project>` — the directory Add clones into and the directory somebody works in — puts two writers on
one tree: the runner puts every root it touches onto its default branch before it starts, and a landing merges and
pushes from the same tree, while a user edits it meanwhile. The per-repo lock serializes the dashboard against itself. Nothing serializes it against a person's own git
client.

So the dashboard keeps clones of its own, under
`~/.aide/dashboard/checkouts/<project>/` — `code/`, plus `specs/` when the specs root is a separate repository. One per
project, never one per run;
`--dashboard-checkouts <dir>` moves them. They are made only when a project is added or its settings are saved,
by cloning the user's checkout's own `origin`, and reused ever after; anything else that finds one missing reports it
and does not clone. Everything that MUTATES goes there: `aide-run-spec
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
to prevent. Three conditions decide it (`run-spec/publish/publish.sh`), in this order:

1. The branch holds something beyond its own default branch. A branch with nothing of its own is never pushed.
2. Origin does not already have that tip.
3. Either this run moved the root's HEAD, or the run ended `completed` — `terminalReason` in the result, the one
   word saying how the step ended (`completed`, `tests-red`, `no-progress`, `timeout`, `scope-violation` and the
   rest). A root the run did move is pushed whatever
   the run's terminal reason; a root it did not move is pushed only by a completed run.

**A `schedule` step commits and pushes exactly like any other command** — the project repository and the specs root,
the same two roots every other step reaches. Its own report and any proposed specs live outside both, under
`$AIDE_SCHEDULE_OUTPUT_DIR`, so a run that also commits still writes its report. Once the step ends, the board lands
what it pushed the way an archive's own landing does (`landScheduleRun`, `dashboard/src/serve/land-branch/steps.ts`):
the project repository's commit only after that repository's own test command is green on the merge, the specs root
directly. A run stopped by its own timeout or a cancel keeps whatever it had already committed, on its branch, the
same as any other command.

The third condition is what lets a later run retry a commit whose push failed in an earlier one: a rule that asked
only "did THIS run move it" would strand that commit, since no later run would ever pick it up. **It is never
`changedFiles`** — that field counts only what the run's own commit loop found uncommitted, and a step that commits
its own work, as archive does, leaves it at `0` with real commits on the branch. The compare link
is built from the repos that were pushed (`branchUrls` in the result; `branchUrl` keeps the single most interesting
one).

**It branches them in `git worktree` checkouts of its own**, under `$HOME/.aide/dashboard/worktrees/`. The path is
`<project>/<spec>/<basename of each root>`. The first segment is the project's name: for the dashboard's own clone,
`checkouts/<project>/code`, it is `<project>` (`worktree_project_key` in `run-spec/setup/invocation.sh`), and for any other
`--project-dir` it is that directory's basename. The real
checkouts are put back **onto** their default branch before the worktrees are made and never leave it, so several runs
can go at once, the dashboard's spec list never describes whatever branch a running job is on, and a user can use the
checkout meanwhile. Two consequences worth knowing before changing anything here:

- The result's `repos[].root` is the MAIN checkout, not the directory the work happened in — the dashboard spawns git
  in that path after the run is over, and a worktree path is deleted when the run ends. `repos[].worktree` carries the
  throwaway one.
- A worktree carries tracked files only, so `.venv` and `dashboard/node_modules` reach it through `worktreeLinks:` in
  the `.aide/project.yaml` (committed, or the dashboard's untracked copy, which the run copies into the worktree and
  keeps out of the commit) — symlinked in, and excluded from `git add -A` by pathspec, because a `dir/`
  gitignore rule does not match a symlink. The run reports which file it read (`worktreeLinksSource` in the result
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

## What a step can reach

**A Claude step runs in Claude Code's own sandbox, with a fixed list of paths it may not read or write.** The list is
the credentials on the serving host and the board's own secrets: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, the
macOS keychains, Docker's, npm's and netrc's credentials, the Codex and OpenCode logins, and the board's tokens and
push key. It lives in `run-spec/setup/sandbox.sh`, and no project setting changes it.

**A second list may be read but not written**: what something outside the sandbox later runs or reads as its
settings. Those are:

- the shell's startup files (`~/.zshrc`, `~/.zshenv`, `~/.bashrc` and the rest);
- `~/Library/LaunchAgents`, `~/.local/bin` and mise's tools and settings;
- git's own settings (`~/.gitconfig`, `~/.config/git`);
- the AI tools' settings, hooks, skills, agents and rules (`~/.claude.json`, the settings and those folders under
  `~/.claude`, `~/.agents`, `~/.codex`, `~/.config/opencode`);
- the board's `queue-config.json`, where a scheduled job may turn the sandbox off;
- the `.git/hooks` and `.git/config` of the step's own main checkouts and of every checkout under
  `~/.aide/dashboard/checkouts`, and each of those checkouts' `settings.yaml`, which holds the project's test command.

A step therefore cannot install anything onto the serving host; `AIDE_INSTALL_CMD` does that after a landing. The
board hands the runner where its queue settings and checkouts are (`AIDE_QUEUE_CONFIG`, `AIDE_CHECKOUT_ROOT`).

Two more things keep what a step writes from reaching the runner's own work outside the sandbox, for every tool:

- a scheduled job's prompt is read as committed in the checkout, never from the file on disk;
- each worktree's `.git` file, and the `commondir` and `gitdir` files of its git directory, are recorded when the
  worktree is cut and put back after every turn, so the runner's own git never follows a step's rewrite of them.

Everything else is reachable:

- shell commands may write anywhere else in the home directory and in the temporary directories;
- the step's own worktree and its spec's worktree in the specs repository are writable, and so is the main checkout's
  git directory they point into;
- the network is open, and a command may start a server on localhost and reach it.

The sandbox confines shell commands only. Claude's file tools follow permission rules instead, so the runner passes the
same paths as `Read(...)` and `Edit(...)` deny rules, which win over the user's own global `allow` of `Edit` and
`Write`. A command cannot ask to run outside the sandbox.

**A browser cannot start in the sandbox.** Chromium registers a macOS service the sandbox has no setting for. A Claude
step is told so in its prompt and does not run browser tests itself; the runner's own test run, outside the sandbox,
runs them before the work can land. A scheduled job whose own commands start a browser runs without the sandbox: its
entry's Sandbox is set to Off on its Settings tab (`"sandbox": false`, `aide-run-spec --no-sandbox`).

**The runner's own test run executes what the step wrote, outside the sandbox.** An `implement` step's tests, a
landing's tests and every hook git runs there run with everything the user can reach, the denied paths included. A
step talked into writing a test that reads a key gets that key read when the runner runs the suite; the step itself
never sees the output of a passing run, but the test can send what it read over the open network. Only a container
per run (`docs/ROADMAP.md`, idea 18b) closes this.

**A Codex step and an OpenCode step run without it.** Codex's sandbox can confine writing but not reading, and `git`
in a worktree fails under `workspace-write`, because the worktree's git directory lies in the main checkout. OpenCode
has no sandbox of its own. `docs/AI_SUPPORT_MATRIX.md` has the versions this was checked against.

The runner's own commit, push and landing run outside the sandbox, as before.

## What counts as a step having run

A step's own claim of success is not what puts it on a spec's `Workflow steps completed:` line. The runner
rebuilds that line after every step, and cross-checks the claim first, because a model's turn ending cleanly is
not evidence that the phase happened. What the line is FOR is on
[How a spec moves between phases](spec-transitions.md#what-has-had-a-phase-means); what follows is how it is decided.

**The runner writes it, not the model.** After every step, `completed_steps_for` in
`core/scripts/lib/run-spec/record/records.sh`
rebuilds the line from the specs repo's own history: the commits whose subject reads `Run /aide-<step> for <folder>`
since the current work round began, plus the step that has just completed. A step that ended `stopped` or `failed`
is committed with the reason in its subject (`(stopped: timeout)`) and is not counted. A completed `analyze` is newer
than every `implement` and `archive` before it, and those no longer count: the scan reads the log newest first
(`--date-order`) and skips them, and the run's own completed analyze takes them off the line as well. The
TypeScript twin (`readWorkflowSubjects`) applies the same rule and names the steps it skipped.

**A completed analyze of a spec that stood at `implemented` before the session also rebuilds the acceptance table.**
`analysis_follows_implement` (same file) reads the state at the ref taken before the session, and
`rebuild_acceptance_rows` (`core/scripts/lib/spec-transitions.sh`) rewrites the table from `1-description.md`, every
row open, before Total progress and the state file are derived, so all three ride in the step's own commit. Any other
ending, or a spec that was not implemented, leaves the table alone. A spec made by hand, with no runner commit behind it, has no line and
reads as having had nothing — deliberately, because a spec that reads as unfinished is fixed by running the step, where
a guess is not.

**A step's own claim of success is cross-checked before it counts**, because the model's turn ending cleanly is not
evidence that the phase happened:

- `implement` counts only if the project's HEAD moved, its tree changed, or its branch differs from the default
  branch — the third catches a re-pressed implement that finds an earlier run's code already on the branch and
  writes nothing itself. Otherwise the step ends `no-progress` and
  the line is not extended. Once past that check, a second, fresh AI session — never resumed, on the model the
  queue config's `model.review` names, else the step's own — reads the spec's own description and, with `git diff` itself, everything the branch changed
  since it left the default branch, and looks for defects against the description, each with the concrete case it
  goes wrong for; it never comments on style, naming or structure (`run-spec/turn/review.sh`),
  except that a description with an `## Out of scope` section makes each change under an item in it a defect too. One or
  more found are checked first, when `model.verify` names a model, by a third fresh session that keeps or drops each
  one after tracing it in the code; only the kept ones go on, and a verification that does not complete keeps them
  all. A review or verification runs on the step's own tool or on Codex, read-only (`run-spec/turn/side-turn.sh`),
  and a review on Codex that does not complete, out of quota or at capacity, is done again by the step's own model.
  Those found go back to the ORIGINAL implement session as one follow-up turn that fixes them, or turns one down on a
  `not a defect: <number>. <why>` line when the review is wrong, and that turn's own
  failure stands as the step's outcome; the review's own turn is best-effort, and any outcome other than a clean
  "no defects" — a verdict it cannot parse, or its own turn failing to complete — falls back to "found nothing"
  rather than failing an already-successful, already-committed implement over the added safety net's own hiccup.
  Either is logged as an error, never as a review that found nothing.
  The step ends only on a green test run the runner made ITSELF
  (`run-spec/turn/step-tests.sh`), which always follows the review: the same `aide-resolve-test-cmd` and
  `aide-record-test-run` the landing's gate calls run
  on the step's result in its worktree, and the record on the branch is the runner's. Red goes back to the same
  session first — the failing lines as a follow-up turn, up to two more rounds within what is left of the step's
  time limit (`AIDE_TEST_FIX_ROUNDS`; claude resumes its session, Codex its thread through `codex exec resume`). Still red after
  that, the step ends `tests-red` with the failing lines as its detail, and Implement is the button to press again.
  A project without `AIDE_TEST_CMD` has nothing to run and passes. A record the session wrote through
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

## The run log

What `aide-run-spec` prints to stderr is kept per step as `<job id>.<step>.run.log`, beside the transcript
`<job id>.<step>.stream.jsonl`. `src/queue/runner/run-log-path.ts` names it from the transcript's path and empties it
before each spawn; the job page reads it (up to 1 MiB) before the transcript and merges the two into the step's Log
(`src/queue/parse-stream/step-log.ts`). A step run before the file existed has a transcript and no run log, and shows
the transcript alone. An implement in Aide's own repository can leave a folder `<job id>.<step>.screenshots` beside
them (`run-spec/turn/screenshots.sh`, named from the transcript by `screenshotsDir` in the same TypeScript file); the
step's Log tab links its pictures, served by `GET /jobs/<id>/screenshots/<step>/<file>`
([the pages an implement looks at](tests-in-a-spec.md#looking-at-the-pages)). The grammar is the whole contract
between the bash script and the page:

```text
aide-run-spec HH:MM:SS +Ns <text>                                      something the run did
aide-run-spec HH:MM:SS +Ns error: <text>                               a failure, listed in the Errors tab
aide-run-spec HH:MM:SS +Ns model turn started (transcript at byte N)   where the AI's next turn begins
aide-run-spec HH:MM:SS +Ns --- Step N of X: <title> — started          a step mark the model wrote, with its time
aide-run-spec: <text>                                                  an older, unstamped note
<anything else>                                                        another script's line on stderr
```

The script marks the parts it runs itself the way a skill's steps are marked: `--- Step Aide: preparing — started` on
its first line, `— done` just before the AI's first turn; `--- Step Aide: tests and commit — started` after the AI,
ending `— done`, or `— stopped: <why>` for a step that failed. A model turn closes the part it interrupts and a fix
turn opens it again after itself, so the log reads as one sequence of marked parts (`aide_part_open`,
`aide_part_close`).

The marks the model writes itself are dated while it works. The wait loop of `run_model_turn` reads the transcript's new
bytes each time it polls (`model_marks_record`, `run-spec/turn/model-marks.sh`), finds the lines of the model's own
text that are marks and prints each into the run log, so it carries the run's clock like Aide's own parts. The three
tools share no clock of their own, so the time is the moment the runner first sees the line, at most a poll (0.2
seconds) late; a model that writes several marks at once gets the same second for each, in order. The text is a
`text` block of a Claude `assistant` event with no `parent_tool_use_id`, the text of a Codex `agent_message` item
(`item_type` or `type`), or an opencode `text` part. A turn reads from where its own output begins, so the review's and
a fix turn's marks are each recorded once; a line past 1 MiB is skipped, and a last line with no newline is read when
the turn ends. The page shows the model's own line with that time in front and drops the recorded copy, so a mark is
one line of the Log, and a recorded line no line of the model matches (the landing's merge step, a line before the byte
a tailed transcript starts at) stays among Aide's. The Log shows a mark whole, whatever the length of its title. A run
from before has no recorded marks, and its model steps show a dash for time.

A `schedule` step's prompt is the prompt file's text, then a request to split the work into a few named steps and mark
each one with the same lines (`schedule_step_note`, `core/scripts/lib/run-spec/setup/invocation.sh`), then the headless
note. The prompt file names no steps, so the model names them itself, and the marks it writes in its output are the
steps the job's row on the Running page unfolds into.

Every physical line is its own line. Only the `error: ` prefix marks an error and only the turn line marks a turn:
the transcript is cut at each turn's byte, and Aide's lines go between the turns. The script writes one `error:` line
for the step's own failure before its result line, and one for a refused run.

**What the two reviews found** is written in the `tests and commit` part. A completed analyze gets one line, read from
the `**Findings:**` line that opens the plan's Plan review section (`plan_review_line`, `run-spec/turn/review.sh`):
`plan review: 2 must-fix, 3 should-fix, 4 acted on — the findings are under Plan review in the plan (3-solution.md)`,
or that the plan has no Plan review section, or that the section gives no counts. Code blocks are skipped, and after a
`## Round N` heading only that round's review counts.

**Let AI formulate acceptance criteria.** A completed create records which path it took as the `Let AI formulate
acceptance criteria:` line in the new spec's Tracking info: `yes` when an AI session ran, `no` for `--no-ai-formulate`
(`aide_spec_record_ai_formulate`). The board reads it for the spec's banner; a spec without the line is read as `yes`.

**Let me choose the approach.** The New spec form's box is passed to `create` as `--choose-approach yes|no`, and any
other value is refused before the run starts. A completed create records it as the `Let me choose the approach:` line
after the `Acceptance criteria checks:` line (or after `Created`) in the new spec's Tracking info. Analyze reads it once
(`aide_spec_choose_approach`); with `yes` the prompt gets one line asking the skill to mark each approach
`(recommended)`, `(real alternative)` or `(considered and rejected)`, and with anything else the prompt is unchanged.
`core/tests/fixtures/choose-approach-line.json` is the table the runner and the dashboard both read the line against.

**The acceptance criteria checks.** The level (`off`, `warn` or `stop`) is chosen on the New spec form and passed to
`create` as `--criteria-checks`. A completed create records it as the `Acceptance criteria checks:` line after
`Created` in the new spec's Tracking info, whether or not an AI session ran. Analyze reads that line once and states
it in the prompt; a spec without the line, or with any other value, is read as `off`. At `stop`, a completed analyze whose Plan
review section's `**Criteria check:**` line names a fault after ` — ` ends `acceptance-criteria`
(`run-spec/record/criteria-check.sh`, after the scope guard, so a write outside the spec's folder is decided first):
`ok` false, the commit subject ending `(stopped: acceptance-criteria)`, the error naming each fault, and the result's
`criteriaFaults` sorting them into `missing`, `notEars`, `noScenario`, `contradictions` (each an `AC-a/AC-b` pair)
and `cannotBuild`. The state file does not gain `analyze`.
A line reading `none found`, or no such line at all, completes the step, and the log says what was read. The
runner reads the line and never judges the criteria itself. An implement's code review writes
`the review found no defects`, or an `error:` line with the count, one `review: <line>` per line of the reviewer's
list, one `the verification dropped review: <number>. <defect> — <why>` per defect a verification dropped, and
`the defect(s) went back to the implement session to be fixed` before the fix turn; after it, one
`the implement session found it not a defect: <number>. <why>` line per defect the session turned down.

**The shared files check.** The analyze skill compares the files its analysis will change (`### Files to change` in
`2-analysis.md`) with those of every other open spec in the project that is analyzed or implemented and not archived,
by running `aide-spec-overlap`, and stops before the plan when one shares a file. A Markdown file never counts: pages
are shared by nearly every spec, and archive resolves a conflict in one. After the turn
(`run-spec/record/shared-files-check.sh`, after the scope guard and before the criteria check) the runner runs the
same command with `--record`, which writes the specs found into the analysis's `### Overlapping specs`, and compares
that list with the one the analysis had before the turn. A spec that is new in it ends the step `shared-files`: `ok`
false, the commit subject ending `(stopped: shared-files)`, the error naming each spec with its files, and the
result's `sharedFiles` (`[{ "spec": "<folder>", "files": [...] }]`) carrying the same. The state file does not gain
`analyze`. A spec already in the list does not stop the next Analyze, which is how pressing it again goes on. When
`aide-spec-overlap` is not installed, the check is skipped.

**The short analysis check.** A small spec may get a short analysis: the files to change and where the tests sit, with
no plan and no plan review. The limits, the grade and the number of source files, are the `SHORT_ANALYSIS_*` constants in `run-spec/setup/arguments.sh`, the one
place they are set, with no per-project or environment override. For a spec that does not ask to choose the approach, the analyze prompt carries one line, `A short analysis is allowed for this spec`, stating
them; any other spec is told nothing and gets the full analysis. After the turn (`run-spec/record/short-analysis-check.sh`,
after the shared files check and before the criteria check) the runner reads `Analysis:` from `2-analysis.md`'s Tracking
info, `Grade:` and `Acceptance criteria:` from `3-solution.md`'s, and counts the source files among the paths under `### Files to change` (a test or a Markdown file is not counted) and the
`- **AC-n:**` lines of the description itself. The larger of the two criteria counts is logged and held to no limit. Every completed analyze is logged as
`short analysis: <short|full> — grade <g>, <n> acceptance criteria, <m> files to change, <s> of them source files`. A full analysis is only logged. A short
one over a limit, with no grade or no files recorded, or on a spec that asks to choose the approach, ends `short-analysis-over-limit`: `ok` false, the commit subject ending
`(stopped: short-analysis-over-limit)`, and an error naming each limit crossed (for the files limit, the source files it counted). The state file does not gain
`analyze`. The runner also writes `- **Sent back to a full analysis:** a short analysis was written over a limit: <the
limits crossed>` into the description (`record_sent_back`, the sentence cleaned as the sent-back check cleans its own),
unless the description already carries the line, whose reason is kept as it is; a description with no `Created:` line
cannot hold it, and the step ends the same way. The board then lands the step's specs branch (where the specs live inside the code root, the spec's own folder) and
queues one job for the same spec with Analyze and the steps the stopped job had not run, on its models and effort, with
nothing for a person to press. The line is on the main checkout once the branch has landed, so that Analyze is not
offered a short analysis and writes the full one. This is queued once per spec: a second `short-analysis-over-limit`
for the same spec queues nothing and waits for a press. The
`Analysis:` cases both the runner and the board read are in `core/tests/fixtures/analysis-line.json`. A spec whose
description carries a `Sent back to a full analysis:` line is never offered a short analysis, and one written for it
anyway ends `short-analysis-over-limit` with "it was sent back to a full analysis" among the limits crossed.

**The sent-back check.** Every implement prompt names a file in the run's work directory, `sent-back`, and says: if the
spec's analysis is short and the change is not small after all (more source files to change than the short analysis allows, or
not graded LOW), write one sentence saying what made it larger there, change nothing else and end the step. After the
turn (`run-spec/record/sent-back-check.sh`, after `checkout/cleanup.sh` and before the no-progress check, the code
review and the step's test run) a non-empty file decides the step. The sentence is joined to one line, stripped of
backticks and cut to 300 characters. When `2-analysis.md` reads `Analysis: short` and the description has a `Created:`
line, `record_sent_back` (`lib/tracking-info.sh`) writes `- **Sent back to a full analysis:** <sentence>` into the
description's Tracking info and the step ends `sent-back`: `ok` false, the commit subject ending `(stopped: sent-back)`.
Otherwise the description is left as it was and the step ends `sent-back-refused`, failed, with `(stopped:
sent-back-refused)`: the analysis was already full, or the line could not be kept. A missing or empty file changes
nothing. The line's cases both the runner and the board read are in `core/tests/fixtures/sent-back-line.json`.

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

`--command` takes any of the ten step names in `core/scripts/lib/workflow-steps.json`, not only the four phases,
and some of them need one more flag: `--title` and `--description` for a `create` whose `--spec` names no existing
folder, `--prompt-file` for `schedule`, `--reason` for `close`. Beyond those: `--tool claude|codex|opencode`
chooses the CLI, `--model` and `--effort` what it runs as, `--push none|branch|pr` what is published,
`--kill-grace-sec` (30) how long the step has between SIGTERM and SIGKILL, `--worktree-base` where the
worktrees go, and `--chrome` starts Claude with the logged-in Chrome — for `schedule` with `--tool claude` only,
refused anywhere else, and `--no-sandbox` runs Claude without its sandbox, for the same step and tool only.
`run-spec/setup/arguments.sh` is the whole list.
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
