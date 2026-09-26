# Running specs

How a spec becomes a run: the form that makes one, who the dashboard answers, what decides a step's time limit, AI
and model, how many run at once, and what it tells you while they do.

Six pages sit beside this one:

- [The runner and its checkouts](the-runner.md) — what a run does to the repositories it touches
- [A spec's lifecycle](spec-lifecycle.md) — the four phases, and what moves a spec between them
- [A job's states](job-states.md) — the job's state machine, in one place
- [The specs list and the spec page](the-specs-list.md) — what a row says, and what its controls do
- [Projects](projects.md) — adding one, and whether a run can start there
- [Branches and landing](landing.md) — how each step's branch is merged, and what stops one from landing

## Table of contents

- [Making a spec from the page](#making-a-spec-from-the-page)
- [Which requests the dashboard answers](#which-requests-the-dashboard-answers)
- [The queue config](#the-queue-config)
- [Which AI runs a step](#which-ai-runs-a-step)
- [How the board finds a CLI](#how-the-board-finds-a-cli)
- [Which effort level a step runs at](#which-effort-level-a-step-runs-at)
- [Global defaults for the AI and model](#global-defaults-for-the-ai-and-model)
- [Running a job on a schedule](#running-a-job-on-a-schedule)
- [How many run at once](#how-many-run-at-once)
- [Notifications](#notifications)
    - [Push notifications on a phone or laptop](#push-notifications-on-a-phone-or-laptop)
- [Live runs](#live-runs)

---

The spec list runs Aide's workflow steps headless on this machine: each step is a
`claude -p "/aide-<step> <spec>"` process started by Aide's `aide-run-spec`. A job is an ordered list of steps; a
step that ends either advances the job or ends it, and several jobs run at once — see
[How many run at once](#how-many-run-at-once).

## Making a spec from the page

Every active spec is a row on the list, and every row can be run. A spec that does not exist yet has no row, so
above the table there is a **New** button — a plain link to `/new`. That page is the form and nothing
else: a project, a **Depends on** field naming a spec this one has to wait for, a title, a description, a phase table,
and two buttons, Create and Cancel. Create posts to `POST /api/queue/create` and returns to the list; Cancel returns having done nothing. A refused
submission comes back to `/new?error=…`, where what was typed can be corrected.

**The new spec is not on the list when you get back.** The `create` step has to run first, and its folder has to
reach the default branch, which the landing does — see below. Until then the job is on the list as a queued
create, under a provisional name. The browser holds Create at an empty project, title or description, and the
server refuses a request with no project as well.

The phase table has one row per phase — create, analyze, implement, archive — each with a tick, an AI choice and a
model choice, drawn by the same pickers the spec's row on the list uses. `create`'s tick is always on and cannot be
turned off; the other three are on by default, so a form submitted without touching them queues all four phases in
order, guarded and timed like any other job. Unticking a box before pressing Create is how a `create`-only job is
queued. What was ticked here is recorded against the spec this job makes, and is what the row's own phase boxes
show once the spec has a row — see
[What is ticked, and why](the-specs-list.md#what-is-ticked-and-why).

Two things about the form are worth knowing:

- **The project list is the raw allowlist** — `queue-config.json`'s `projects`, seeded from `QUEUE_PROJECTS` — not
  the projects the server has found specs for. Every other control on the page is about a spec that exists; this
  one is about a project whose FIRST spec may not, and such a project appears in no other list here.
  `/api/queue` is unchanged and still refuses a project with no discovered spec.
- **Nothing here names the spec.** The job carries a provisional key (`new-abc123de`) which names its branch, its
  worktree and its folder on disk — the `create` step writes the spec's files under that literal name, choosing no
  number and no slug. `aide-run-spec` reports that same folder as `specFolder` in its result.

**The number and the slug are assigned when the branch lands, not when the folder is written.** Landing is the
merge of a step's branch into the repository's default branch, which the dashboard does itself once the step
succeeds ([Branches and landing](landing.md) has it in full). For a `create` it does this: under the specs repo's own merge lock — the one point where two landings for the same repo are
already serialized — it counts the folders already there, takes the next number, and renames the provisional folder
to it before the merge is pushed. The list shows what is on disk in the main checkout,
which every run keeps on its default branch, so a created spec that only ever reached a branch would appear
nowhere. A job that ticked further phases runs its next step under the real folder name. A landing that fails
leaves the provisional name in place and says which repo and why. Two `create` jobs for one project can start in
the same scheduler pass: there is no number for them to collide over.

A landing merges in a worktree of its own and touches the shared checkout for one fast-forward at the end, so it
holds back two things and nothing else: the job being landed, and a second `archive` in the same project.

**The list holds specs, not the machine's whole run history.** An archived spec stays on the list as a row under the
default **All** filter, and **Active** leaves it out. Nothing is destroyed — `/api/queue` still returns every job and `/specs/<id>` still renders each one. A project whose specs the server cannot read this time keeps the rows it
already had: an empty answer means "we cannot tell", never "everything here is archived".

A job survives a restart: the runner spawns detached in its own process group, and the result file is the
contract — the scheduler polls the pid and the file, and a job left `running` is reconciled from both. A step that
hits its own time limit is `stopped`, not `failed`. [A job's states](job-states.md) has both in full.

## Which requests the dashboard answers

The dashboard asks for no sign-in. It refuses requests from other sites instead, with one check in front of every
route — every page, the `/api/queue` actions and `POST /api/aide-run` included:

- **The `Host` must be one of its own names:** `localhost`, `127.0.0.1`, `[::1]`, the machine's own Tailscale name when it has
  one, and any name listed in `allowedHosts` in `queue-config.json`. The port is ignored, since the test boards
  answer on their own ports, 8801 to 8806. Anything else answers 403 with the refused host in the body, so a page cannot reach the
  dashboard through a DNS name of its own.
- **A request that changes something must come from the dashboard's own address.** That is any method but GET, HEAD
  and OPTIONS, and the one GET that starts a test board (`?startTestServer=1`). Its `Origin`, when it has one, must
  equal its own `Host` (host and port; the scheme is ignored, because a proxy in front of it ends TLS), and its
  `Sec-Fetch-Site`, when it has one, must be `same-origin` or `none`. A page on another site, or on another port of
  the same machine, answers 403.
- **A header that is absent passes.** `curl`, the run emitter and the round script send no `Origin`, so they are
  admitted.

The Tailscale name is written to the log once, when it is found, so the serving host's log says which address
works from another device. `headerAuth` in `queue-config.json` is still read, and refused unless the server binds loopback; it
admits nobody the rule above does not.

**The rule stops web pages, not another machine.** `Host`, `Origin` and `Sec-Fetch-Site` are set by whoever sends the
request, so a machine that can reach the port and sends `Host: localhost` is admitted. Bind loopback
(`--bind 127.0.0.1`), which the install does by default.

## The queue config

One file (`--queue-config`) holds the time limit, the permission mode, the model, the push mode, how many jobs run
at once, the project allowlist and the notify command. A wrong value costs a config edit and a restart. The time
limit is checked BEFORE a step starts — a cap that only stops a step afterwards is a report, not a cap:

```json
{
  "timeoutSec": {
    "implement": 5400,
    "analyze": 2400,
    "default": 1200
  },
  "permissionMode": {
    "implement": "bypassPermissions",
    "default": "acceptEdits"
  },
  "model": {
    "implement": "opus",
    "default": "sonnet"
  },
  "push": "branch",
  "concurrency": 2,
  "projects": [
    "aide",
    "<another-project>"
  ],
  "notifyCommand": [
    "/Users/<you>/aide-dashboard/notify-slack.sh"
  ]
}
```

A job may only TIGHTEN the timeout, and cannot set the permission mode at all. A timed-out step reports its cost as
unmeasured, never assumed: a SIGKILLed run prints no usage, so the figure is `0`, and the step's own phase file
records `(unmeasured)` beside it rather than a guessed number standing in for one.

`timeoutSec` is a table per step, read the same way `permissionMode` and
`model` below are: a step the table does not name falls to `default`. It is per step because a plain `analyze` is
minutes and an `implement` on a twenty-file change is the better part of an hour, and one number for both stops a step
with its tests already green. `analyze` carries a longer-than-default ceiling of its own — 2400s — because the
three-reviewer-perspective routine runs inside it. A tightening
override is checked against each step's OWN ceiling, so a job holding both steps cannot buy `analyze` more time by
naming `implement`. A file still carrying the old flat `"timeoutSec": 1200` is ignored and the built-in defaults stand.

`projects` is the odd one out in that file: it is the only key the server WRITES as well as reads. It is the queue's
allowlist, and the Add and Remove buttons on `/projects` rewrite it — which is what makes those take
effect without a restart. The
`--queue-projects` flag is the seed for a first install where this file does not exist yet; where the file HAS a
`projects` array, it wins over the flag. A malformed one is ignored entirely and the flag is kept, the same direction
every other key here fails in.

## Which AI runs a step

Every step runs on Claude Code unless a `modelChoices` entry says otherwise. That table is what the per-phase model
picker offers, and each entry may name a `tool` and a `model` of its own:

```json
{
  "modelChoices": {
    "Sonnet": {
      "model": "sonnet"
    },
    "Opus": {
      "model": "opus"
    },
    "gpt-5.6-luna": {
      "tool": "codex",
      "model": "gpt-5.6-luna"
    },
    "gemini-3.1-pro": {
      "tool": "opencode",
      "model": "opencode/gemini-3.1-pro"
    }
  }
}
```

`tool` is `claude` (the default, and what an entry that says nothing means), `codex` or `opencode`. `model` is the
literal value handed to the CLI when it differs from the entry's own key — the key is what the picker shows and what a request posts,
so the key can be the name the tool itself shows for the model — `Sonnet`, `Opus`, `Fable` as Claude Code names them,
`gpt-5.6-sol` and the rest exactly as Codex's own picker lists them. No entry carries a `(codex)` suffix in the
dropdown: each option sits under a group named after its tool, which says it while the list is open.

**An OpenCode model carries its provider.** OpenCode brings no model of its own: every model belongs to a provider and
is named `provider/model`, so that whole string is what `model` holds — `opencode/gemini-3.1-pro`, not
`gemini-3.1-pro`. The key beside it is still just what the picker shows. Nothing OpenCode offers is reachable until a
provider is logged in (`opencode providers login`); the Settings page's own OpenCode tab answers whether one is, and
whether every model configured here still appears in that provider's list.

**The tool is a choice per PHASE, not per row.** Every phase's dropdown lists every configured model, grouped
in an
`<optgroup>` per CLI — `Claude Code` first, then `Codex`, and a tool with nothing configured draws no group at all.
Nothing is hidden and nothing is filtered, so a row can run analyze on one CLI and implement on another; the runner
allows exactly that, reading
`job.model[step]` for each step on its own and deriving both `--model`
and `--tool` from that one entry (`runnerArgv`, `src/serve/serve-helpers/runner-argv.ts`). There is no row-wide AI select: one that filtered the
other tool's models out of all five phase selects is what would keep anyone from discovering the per-phase choice.

**Every phase line has an AI picker beside its model picker.** In the column between the phase's name and its
model, on every line. Picking an AI fills in the model for THAT phase, and no other. The caption names the two columns
separately, `AI`
and `Model`.

Which model an AI fills in is worked out by the server and carried on the option: the step's own `model` default when
that default belongs to the tool, else the first entry `modelChoices` lists for it. The browser copies the value and
never chooses between a tool's models itself.

The AI picker itself POSTS NOTHING — it carries no `name`, and a press still sends the same five
`model.<step>` fields. What a phase runs on stays one value on the job and the tool is derived from it, so
the picker is read on change (to fill the model in) and written on redraw (to reflect it), never the reverse. Change a
model select by hand and the AI select beside it follows at once. Picking it — or moving a model select by hand — does
reach the server at once, though: the model select it fills is recorded the instant it changes, on a phase that has not
run yet as much as on one that has (see "A model picked for a phase" below). It is drawn whenever ANY tool has a
model configured, one included: a lone entry is a statement rather than a choice, and hiding it left the row's first
select holding a model under a heading a reader takes for the AI. Only a server with no model choices at all draws no
picker.

There is no `Set all…` control: a deployment with one tool and several models of it has no
one-action way to set every phase at once, and each phase's model select is changed on its own line.

The pre-filled model for a phase with no run behind it, no recorded pick and no `model`
default of its own is the first entry `modelChoices` lists. A phase that HAS run shows the model it ran on, which wins
over everything else; beneath that, a recorded pick (see below) wins over the per-step `model` default, which wins over
the first-entry fallback.

**A model picked for a phase survives leaving the page.** The instant a reader picks a model or an AI for a phase that
has not run yet, the dashboard records the pick — per spec, per phase — rather than holding it only in the open tab.
Reloading the page, opening the spec in a different browser, or coming back another day all show the recorded pick, and
a run started afterwards uses it. A phase that has since actually run shows what it ran on instead: a record of what
happened outranks an earlier choice about what was to come.

While a job runs, a pick for a phase the job can still take is written to that job, and the line shows the job's own
pick. A phase the job was not queued with is recorded for the spec as well, so the pick outlives the job and the next
run of that phase uses it.

The queue, the worktrees, the wall-clock timeout and all the git handling are one path for both tools — **the wall
clock (`timeoutSec`) is the only thing that stops a runaway step**, for either tool, and it is mandatory for every
step either way. One thing differs, and it is visible on the page rather than papered over:

- **A Codex step reports tokens, never dollars.** No dollar figure exists anywhere in Codex's output, so the Cost column
  shows the token count and a dash where the money would be — never `$0.00`, which would add up as though the step had
  been free. A job mixing both tools has a
  `spentUsd` covering its Claude steps only.

The job page's Logs tab works for both: the run's transcript is parsed in whichever schema wrote it.

Safety modes are stored the same way for both — the queue keeps Claude's own names, per step, config-only.
`aide-run-spec` translates them for Codex: `bypassPermissions` becomes
`--dangerously-bypass-approvals-and-sandbox`, `acceptEdits` becomes
`--sandbox workspace-write`, and `plan`/`default` become `--sandbox
read-only`. A mode with no entry in that table refuses the run rather than being guessed at. (`codex exec` is
non-interactive and has no
`--ask-for-approval` flag at all — that one belongs to the interactive command — so the sandbox mode is the whole of
what there is to say.)

## How the board finds a CLI

A skill like `/aide-analyze` runs INSIDE a CLI you started yourself, so it inherits your shell's `PATH` and everything
on it. The board is the other way round: it STARTS the CLI, from outside, as a launchd job. launchd hands that job a
short `PATH` that carries neither `~/.local/bin` — where the installer puts aide's own scripts, and where Claude Code
itself lives — nor mise's shims, which is the only place Codex, Copilot and OpenCode can be found on a machine that
installed them through mise.

So the board puts those two directories back in front of whatever `PATH` it was given, before it spawns anything:
`pathWithToolDirs` in `src/serve/tool-path.ts`, used both by a step's own spawn and by the Settings page's tool
checks. A directory that does not exist is not added, and a directory already on the `PATH` is left where it is.

One function rather than one per caller, because the failure the two-copy version produced is silent and confusing: a
check reporting a CLI as missing while every real run found it.

`AIDE_CLAUDE_BIN`, `AIDE_CODEX_BIN` and `AIDE_OPENCODE_BIN` point a run at a particular binary instead, and win
over the `PATH` search entirely. All three are read from the environment; `AIDE_CLAUDE_BIN` alone is also read from
the project's `.aide/config`, which is how a project points its runs at a stand-in binary. A value written there
for either of the other two does nothing.

The tool checks run when the board starts, when Check is pressed, and again for the tool a queued job's next step
will run on — at most once a minute per tool — before the runner looks at the queue. A check that finds something
wrong puts a line at the top of every page, but only for a tool some model is configured for, and says what is wrong
rather than which question found it. A Claude Code login that names one account with an organization plan it cannot
have is reported as the login in use being another account's: `claude auth status` reads the address from one file
and the plan from the stored login, and on macOS a login left in the keychain outlives a `claude auth login` that
wrote a new one to the file. All of this happens only on a board started with `checkToolsOnStart`; a server nobody
asked to check anything never spawns a CLI to do it.

## Which effort level a step runs at

A step runs at the effort level its own job request named, and at no level at all when it named none — there is no
default to fall back to and no whole-job pick. Nothing on the board sets one: the specs list draws no Effort
control, deliberately (`specs-list/phase-rows.ts`, "the effort a step runs at is a configuration answer, not a
per-row pick"), so a level reaches a job through `POST /api/queue` and nowhere else. `resolveStepEffort` reads
`job.effort[step]` and nothing else.

The levels are `low`, `medium`, `high`, `xhigh` and `max` — the reasoning-effort levels Claude Code's `--effort`
flag accepts, listed in `core/scripts/lib/effort-levels.json`. `ultracode` is deliberately not among them: it is a
Claude-Code-specific setting that turns on multi-agent orchestration on top of `xhigh` reasoning, not a plain
effort level, and a routine step must not be able to opt into a much larger run by naming one.

The level reaches `aide-run-spec` as `--effort <level>`, appended to the `claude -p` invocation only. Codex and
OpenCode have no equivalent flag, and a level chosen for a step that runs on either is accepted and silently
dropped — the same "ignored, not refused" treatment the script gives Codex's other Claude-only knobs. The level a
step actually ran at is recorded in that step's own phase file, as a `- **Effort:**` line beside `- **Model:**`,
and shown on the job's own detail page beside its Model row.

## Global defaults for the AI and model

`/settings` holds the default AI and model per step. It has ten rows: the six that act on a spec — Create,
Analyze, Implement, Archive, Close and Reopen — then Manifest, Schedule and Wiki, which do not, and Default, which every
step without a row of its own falls back to. `explore` is deliberately left out: it has no button, no row action
and no place in Schedule, so a model set for it could not be used. Beside the models the page holds a `timeoutSec`
table, in minutes. Saving posts to `POST /api/queue/settings`, which validates every model name against
`modelChoices`,
updates `queue-config.json` atomically while retaining comments and unrelated values, and changes the live defaults
only after the write succeeds. Later jobs use them immediately; jobs already accepted keep their stored choices.

## Running a job on a schedule

The serving host keeps each project's recurring work — a periodic analysis or report — in its own `queue-config.json`,
under a `schedules` key keyed by project name:

```json
{
  "schedules": {
    "aide": [
      { "name": "nightly-report", "cron": "0 3 * * *", "prompt": "docs/nightly-report.md", "model": "claude-opus-5" }
    ]
  }
}
```

An entry may also carry `"notify": "never" | "failure" | "always"`, set on its New-job and Edit forms and read as
`failure` when absent (see [Push notifications](#push-notifications-on-a-phone-or-laptop)).

A fresh install has no scheduled jobs, whatever the projects it serves contain. A project's own files never carry a
schedule; a job belongs to the installation that fires it.

Each entry is a name (becomes the job's `schedule-<name>` tracking key, never a spec folder), a standard five-field cron
expression, and a prompt file's path, relative to the project's own root. A background poll checks every project's
entries and enqueues a `schedule` step through the same queue, runner and worktree machinery every other step uses
whenever an entry is due and nothing is already queued or running for it.

**A scheduled job produces a report and never changes a repository.** It may read the project; a change that should
reach the repository goes through a spec. A job that commits anyway ends as failed, its commit is discarded and no
branch of it is left locally or on origin. The New and Edit forms say so.

`/schedule` lists every allowed project's entries, flattened into one list (`?q=`, `?sort=` and `?dir=` filter and
sort it); `/schedule/new` makes an entry and `/schedule/<project>/<name>` is one entry's own page (Overview and
History tabs), with `/schedule/<project>/<name>/delete` its delete confirmation. The pages post to
`POST /api/queue/schedule` (create), `POST /api/queue/schedule/<project>/<name>` (edit), and
`POST .../enabled`, `.../run` and `.../delete` (toggle, fire now, remove); `GET /api/queue/schedule/cron-next`
previews a cron expression's next fire time for the form.

**A run's report.** Each `schedule` run writes into a directory of its own,
`<output root>/<project>/<key>/runs/<jobId>/`, named in `AIDE_SCHEDULE_OUTPUT_DIR` and made before the run starts.
The run's report is its `index.html` there; a missing file, an empty one, whitespace or tags with no text and no
`<img>` count as no report. The top of an entry's Overview tab shows the newest run's report in a sandboxed frame
(`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, so nothing in a report runs and its links
open in a new tab), headed by the run's start time and outcome. A History row opens the same page with that run's
report (`?run=<jobId>`, matched against the entry's own jobs and never used as a path; an unknown value shows the
newest run). A run that wrote no report shows a sentence with how it ended, and an entry that has not run says so. The
report's own styling, scripts and event attributes are removed and the board's tokens put in their place; the frame
follows the page's Dark/Light/Auto choice through `specs-client/report-frame.ts`. The file on its own is served under
`/schedule-output/<project>/<key>/runs/<jobId>/index.html`.

`model:` is which of the queue's own `modelChoices` every fire of that entry runs on — one name for the whole entry,
since a scheduled job is a single `schedule` step and has no phases to tell apart. It is picked on the New-job and Edit
forms the same way a spec's model is picked on the Specs page, with the AI beside it deriving from it; a name the queue
config does not grant is refused at the form rather than at 03:00. A name that differs from a listed one only in
upper and lower case is matched to the listed spelling and stored as that (in a job request, a per-step or pending
pick, a tail-model edit, the Settings save and this form alike); a name matching several listed spellings that differ
only in case is refused, naming them. An entry that names no model is enqueued without one
and the queue config's own `schedule` default decides. "Run now"
reads the same field, so pressing it tests what the schedule actually does.

An entry whose model the queue config does not offer (the config file was edited by hand, or the queue config changed) is
flagged in its Name cell on `/schedule` and above the Overview on its own page, naming the model and the ones the queue
offers. Its runs are refused: Run now writes the queue's reason into the message slot above the list (`Run now was
refused for <project>:<entry>: …`, or in `?error=` for a press made without script) and logs `queue: run now refused for
<project>/<entry> — <reason>`; the timer logs `queue: scheduled fire refused for <project>/<entry> — <reason>` once per
fire window and reason, not once per tick. The step sends the named file's contents to the model verbatim, with no Aide skill or spec folder
involved at all; write it the way you would write a prompt by hand.

**Due is computed from the most recent fire time alone — there is no backfill.** If the dashboard is down across a whole
scheduled window, that occurrence simply does not happen; nothing catches up retroactively the next time the poll runs.
A project's own page shows each entry's name, cron expression, prompt path and next computed fire time, and the projects
overview names the soonest across a project's entries.

**An entry saved from the New or Edit form records a `since` timestamp**, the time of that save. Any fire at or before
`since` counts as already used, the same way a tracked job does — so a freshly created or freshly edited entry's first
real run is its next fire after the save, not whatever the cron's most recent fire already was. An entry with no
`since` — one written by hand, for instance — fires on its very first eligible window. A window whose fire the queue refused made no job, so it is still due: an entry with no
`since` fires for it once the cause is fixed, an entry saved from a form does not.

**A cron expression is evaluated in the SERVING HOST's local timezone**, the same as an ordinary crontab — there is no
`tz:` field. Check what
"3am" means on the machine actually running the poll before relying on it across a daylight-saving transition.

**Where jobs are stored.** Creating, editing, enabling/disabling or deleting an entry through `/schedule`'s own forms
writes the `schedules` key of the file named by `--queue-config` and commits nothing. The rest of the file, comments
included, is left as it was. The file is read again on every poll and every page, so a hand edit takes effect at the next
poll. A save is refused, with the reason on the page and the file untouched, when the server has no `--queue-config` file
or the file is not valid JSON. While the file cannot be read the poll logs it once and starts no scheduled job. A
`prompt` path that would resolve outside the project root (an absolute path, or one whose `..` climbs past it) is dropped
when the file is read, and a malformed `cron` drops that one entry — never the whole list.

## How many run at once

`concurrency`, two by default. **1 to 8 is accepted and anything else — missing, non-numeric, out of range — falls
back to two**; it does not clamp, because `concurrency: 9` would otherwise have to be both 8 and 2 depending on
which rule you read. The upper bound is the only thing between a typo in this file and a host full of `claude`
sessions. The serving host runs six.

`1` runs one job at a time, so backing out of concurrent runs is a config edit and a restart.

Two jobs for the same spec are never started at the same time — analyze and implement for one spec are ordered by
nature. Nor are two `archive` steps in the same project: both land into the code root's main, and the second is held
`queued` with the reason on its row until the first has landed. Beyond that the jobs are genuinely independent: each `aide-run-spec` run works in `git
worktree` checkouts of its own, so the main checkouts never leave their default branch and no run can see another's.

## Notifications

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line of JSON on stdin (claude-usage's contract,
copied so one wrapper can serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a second later, and absent
unless configured. `deploy/notify-slack.sh` is the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`, or in the file `AIDE_SLACK_WEBHOOK_FILE` names
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
```

### Push notifications on a phone or laptop

The dashboard also sends a push notification to each device that turned them on, when a spec needs a person:

- a step **failed**, ran out of **time**, hit the AI's **usage limit**, or was **cut off** (its process vanished, or the
  server restarted under it) — the job entered `failed`, `stopped` or `interrupted`;
- a step finished and its merge into main **did not finish**, or its **tests went red** on the merge;
- an **archive is held back** on unticked acceptance criteria;
- a **create ends without a spec**: it failed, stopped, was interrupted, or its own merge failed.

Nothing is sent for a step that finishes normally, an archive that merges, or a job someone cancels. A create that is
still under way, including one whose merge is running, sends nothing until it is over.

A **scheduled job** notifies by its own choice, not by the rules above: when a run ends, the entry's `notify` says
whether to send. `never` sends nothing, `failure` sends when the run ended `failed`, `stopped` or `interrupted`, and
`always` sends for every run, including one that succeeded. An entry that names none is read as `failure`, so a job that
already exists notifies when a run does not succeed. A run someone cancels sends nothing whatever the choice, and neither
does a run whose entry has since been deleted or renamed. The choice is read when the run ends, so an edit made while it
runs applies to it. The title names the project and the job, the sentence says how the run ended, and a tap opens
`/schedule/<project>/<name>`, where the newest run's report stands.

A failed create names the project and the title it was given, says why in the device's own language (cut at 500
characters), and a tap opens New spec at `/new?retry=<job id>` with project, title and description filled in. The same
moment writes a message at the top of the Specs list; see [the specs list](the-specs-list.md#a-failed-create).

**Turning it on.** Settings, the Notifications tab, the switch. Pressing it subscribes or unsubscribes this device, and it moves only once the answer is in. The device asks for its own permission first. The setting
belongs to that device alone. On an iPhone or iPad it works only in the installed app, from iOS 16.4; a browser with no
push support says so beside a switch that stays off, and so does a site the browser blocks. A device whose owner withdrew the permission is removed the next
time the Notifications tab is opened, and one whose push service reports it gone (404 or 410) is removed at the next
send.

**What is sent.** A title with the project and the spec folder, one sentence in the language the device had chosen when
it turned notifications on (it keeps that language until it is turned off and on again), and the spec's page path, which
a tap opens (for a failed create: its title and reason, and New spec filled in). It leaves the machine as an encrypted message to the device's own push service (Google, Apple, Mozilla or
Microsoft) and is never in the clear there.

**What is kept.** Three files under `~/.aide/dashboard/`, neither in a repo:
`push-subscriptions.json` (one entry per device), `push-key.json` (the server's own key pair, mode 0600, made the
first time it is needed) and `failed-creates.json` (the creates that ended without a spec: project, title, description,
reason; a dismissed one stays for the newest 50 so an old notification still opens the form). If the key file is lost a new pair is made, and every device turns notifications on again.
The Slack `notifyCommand` above is separate and unchanged.

## Live runs

A spec's row shows a live indicator — session id, and (see below) liveness and cost so far — while an `/aide-*`
command is actually running against it. Two things feed that, and most people never have to touch either: the queue
side works with nothing configured.

**The queue's own runner is the producer for anything it queued itself.** When it spawns a step, it hands the child
`AIDE_RUN_URL` pointing at this server's own `POST /api/aide-run`, derived from the port it actually bound — so a
headless run's phases reach the row automatically. Without it, every phase report from a headless step would
exit silently and the row would sit at `phase: null`.

**A Claude Code `UserPromptSubmit` hook is the other producer, and it is a user's own, opt-in setting** — for
reporting an `/aide-*` command run BY HAND, in an interactive terminal, outside the queue entirely. `aide-emit-run`
(installed by Aide to `~/.local/bin`) POSTs one small event per slash-launched command — host, session id, command,
spec, project; never the prompt text. It is inert until `AIDE_RUN_URL` is set; an `AIDE_RUN_URL` already in the
server's own environment (the case above) is left alone, so pointing reporting at another sink still works. Aide's
`install.sh` prints the ready-to-paste block; it lives in `~/.claude/settings.json` as:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "AIDE_RUN_URL=\"http://127.0.0.1:8788/api/aide-run\" '/Users/<you>/.local/bin/aide-emit-run'"
          }
        ]
      }
    ]
  }
}
```

The address in that block is the loopback one; the `:8788` address answers on the serving host itself and nowhere
else.

**`GET /api/aide-runs` is these runs in flight, as JSON.** No page renders it directly: the spec list shows every
queued run per row, and interactive sessions are claude-usage's own page. Runs are kept in memory (LRU 512) and
mirrored to `~/.aide/dashboard/aide-runs.json` so restarts keep them.
