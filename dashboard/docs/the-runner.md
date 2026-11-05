# The runner and its checkouts

## Table of contents

- [What a run does, in order](#what-a-run-does-in-order)
- [How a run names its Claude sessions](#how-a-run-names-its-claude-sessions)
- [When the AI tool does not start](#when-the-ai-tool-does-not-start)
- [When the AI tool reports an error](#when-the-ai-tool-reports-an-error)
- [When a provider limit ends a step](#when-a-provider-limit-ends-a-step)
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

## When the AI tool does not start

A turn whose tool exits without a result, before the model has done anything, ends the step as `cli-error`. The
job's `error` is the last 400 characters the tool wrote to stderr, followed by "press <step> again"
(`run-spec/turn/model-turn.sh`), so the tool's own explanation reaches the board.

A damaged `~/.claude.json` on the serving host is such a case. When the file is not valid JSON, `claude -p` exits 1
without starting: it names the file, says to fix the JSON or move the file aside, and leaves it unchanged (Claude Code
2.1.318). Every Claude step and every scheduled job on the host then fails the same way until someone has fixed or
moved the file, so when the tool's stderr names `.claude.json`, the job's `error` ends by saying to fix or move that
file on the serving host instead of "press <step> again". A step cannot damage the file itself, since the sandbox
lets it read `~/.claude.json` but not write it ([What a step can reach](#what-a-step-can-reach)).

## When the AI tool reports an error

A turn that ends `cli-error` with the tool's own error carries that error in the job's `error`, followed by "press
<step> again": Claude Code's error list or, when it has none, its result's text ("Not logged in · Please run /login",
"API Error: 500 …"); Codex's and opencode's last `error` or `turn.failed` message rather than their exit code; the
tool's stderr when it wrote no result. The runner also sorts it, and the result carries the answer as `providerError`
(`run-spec/turn/provider-error.sh`):

| `kind`     | When                                                                                                                      |
|------------|---------------------------------------------------------------------------------------------------------------------------|
| `login`    | A 401 or 403, Claude Code's `authentication_failed`, a missing or invalid key or token, an expired session, not logged in |
| `provider` | A 5xx, Claude Code's `server_error`, overloaded, a dropped connection or another network failure                          |
| `other`    | Anything else; `message` is the error's first line, cut at a word after 160 characters                                    |

A status counts only where it stands as one ("status 401", "API Error: 500", "502 Bad Gateway"), since the request ids
in Codex's messages hold digits too. A provider limit, a model at capacity, a refusal and the step's own time limit are
read first and never reach this.

The board words each kind in the reader's language (`cliErrorMessage`, `src/queue/runner/cross-check-message.ts`):
`login` says the tool is not logged in on the machine that runs Aide, and to log in there or press Check under Settings
and then the step's button again; `provider` says the provider had an error and to try again in a little while;
`other` gives the error's first line as the cause, with the step's button and the Check under Settings as what to do.
The job's whole `error` stays behind the row's (?). A step with no `providerError`, or on a tool with no Settings tab,
gets the sentence in `src/format/tool-failure.ts`, which names the tool and the model and carries the tool's words as
they came.

## When a provider limit ends a step

The runner ends a step with `provider-limit` when the tool's own record says a usage window ran out; the board's side
of it (the wait, the restart) is in [A job's states](job-states.md#beside-the-state). How each tool is read:

- **Claude Code**: the `rate_limit_event` the stream carries. It names the window that ran out, when it resets, the
  other windows' figures, and the plan or refused credit.
- **Codex**: the session file Codex keeps for the thread. A turn is a `provider-limit` when that file shows a full
  window, or when Codex's own error says the usage limit is hit; the error's "try again at" time is then the reset.
  The file is read under the `CODEX_HOME` the step ran with (`--codex-home`: the provider's shadow home, else its
  `CODEX_HOME`), through a `sessions` that is a link when the provider has a shadow home.
- **opencode**: no reader. A step on opencode never ends `provider-limit`.

The same readers decide `model-at-capacity`, which has no reset to wait for. It is read from the turn that just ended
alone, never from an earlier turn of the same step: from the last `error` or `turn.failed` event of a Codex turn that
did not complete, when its message says "at capacity", and from Claude Code's closing result when that is an error with
status 529 or a message saying overloaded or at capacity. A used-up limit and the step's own time limit win over it.
opencode has no reader.

## The dashboard's own checkouts

**The checkout a run is cut from is not the one a user edits.** The dashboard keeps clones of its own under
`~/.aide/dashboard/checkouts/<project>/`: `code/`, plus `specs/` when the specs root is a separate repository. There
is one per project, never one per run, and `--dashboard-checkouts <dir>` moves them. They are made when a project is
added or its settings are saved, by cloning the user's checkout's own `origin`, and reused after that; anything else
that finds one missing reports it and does not clone. Everything that MUTATES goes there: `aide-run-spec
--project-dir`, a landing's merge and push, Save, Update, the dependency gate's fetches, the drift poll. The user's
checkout is read and never written: the project list, the manifests, its `.aide/config`, its `AIDE_SPECS_PATH`, the
sources its worktree links point at, and the `origin` a clone is made from.

**The spec list is read from the dashboard's own checkout.** Every listing of specs, archived rows included, comes
from that clone when it exists, and from the user's checkout otherwise (a new project, or one whose clone failed). A
folder committed in the user's checkout but never pushed therefore has no row. A render never waits on the fetch that
keeps the clone current.

- **A landed run and a Save do not show up in a user's own checkout until they pull it.** Nothing auto-syncs into it.
  An operator can set up a cron entry for `aide-pull-specs` on the serving host; see
  [Hosting the dashboard](hosting.md#keeping-the-hosts-specs-current).
- **`.aide/config` is copied from the user's checkout on every ensure**, since it is gitignored and edited by hand
  between merges. `AIDE_SPECS_PATH` is the one key replaced: it names a directory in the user's checkout, and is set to
  the dashboard's own specs.

A project whose checkout has no `origin` gets no clone of its own. It runs in the user's checkout, and its readiness
line says so.

## How a run touches the repositories

**`aide-run-spec` branches EVERY repo it touches, not just the project.** An `analyze` step changes only the specs
repo, so branching the project alone would leave the analysis committed on `main`. A repo is pushed when all three
hold (`run-spec/publish/publish.sh`):

1. The branch holds something beyond its own default branch.
2. Origin does not already have that tip.
3. Either this run moved the root's HEAD, or the run ended `completed` (`terminalReason` in the result: `completed`,
   `tests-red`, `no-progress`, `timeout`, `scope-violation` and the rest).

The third condition lets a later run retry a commit whose push failed earlier. None of them is `changedFiles`, which
counts only what the run's own commit loop found uncommitted and is `0` for a step that commits its own work. The
compare link is built from the repos that were pushed (`branchUrls` in the result; `branchUrl` keeps the most
interesting one).

**A `schedule` step commits and pushes like any other command.** Its report and any proposed specs live under
`$AIDE_SCHEDULE_OUTPUT_DIR`, outside both roots. Afterwards the board lands what it pushed (`landScheduleRun`): the
project repository's commit only after that repository's own test command is green on the merge, the specs root
directly. A run stopped by its timeout or a cancel keeps what it had committed, on its branch.

**It branches in `git worktree` checkouts of its own**, under `$HOME/.aide/dashboard/worktrees/<project>/<spec>/<basename
of each root>`. For the dashboard's own clone `<project>` is the project's name; for any other `--project-dir` it is
that directory's basename (`worktree_project_key`, `run-spec/setup/invocation.sh`). The real checkouts are put back onto
their default branch before the worktrees are made and never leave it, so several runs can go at once.

- The result's `repos[].root` is the MAIN checkout, not the directory the work happened in; `repos[].worktree` carries
  the throwaway one.
- A worktree carries tracked files only. `.venv` and `dashboard/node_modules` reach it through `worktreeLinks:` in the
  `.aide/project.yaml` (committed, or the dashboard's untracked copy, kept out of the commit). The run reports which
  file it read (`worktreeLinksSource`).
- The specs root reaches the worktree in one of three shapes. A separate specs repository gets a worktree of its own. A
  specs root inside the project that git ignores (aide's own `/specs/`) is linked in from the main checkout and never
  committed. One inside the project that is tracked, or not committed yet, is part of the branch and committed with the
  step. A `.aide/config` naming the specs root by absolute path is pointed at the worktree's copy.

**An analyze or implement puts back a folder an unlanded archive moved.** An archive moves the spec's folder into
`archive/` on the spec's specs branch, and only its landing brings that to the default branch. When the branch has the
folder under `archive/` while the default branch has it open, the run moves it back before the session starts, with
whatever was written into the archived copy, and commits that on the spec's branch
(`run-spec/checkout/unlanded-archive.sh`). The move is `aide-reopen-spec`'s keep-the-files reopen: `archive` leaves the
steps line and the state file, and a round boundary makes the archive's stamp and commit history, so a later Archive
runs as on any implemented spec. A merge left open in that worktree is left alone.

**A run reaches the project and its specs root, and under the specs root only its own spec's folder.** A step that
writes another spec's folder ends `scope-violation`, with those changes discarded before the commit. There is no flag
to name a third repo.

## What a step can reach

**A Claude step runs in Claude Code's own sandbox, with a fixed list of paths it may not read or write.** The list is
the credentials on the serving host and the board's own secrets: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, the
macOS keychains, Docker's, npm's and netrc's credentials, the Codex and OpenCode logins (every Codex provider's `auth.json` too), and the board's tokens and
push key. It lives in `run-spec/setup/sandbox.sh`, and no project setting changes it.

**A second list may be read but not written**: what something outside the sandbox later runs or reads as its settings.

- the shell's startup files (`~/.zshrc`, `~/.zshenv`, `~/.bashrc` and the rest);
- `~/Library/LaunchAgents`, `~/.local/bin` and mise's tools and settings;
- git's own settings (`~/.gitconfig`, `~/.config/git`);
- the AI tools' settings, hooks, skills, agents and rules (`~/.claude.json`, and those under `~/.claude`, `~/.agents`,
  `~/.codex`, `~/.config/opencode`), and the same files under the config folder of every Claude Code provider the board
  has configured; the folder itself stays writable, since Claude Code keeps its sessions there;
- every Codex provider's `CODEX_HOME` and shadow home, whole, as `~/.codex` is;
- the board's `queue-config.json`, where a scheduled job may turn the sandbox off;
- the `.git/hooks` and `.git/config` of the step's own main checkouts and of every checkout under
  `~/.aide/dashboard/checkouts`, and each of those checkouts' `settings.yaml`, which holds the project's test command.

A step therefore cannot install anything onto the serving host; `AIDE_INSTALL_CMD` does that after a landing.

Three more things keep what a step writes from reaching the runner's own work outside the sandbox, for every tool:

- a scheduled job's prompt is read as committed in the checkout, never from the file on disk;
- each worktree's `.git` file and its git directory's `commondir` and `gitdir` files are recorded when the worktree is
  cut and put back after every turn, and the runner's own git passes the recorded git directory (`--git-dir`,
  `--work-tree`);
- the runner's and the landing's own git run no hooks (`-c core.hooksPath=/dev/null`). What the runner starts itself,
  the AI tool and the project's tests, runs git with its hooks as usual.

Everything else is reachable:

- shell commands may write anywhere else in the home directory and in the temporary directories;
- the step's own worktree and its spec's worktree in the specs repository are writable, and so is the main checkout's
  git directory they point into;
- the network is open, and a command may start a server on localhost and reach it.

The sandbox confines shell commands only. Claude's file tools follow permission rules instead, so the runner passes the
same paths as `Read(...)` and `Edit(...)` deny rules, which win over the user's own global `allow` of `Edit` and
`Write`. A command cannot ask to run outside the sandbox, and a step whose sandbox cannot start stops instead of
running its commands unconfined.

**A browser cannot start in the sandbox.** Chromium registers a macOS service the sandbox has no setting for. A Claude
step is told so in its prompt and does not run browser tests itself; the runner's own test run, outside the sandbox,
runs them before the work can land. A scheduled job whose own commands start a browser runs without the sandbox: its
entry's Sandbox is set to Off on its Settings tab (`"sandbox": false`, `aide-run-spec --no-sandbox`).

**The runner's own test run executes what the step wrote, outside the sandbox.** An `implement` step's tests, a
landing's tests and every hook git runs for them run with everything the user can reach, the denied paths included. A
step talked into writing a test that reads a key gets that key read when the runner runs the suite; the step itself
never sees the output of a passing run, but the test can send what it read over the open network. Only a container
per run (`docs/ROADMAP.md`, idea 18b) closes this.

**A Codex step and an OpenCode step run without it.** Codex's sandbox can confine writing but not reading, and `git`
in a worktree fails under `workspace-write`, because the worktree's git directory lies in the main checkout. OpenCode
has no sandbox of its own. `docs/AI_SUPPORT_MATRIX.md` has the versions this was checked against.

The runner's own commit, push and landing run outside the sandbox.

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
  branch. Otherwise the step ends `no-progress` and the line is not extended. After that check:
  - **A review.** A second, fresh session reads the spec's description and the branch's diff and looks for defects
    against the description, each with the concrete case it goes wrong for (`run-spec/turn/review.sh`). It never
    comments on style, naming or structure, except that a description with an `## Out of scope` section makes each
    change under an item in it a defect too. It runs on the queue config's `model.review`, else the step's own
    model, read-only, on the step's tool or on Codex (`run-spec/turn/side-turn.sh`); a review on Codex that does not
    complete is done again by the step's own model.
  - **A verification**, when `model.verify` names a model: a third fresh session keeps or drops each defect after
    tracing it in the code. One that does not complete keeps them all.
  - **A fix turn.** The defects that are kept go back to the ORIGINAL implement session as one follow-up turn, which
    fixes them or turns one down on a `not a defect: <number>. <why>` line. The review itself is best-effort: a
    verdict it cannot parse, or a turn that does not complete, counts as "found nothing" and is logged as an error.
  - **A green test run the runner made itself** (`run-spec/turn/step-tests.sh`), which always follows. Red goes back
    to the same session as a follow-up turn, at most `AIDE_TEST_FIX_ROUNDS` (2) more rounds within the step's time
    limit. Each red run's failing tests are read from its output (`run-spec/turn/failing-tests.sh`: Playwright,
    vitest, bun, pytest and turbo, without colour codes, never pnpm's error box or the recorder's JSON line), and a
    fix round's prompt names them; the log's own failing lines go only when no test is named, or no name carries a
    file. Still red ends the step `tests-red` with the failing lines as its detail and the named tests in the result's
    `testsRed`: at most eight, the failed and total counts when the output printed them, `touched` (a failing test's
    file is among the files the change touched, committed or not, matched by the end of its path), `untouched` (how
    many are not) and `variedBetweenRuns` (a run failed a test the run before it did not). The board's sentence names
    the tests and says the fault is likely in the change, or, when none is in a touched file or the runs varied, that
    it points to unstable tests or a busy machine. Implement is the button to press again. A run that never started, because its server could not start or a port it needs is held
    (`run-spec/turn/test-start.sh`), goes back to no session: it ends `tests-not-started` at once, with the cause and,
    for a port, the spec or process holding it in the result's `testsNotStarted`. A run `aide-record-test-run` did not
    make ends the same way at once, read from the recorder's own result and never from its exit code alone: the spec's
    folder not found on the spec's branch (`spec-folder-missing`), or the recorder refusing or ending without a result
    (`recorder-failed`, with its own words). A project without `AIDE_TEST_CMD` passes. A record the session wrote through `aide-record-test-run`
    on exactly the delivered tree, green and naming the same commands, is accepted as that run.
- `archive` runs no suite of its own, merged with main or not: its landing runs the project's tests once, on
  exactly what the default branch is about to become, and that is the one run an archive gets
  ([Branches and landing](landing.md#the-tests-run-on-the-landing-once)).
- `archive` counts only if the folder is under `archive/` afterwards. A folder that stayed put because
  `aide-archive-spec` refused (`not-implemented-yet`, `acceptance-criteria-unticked`) ends as that refusal, the same
  as when the refusal came before the session; otherwise `no-progress`. An archive handed a merge with the default
  branch OPEN (`update_branch_to_base`) counts only if the branch contains that base tip afterwards — a session
  that aborted the merge and still moved the folder ends `merge-unfinished`, since the landing would meet the same
  conflict again.
- `implement` handed a merge with the default branch open counts by the same test: a session that dropped the merge
  and did its work on the old base ends `merge-unfinished`.
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

The marks the model writes itself are dated while it works: the wait loop of `run_model_turn` reads the transcript's new
bytes each poll (`model_marks_record`, `run-spec/turn/model-marks.sh`) and prints each mark into the run log with the
run's clock. The three tools share no clock, so the time is the moment the runner first sees the line, at most 0.2
seconds late. The page shows the model's own line with that time in front and drops the recorded copy, so a mark is one
line of the Log. A run from before has no recorded marks, and its model steps show a dash for time.

A `schedule` step's prompt is the prompt file's text, then a request to split the work into a few named steps and mark
each one with the same lines (`schedule_step_note`, `run-spec/setup/invocation.sh`). The marks it writes are the steps
the job's row on the Running page unfolds into.

Every physical line is its own line. Only the `error: ` prefix marks an error and only the turn line marks a turn:
the transcript is cut at each turn's byte, and Aide's lines go between the turns. The script writes one `error:` line
for the step's own failure before its result line, and one for a refused run.

**What the two reviews found** is written in the `tests and commit` part. A completed analyze gets one line, read from
the `**Findings:**` line that opens the plan's Plan review section (`plan_review_line`, `run-spec/turn/review.sh`), or
a line saying the plan has no Plan review section or the section gives no counts. An implement's code review writes
`the review found no defects` or an `error:` line with the count, one `review: <line>` per line of the reviewer's list,
one `the verification dropped review: …` per defect a verification dropped, `the defect(s) went back to the implement
session to be fixed`, and one `the implement session found it not a defect: …` per defect the session turned down.

**Let AI formulate acceptance criteria.** A completed create records `yes` or `no` (`--no-ai-formulate`) as the `Let AI
formulate acceptance criteria:` line in the new spec's Tracking info. The board reads it for the spec's banner; a spec
without the line is read as `yes`.

**Let me choose the approach.** The New spec form's box is passed to `create` as `--choose-approach yes|no` and recorded
as the `Let me choose the approach:` line. Analyze reads it (`aide_spec_choose_approach`); with `yes` the prompt asks
the skill to mark each approach `(recommended)`, `(real alternative)` or `(considered and rejected)`.
`core/tests/fixtures/choose-approach-line.json` is the table the runner and the dashboard both read the line against.

**The acceptance criteria checks.** The level (`off`, `warn` or `stop`) is chosen on the New spec form, passed to
`create` as `--criteria-checks` and recorded as the `Acceptance criteria checks:` line. Analyze states it in the prompt;
a spec without the line is read as `off`. At `stop`, a completed analyze whose Plan review `**Criteria check:**` line
names a fault after ` — ` ends `acceptance-criteria` (`run-spec/record/criteria-check.sh`, after the scope guard): `ok`
false, the commit subject ending `(stopped: acceptance-criteria)`, the error naming each fault, and the result's
`criteriaFaults` sorting them into `missing`, `notEars`, `noScenario`, `contradictions` (each an `AC-a/AC-b` pair) and
`cannotBuild`. The runner reads the line and never judges the criteria itself. `none found`, or no line, completes the
step.

**The shared files check.** The analyze skill compares the files its analysis will change with those of every other
open spec in the project that is analyzed or implemented and not archived, with `aide-spec-overlap`, and stops before
the plan when one shares a file. A Markdown file never counts. After the turn (`run-spec/record/shared-files-check.sh`)
the runner runs the command with `--record`, which writes the specs found into the analysis's `### Overlapping specs`.
A spec that is new in that list ends the step `shared-files`: `ok` false, the error naming each spec with its files,
and the result's `sharedFiles` (`[{ "spec": "<folder>", "files": [...] }]`). A spec already in the list does not stop
the next Analyze. When `aide-spec-overlap` is not installed, the check is skipped.

**The short analysis check.** A small spec may get a short analysis: the files to change and where the tests sit, with
no plan and no plan review. The limits and the grade are the `SHORT_ANALYSIS_*` constants in
`run-spec/setup/arguments.sh`, with no per-project or environment override. For a spec that does not ask to choose the
approach, the analyze prompt says `A short analysis is allowed for this spec`; any other spec gets the full analysis.
After the turn (`run-spec/record/short-analysis-check.sh`) the runner reads `Analysis:`, `Grade:` and the acceptance
criteria count, and counts the source files under `### Files to change` (a test or a Markdown file is not counted).
Every completed analyze is logged as `short analysis: <short|full> — grade <g>, <n> acceptance criteria, <m> files to
change, <s> of them source files`. A short one over a limit, with no grade or no files recorded, or on a spec that asks
to choose the approach, ends `short-analysis-over-limit`: `ok` false, the error naming each limit crossed. The runner
writes `- **Sent back to a full analysis:** …` into the description (`record_sent_back`), unless it already carries
the line, and the board queues Analyze and the steps the stopped job had not run, once per spec
([Running specs](running-specs.md)). A spec whose description carries that line is never offered a short analysis.
`core/tests/fixtures/analysis-line.json` holds the `Analysis:` cases the runner and the board both read.

**The sent-back check.** Every implement prompt names a file in the run's work directory, `sent-back`, where the session
writes one sentence if the spec's analysis is short and the change is not small after all. After the turn
(`run-spec/record/sent-back-check.sh`) a non-empty file decides the step. The sentence is joined to one line, stripped of
backticks and cut to 300 characters. When `2-analysis.md` reads `Analysis: short` and the description has a `Created:`
line, `record_sent_back` writes `- **Sent back to a full analysis:** <sentence>` into the description and the step ends
`sent-back`: `ok` false, the commit subject ending `(stopped: sent-back)`. Otherwise the description is left as it was
and the step ends `sent-back-refused`, failed. A missing or empty file changes nothing.
`core/tests/fixtures/sent-back-line.json` holds the line's cases.

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
