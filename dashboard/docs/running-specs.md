# Running specs

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
- [The Running tab](#the-running-tab)
- [Live runs](#live-runs)

---

How a spec becomes a run: the form that makes one, who the dashboard answers, what decides a step's time limit, AI
and model, how many run at once, and what it tells you while they do.

Seven pages sit beside this one:

- [The runner and its checkouts](the-runner.md) — what a run does to the repositories it touches
- [A spec's lifecycle](spec-lifecycle.md) — writing a spec, the four phases, and what stops one
- [How a spec moves between phases](spec-transitions.md) — how each move is decided and recorded
- [A job's states](job-states.md) — the job's state machine, in one place
- [The specs list and the spec page](the-specs-list.md) — what a row says, and what its controls do
- [Projects](projects.md) — adding one, and whether a run can start there
- [Branches and landing](landing.md) — how each step's branch is merged, and what stops one from landing


The spec list runs Aide's workflow steps headless on this machine: each step is a
`claude -p "/aide-<step> <spec>"` process started by Aide's `aide-run-spec`. A job is an ordered list of steps; a
step that ends either advances the job or ends it, and several jobs run at once — see
[How many run at once](#how-many-run-at-once).

## Making a spec from the page

Every active spec is a row on the list, and every row can be run. A spec that does not exist yet has no row, so
above the table there is a **New** button — a plain link to `/new`. That page is the form and nothing
else, on two tabs with Create above them. **Spec**, the tab it opens on, holds a project, a title, a description and
a **Depends on** field naming a spec this one has to wait for. **Options** (`/new?tab=options`) holds the acceptance
and approach settings, then the phase table. Switching tabs keeps what was typed, and Create posts both tabs from
either. Create posts to `POST /api/queue/create` and returns to the list; Cancel returns having done nothing. A refused
submission says why beside the form, where what was typed can be corrected.

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
holds back three things and nothing else: the job being landed, a second `archive` in the same project, and a wiki run
in it, which waits until the landing has merged.

**The list holds specs, not the machine's whole run history.** An archived spec stays on the list as a row under the
default **All** filter, and **Active** leaves it out. Nothing is destroyed — `/api/queue` still returns every job and `/jobs/<id>` still renders each one. A project whose specs the server cannot read this time keeps the rows it
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
    "implement": "opus"
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

`resumeAnalysis: true` lets an implement continue its analysis's own AI session, so it starts with what the analysis
read instead of reading it again. It applies only when both steps run with the same AI (Claude, Codex or OpenCode — the
model may differ) and the analysis ended within the hour; past that the tool's cache of the session is gone and reading it
back costs more than starting afresh. A session that cannot be continued starts the implement afresh. Off unless set.

The server WRITES some of that file's keys as well as reading them, each from one page: `projects` from the Add and
Remove buttons on `/projects`, `schedules` from a project's Schedule tab, and `model`, `timeoutSec`, `concurrency`
and `modelChoices` from Settings. A write keeps the file's comments and every other key. `projects` is the queue's allowlist, and
rewriting it is what makes Add and Remove take effect without a restart. The
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

**Each AI's tab has three tabs of its own: Models, Usage and Installation**, and opens on Models. Each has
its own **Check**, which reads what that tab shows and leaves the other two as they were, and each tab stamps the time
of its own last reading. The **(?)** in front of a Check says what that one reads for that AI. The address names the
open tab (`/settings?tab=claude&aitab=installation`), so a press of Check loads the same tab again. Like the
installation check, the usage and the models are read on a press and at no other time: not when the board starts,
not before a job, and not when a page is opened. The installation check alone also runs at start and before a waiting
job, which is what the notice at the top of every page reads; that notice links to the AI's Installation tab.

**The Usage tab shows how much of the AI's subscription is used**: each usage window with the share used, when
it starts over, and when it was read. Claude Code's comes from `claude -p /usage`, and Codex's from
`codex app-server`'s `account/rateLimits/read`; neither runs a model. When Claude's text has no line the board can read as a
window, the tab shows the text as it came. OpenCode reports no usage windows, and the board does not read Copilot's,
since its CLI has no command for it.

**The Installation tab shows what `aide-preflight` printed** — whether the command line is installed and which
version, where each piece of aide lands, and whether the installed files match the repository — every command the
check ran, and whether the AI is logged in, as one sentence: "Logged in with claude.ai as …", or "Not logged in — run
claude auth login" with the AI's own login command. Copilot's command line cannot say whether it is logged in, and
the tab says so.

**The Models tab lists the models under three headings.** "Currently supported by Aide" is every model choice of that
AI, the ones that can be picked on the board today. "Available" is the models the AI offers that are not choices,
each with Add. "No longer available" is the choices it no longer offers, each with Remove; such a choice can still be
picked until it is removed, so it is listed under both. Nothing is added or removed without a press, a model is added
only when the last Models Check read it, and a choice that is a step's default model is refused until another model
is picked for that step. Claude Code is asked one model at a time with `claude -p --model <m> "/model"`, which runs no
model: the four families `opus`, `sonnet`, `fable` and `haiku`, each with the version it gives today, and every Claude
choice. Of the choices, only a full id Claude Code names is offered: the other names it takes (`best`, `default`,
`opusplan`, the `[1m]` names) are asked only for the name their choice shows, and such a choice is listed as no longer
offered. A fixed Claude version, such as `claude-opus-4-8`, is a choice written into `queue-config.json` on the
serving host. Codex's models come from `codex debug models`, without the ones it marks hidden, and OpenCode's from
`opencode models`. The lists are gone after a restart until the next press.

**A Claude choice shows the version it gives** in every model picker and on the Claude tab. The model id it resolves
to is kept in `model-ids.json`, beside the queue's own file: a run records the id it ran on, and a press of the
Models tab's Check or an Add records the id Claude Code names, so the newest of them wins and a choice that never ran
shows its version too. Beside it, `model-names.json` keeps the name Claude Code gave the choice for that id, which is what the choice is
shown by while the id stands: `Opus 5.5 (1M context)` for `opus[1m]`, `Sonnet 3.5` for `claude-3-5-sonnet-20241022`. A
run that reports another id shows the name read from that id. A choice written into `queue-config.json` by hand shows
the bare name until the next press of the Models tab's Check.

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
`aide-run-spec` translates them for Codex:

- `bypassPermissions` — becomes `--dangerously-bypass-approvals-and-sandbox`.
- `acceptEdits` — becomes `--sandbox workspace-write`.
- `plan`/`default` — become `--sandbox read-only`.

A mode with no entry in that table refuses the run rather than being guessed at. (`codex exec` is
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
over the `PATH` search entirely. All three are read from the environment:

- `AIDE_CLAUDE_BIN` — the only one also read from the project's `.aide/config`, which is how a project points its runs
  at a stand-in binary.
- `AIDE_CODEX_BIN` and `AIDE_OPENCODE_BIN` — a value written in `.aide/config` for either of them does nothing.

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

`/settings` holds the default AI and model per step, on its AI tab under Models per phase. The table has eight rows:
the six that act on a spec — Create, Analyze, Implement, Archive, Close and Reopen — then Schedule and
Wiki, which do not. `explore` is deliberately left out: it has no button, no row action and no place in Schedule, so
a model set for it could not be used.

A step nothing has been saved for runs on Claude Code's Opus, and its row shows that. The built-in name `opus` is
matched to the host's own choices in any case, so a host that lists `Opus` runs and shows that choice. A
`model.default` in the config file, when present, is a saved choice for every step without one of its own, and is what
such a row shows. On a host whose choices hold no Opus, the row shows the first listed choice while the runner hands
`--model opus` to Claude Code. Beside the models the page holds a `timeoutSec`
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

An entry may also carry `"notify": "never" | "failure" | "always"`, set on its New-job page and Settings tab and read as
`failure` when absent (see [Push notifications](#push-notifications-on-a-phone-or-laptop)).

A fresh install has no scheduled jobs, whatever the projects it serves contain. A project's own files never carry a
schedule; a job belongs to the installation that fires it.

Each entry is:

- `name` — becomes the job's `schedule-<name>` tracking key, never a spec folder.
- `cron` — a standard five-field cron expression.
- `prompt` — a prompt file's path, relative to the project's own root.

A background poll checks every project's
entries and enqueues a `schedule` step through the same queue, runner and worktree machinery every other step uses
whenever an entry is due and nothing is already queued or running for it.

**A scheduled job may commit to the project repository and the specs root, the same two repositories a spec's step
reaches.** Its own report is written separately, to a directory of its own outside both (below) — a run that also
commits still writes it. Once the run ends, the board lands what it pushed the way an archive's own landing does: the
project repository's commit only once that repository's own test command is green on the merge, the specs root
directly. The New page and the Settings tab's Edit say what a scheduled job may commit to.

`/schedule` lists every allowed project's entries, flattened into one list (`?q=`, `?sort=` and `?dir=` filter and
sort it). It shows and links, and changes nothing: a click anywhere on a row opens the project's Schedule tab, whether
an entry is enabled is text there. The project's own Schedule tab lists its entries by Name, Next run, the Enabled
switch, Run now and Delete, with New above the list; a click on a row opens the entry's own page.
`/schedule/<project>/<name>` is one entry's own page, with two tabs: Report and Settings. Settings shows
every field of the entry — name, cron, prompt file, model and notify — with the Enabled switch, Run now and Delete;
Delete there goes to the project's Schedule tab once it has gone through. Edit on Settings (`?tab=settings&edit=1`)
draws the same fields as New as inputs on the tab, with Save and Cancel. New is a page of its own,
`/schedule/new?project=<project>`. A save goes back to the page it was opened from (a path on the board, sent with the
form as `back`; a rename moves a `back` on the entry's old page to its new one), and a refused save stays on the page
with the reason and what was typed. The pages post to:

- `POST /api/queue/schedule` — create.
- `POST /api/queue/schedule/<project>/<name>` — edit.
- `POST .../enabled` — toggle.
- `POST .../run` — fire now.
- `POST .../delete` — remove.

`GET /api/queue/schedule/cron-next` previews a cron expression's next fire time for the form.

**A run's report.** Each `schedule` run writes into a directory of its own,
`<output root>/<project>/<key>/runs/<jobId>/`, named in `AIDE_SCHEDULE_OUTPUT_DIR` and made before the run starts.
The run's report is its `index.html` there; a missing file, an empty one, whitespace or tags with no text and no
`<img>` count as no report. An entry's Report tab lists every run of the entry by Started, State and Duration,
newest first; a heading sorts the list through `?sort=` and `?dir=`, the way the `/schedule` list sorts. A click on a
run's row opens the same page with that run's report above the list (`?run=<jobId>`, matched against the entry's own
jobs and never used as a path; an unknown value shows the list alone), and the run being shown is marked in the list.
The report stands in a sandboxed frame (`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, so
nothing in a report runs and its links open in a new tab), headed by the run's outcome and how long ago it started,
with that run's proposed specs under it. A run that wrote no report shows a sentence with how it ended, and an entry
that has not run says so, with no list. The `/schedule` list's output link and a run's notification open that run's
report directly. An old
`?tab=history` address opens the Report tab. The
report's own styling, scripts and event attributes are removed and the board's tokens put in their place; the frame
follows the page's Dark/Light/Auto choice through `specs-client/report-frame.ts`. The file on its own is served under
`/schedule-output/<project>/<key>/runs/<jobId>/index.html`.

**A run's proposed specs.** A run may also leave `proposed-specs.json` beside its report: a JSON list of objects with a
`title` and a `description`. When the run ends green — and only then — the board queues one Create job per proposal for
the entry's own project, with no step after Create, so the specs appear on the board created and nothing more; a person
decides which to analyze and implement. The job itself changes nothing. A proposal is skipped, with the reason on the
run's page, when its title is the same as a spec of the project (active, archived or closed) or of a Create job already
queued, running or done — "the same" meaning equal after trimming, collapsing spaces and lowercasing — and when its
title is empty, runs over more than one line or is longer than 120 characters, or its description does not fit in 5,000
characters together with the source paragraph the board adds. That paragraph names the entry and the run and links to the
run's page. Closing a proposed spec with a reason is how it is declined; its title keeps it from being created again. The
board writes what it did to `proposed-specs-result.json` beside the report, and the entry's Overview tab lists it under the
report: each title as created (linked to its job) or skipped, and why. A list that cannot be read, or a project whose specs
the board cannot read, creates nothing and says so there.

`model:` is which of the queue's own `modelChoices` every fire of that entry runs on — one name for the whole entry,
since a scheduled job is a single `schedule` step and has no phases to tell apart. It is picked on the New page and
the Settings tab's Edit the same way a spec's model is picked on the Specs page, with the AI beside it deriving from it; a name the queue
config does not grant is refused at the form rather than at 03:00. A name that differs from a listed one only in
upper and lower case is matched to the listed spelling and stored as that (in a job request, a per-step or pending
pick, a tail-model edit, the Settings save and this form alike); a name matching several listed spellings that differ
only in case is refused, naming them. An entry that names no model is enqueued without one
and the queue config's own `schedule` default decides. "Run now"
reads the same field, so pressing it tests what the schedule actually does.

An entry whose model the queue config does not offer (the config file was edited by hand, or the queue config changed) is
flagged in its Name cell on `/schedule` and on the project's Schedule tab, linking to its Settings tab and naming the model and the ones the queue
offers. Its runs are refused: Run now writes the queue's reason into the message slot above the project's Schedule tab list (`Run now was
refused for <project>:<entry>: …`) and logs `queue: run now refused for
<project>/<entry> — <reason>`; the timer logs `queue: scheduled fire refused for <project>/<entry> — <reason>` once per
fire window and reason, not once per tick. The step sends the named file's contents to the model verbatim, with no Aide skill or spec folder
involved at all; write it the way you would write a prompt by hand.

**Due is computed from the most recent fire time alone — there is no backfill.** If the dashboard is down across a whole
scheduled window, that occurrence simply does not happen; nothing catches up retroactively the next time the poll runs.
A project's own page shows each entry's name and next computed fire time, and the projects overview names the soonest
across a project's entries.

**An entry saved from New or from its Settings tab records a `since` timestamp**, the time of that save. Any fire at or before
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
sessions.

The Process tab on Settings shows the number the queue is using, with the machine's number of cores beside it as a
guide, and saves a new one into this file. A number outside 1 to 8 is refused with the reason on the tab, and nothing
is written. A saved number is used from the next step the queue starts, with no restart. Lowering it stops no step
that is running: the queue starts nothing new until fewer than the new number run. `1` runs one job at a time.

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
  server restarted under it) — the job entered `failed`, `stopped` or `interrupted`; a tap opens the Specs list with
  that spec's row unfolded, where its state and the buttons that act on it are. A stop on shared files names, by
  number, the specs it added to the analysis's record;
- a step finished and its merge into main **did not finish**, or its **tests went red** on the merge — a tap opens the
  Specs list with that spec's row unfolded;
- an **archive is held back** on unticked acceptance criteria — a tap opens the Specs list with that spec's criteria
  unfolded, where they are ticked;
- a **create ends without a spec**: it failed, stopped, was interrupted, or its own merge failed.

Nothing is sent for a step that finishes normally, an archive that merges, or a job someone cancels. A create that is
still under way, including one whose merge is running, sends nothing until it is over.

A **scheduled job** notifies by its own choice, not by the rules above: when a run ends, the entry's `notify` says
whether to send:

- `never` — sends nothing.
- `failure` — sends when the run ended `failed`, `stopped` or `interrupted`. An entry that names none is read as
  `failure`, so a job that already exists notifies when a run does not succeed.
- `always` — sends for every run, including one that succeeded.

A run someone cancels sends nothing whatever the choice, and neither
does a run whose entry has since been deleted or renamed. The choice is read when the run ends, so an edit made while it
runs applies to it. The title names the project and the job, the sentence says how the run ended, and a tap opens
that run's report on `/schedule/<project>/<name>`.

A failed create names the project and the title it was given, says why in the device's own language (cut at 500
characters), and a tap opens New spec at `/new?retry=<job id>` with project, title and description filled in. The same
moment writes a message at the top of the Specs list; see [the specs list](the-specs-list.md#a-failed-create).

**Turning it on.** Settings, the Notifications tab, the switch. Pressing it subscribes or unsubscribes this device, and it moves only once the answer is in. The device asks for its own permission first. The setting
belongs to that device alone. On an iPhone or iPad it works only in the installed app, from iOS 16.4; a browser with no
push support says so beside a switch that stays off, and so does a site the browser blocks. A device whose owner withdrew the permission is removed the next
time the Notifications tab is opened, and one whose push service reports it gone (404 or 410) is removed at the next
send.

**What is sent.**

- A title — with the project and the spec folder; for a failed create, its title.
- One sentence — in the language the device had chosen when it turned notifications on (it keeps that language until
  it is turned off and on again); for a failed create, its reason.
- The Specs list with the spec's row unfolded (or, for a held-back archive, its criteria) — which a tap opens; for a
  failed create, New spec filled in.

It leaves the machine as an encrypted message to the device's own push service (Google, Apple, Mozilla or
Microsoft) and is never in the clear there.

**What is kept.** Three files under `~/.aide/dashboard/`, neither in a repo:

- `push-subscriptions.json` — one entry per device.
- `push-key.json` — the server's own key pair, mode 0600, made the first time it is needed. If the key file is lost a
  new pair is made, and every device turns notifications on again.
- `failed-creates.json` — the creates that ended without a spec: project, title, description, reason; a dismissed one
  stays for the newest 50 so an old notification still opens the form.

The Slack `notifyCommand` above is separate and unchanged.

## The Running tab

The Running tab is the board's first page, at `/`. It lists every spec the Specs list shows under Active, and the wiki
builds, wiki refreshes and scheduled jobs that are running or wait for the user, in every project.

A spec has a row for as long as the Specs list shows it under Active: neither archived nor closed, whatever its jobs
did and whether or not it has one in the queue. A spec waiting for Implement, one implemented and waiting to be tested
and archived, one held back on unticked acceptance criteria and one nothing has run on all have a row. The tab draws the
rows from the same jobs and the same archived rows as the list's Active entry, through the same filter, so the two cannot
show different specs. That includes an archived spec whose branch has not merged: the list keeps it under Active, marked
that its branch is still on origin, and so does the tab. An archived or closed spec whose work is finished has no row. A
job of a spec in a project off the allowlist, of a spec whose folder is gone, or of a finished archived or closed spec (a
Reopen in flight) has no row either; its job page `/jobs/<id>` still shows it with its Stop.

A spec's row is the Specs list's row, drawn by the same builder from the same options: the same columns and buttons,
and when it is unfolded the same phase lines, steps, logs and acceptance criteria. A spec's title leads to the spec's
own address with its row's anchor (`/specs/<project>/<spec>#spec-<project>/<spec>`): the Specs list with that row open
and scrolled to it. The Specs list's own title keeps the address without the anchor. The folds lead to `/`, not
`/specs`. A press on it is the press the Specs list makes.

The code keeps the page's old name: the folder `src/render/pages/jobs-page/`, the `jobs.*` words and the
`aide_jobs_view_<port>` cookie.

A create that ended without a spec has no row. It shows as the Specs list's message for it, above the table, with Try
again and Dismiss, drawn from the same record. The message stays until Dismiss is pressed, on either page.

A wiki build or refresh has a row while it is queued, running or landing, and a scheduled job likewise. A finished one
keeps its row while it waits for the user:

- it failed, was stopped (time limit, usage limit, red tests, unticked criteria, shared files) or was interrupted, a
  conflict being a failure.

`waitsForPerson()` in `src/queue/steps.ts` decides that, and push notifications read the same set. A waiting row leaves
the tab when the user has dealt with it:

- a newer job of the same project and tracking key exists and was not cancelled: a wiki's `wiki-<project>` for a build
  and a refresh alike, a scheduled job's `schedule-<name>`;
- a scheduled job's entry is deleted.

The queue keeps 200 jobs, so a waiting job older than that leaves with its history.

A wiki or scheduled job gets a job row in the same columns and the same two-line shape
(`src/render/pages/jobs-page/job-row.ts`). Its title leads with the project, as a spec's does: "<project>:Wiki build",
"<project>:Wiki refresh" or "<project>:<name>". It folds as a spec's row does, by the `open` key in the address, and is
shut by default: it shows its title, state, time and cost. Its › opens it to show the links to the job's log and to
where it belongs, the project's Wiki build panel or its Schedule tab, and Stop or Cancel. A queued job offers Cancel and
a running or landing one Stop, each asking first; a finished job has nothing to stop. The rules for which wiki and
scheduled jobs show, their titles, links and controls are in `src/render/pages/jobs-page/rows.ts`.

The rows stand in one order, spec rows and job rows together: running or landing first, then queued, then the rest, the
most recently changed first in each. A job's change is the newest of its made, started and finished times. A spec's is
the same for its lead job, or the day the spec was made when no job of its round exists; a spec git has not dated yet
counts as the newest. A change made without a job, such as a description saved from another machine, does not move a
spec. With no row to show, the page says "Nothing is running."

The tab has the Specs list's search box, and two dropdowns beside it, State and Project; its headings sort. The search
reads what the list's does: the project and folder, the title and the whole description. A wiki or scheduled job is
matched on its title as its row shows it ("Wiki build", "Wiki refresh" or the scheduled job's name) and on its project.
The State dropdown offers All, Running, Waiting, Stopped, Failed and Not verified, All by default, each counted over the
rows the project and the search let through; a job row is never Not verified. Archived, Closed and Active say nothing
about a tab that shows only Active specs, so an old address naming one of them gets All. The Project dropdown offers
All projects and each project with a row on the tab, counted over the rows the state and the search let through.

The second heading reads "Title", since the tab also shows rows that are not specs. Every heading sorts, by the rules of
the Specs list's own. With no heading chosen the rows stand in the tab's own order above, and no heading is marked; a
third press on the sorted heading, after it has turned round, returns to that order. A job row's Created is when it was
queued, though the row draws no date there, and its Time is the figure its Time cell shows. A view that hides every row
says "Nothing on this tab matches this filter."

The tab remembers its search, filters and sorting in a cookie of its own, apart from the Specs list's two: choosing on
one tab never changes the other. An address that names any of `state`, `project`, `sort`, `dir` or `q` is the whole view
and becomes the memory, so clearing the search is remembered too; an address that names none, as the tab in the header
does, gets the view last chosen. The rows' fold links carry the view.

The rows sit in `#jobrows`, so the page redraws as the Specs list does: the page script asks the page's own address with
`?rows=1` (and `&only=<project>/<folder>` for one row's fold) when the server says something moved, and every press posts
and redraws in place. A Stop or Cancel question closes when its row is redrawn, as the Specs list's Cancel does.

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
