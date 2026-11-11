# Running specs

## Table of contents

- [Making a spec from the page](#making-a-spec-from-the-page)
- [Queueing from a terminal](#queueing-from-a-terminal)
- [Which requests the dashboard answers](#which-requests-the-dashboard-answers)
- [The queue config](#the-queue-config)
- [Which AI runs a step](#which-ai-runs-a-step)
- [How the board finds a CLI](#how-the-board-finds-a-cli)
- [Which effort level a step runs at](#which-effort-level-a-step-runs-at)
- [Global defaults for the AI and model](#global-defaults-for-the-ai-and-model)
- [Running a job on a schedule](#running-a-job-on-a-schedule)
- [How many run at once](#how-many-run-at-once)
- [When an AI's usage limit is used up](#when-an-ais-usage-limit-is-used-up)
- [Providers](#providers)
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
step that ends either advances the job or ends it, and several jobs run at once ([How many run at once](#how-many-run-at-once)).

## Making a spec from the page

Every active spec is a row on the list, and every row can be run. A spec that does not exist yet has no row, so
there is a **New** button, a link to `/new`, at the right-hand end of the search field's row on the Specs list and on
the Running tab, including when the tab is empty. It is not offered when no project on the board may have a spec made
in it. The page is the form and nothing else, on two tabs with Create above them. **Spec**, the tab it opens on, holds a
project, a title, a description and a **Depends on** field naming a spec this one has to wait for. **Options**
(`/new?tab=options`) holds the acceptance and approach settings, then the phase table. Switching tabs keeps what was
typed, and Create posts both tabs from either. Create posts to `POST /api/queue/create` and goes to the Running tab with
the new spec's row open (`/?created=<job id>`); Cancel returns having done nothing. A refused submission says why
beside the form, where what was typed can be corrected. The browser holds Create at an empty project, title or
description.

**The new spec is not on the Specs list yet.** The `create` step has to run first, and its folder has to reach the
default branch, which the landing does. Until then the job is on the list as a queued create, under a provisional name.

The phase table has one row per phase — create, analyze, implement, archive — each with a tick, an AI choice and a
model choice, drawn by the same pickers the spec's row on the list uses. `create`'s tick is always on; the other three
are on by default, so a form submitted without touching them queues all four phases in order. Unticking a box before
pressing Create is how a `create`-only job is queued. What was ticked is recorded against the spec this job makes, and
is what the row's own phase boxes show once the spec has a row
([What is ticked, and why](the-specs-list.md#what-is-ticked-and-why)).

- **The project list is the raw allowlist**, `queue-config.json`'s `projects`, seeded from `QUEUE_PROJECTS`: a project
  whose FIRST spec does not exist yet appears here and in no other list. `/api/queue` still refuses a project with no
  discovered spec.
- **Nothing here names the spec.** The job carries a provisional key (`new-abc123de`) which names its branch, its
  worktree and its folder on disk; `aide-run-spec` reports that folder as `specFolder` in its result.

**The number and the slug are assigned when the branch lands.** For a `create`, under the specs repo's own merge lock,
the dashboard counts the folders already there, takes the next number, and renames the provisional folder before the
merge is pushed. A job that ticked further phases runs its next step under the real folder name. A landing that fails
leaves the provisional name in place and says which repo and why. Two `create` jobs for one project can start together:
there is no number for them to collide over.

A landing holds back two things and nothing else: the job being landed and a second `archive` in the same project
([Branches and landing](landing.md)).

**The list holds specs, not the machine's whole run history.** An archived spec stays on the list under the default
**All** filter, and **Active** leaves it out. `/api/queue` still returns every job and `/jobs/<id>` renders each one. A
project whose specs the server cannot read this time keeps the rows it already had.

A job survives a restart: the result file is the contract, and a job left `running` is reconciled from the pid and the
file. A step that hits its own time limit is `stopped`, not `failed` ([A job's states](job-states.md)).

A group Start queues the first group member that is not done. Each member remains an ordinary spec with its own
branch and runs analyze, implement and archive before the next member starts. The next member is queued only after
the preceding archive has landed. A failed or stopped member keeps later members waiting, and its own row offers the
same step again.

An implement on a short analysis that finds its spec is not small ends `stopped` with the reason `sent-back`. The board
lands the step's specs branch when it pushed no code (where the specs live inside the code repository, the spec's own
folder alone), then queues one job for the same spec with the steps Analyze and Implement, on the models and effort the
stopped job ran with. The steps the stopped job still had after Implement are not carried over. The description keeps
the requirement, so analyze writes a full analysis and implement cannot send the spec back a second time: one that tries
ends `failed` with `sent-back-refused`, and nothing is queued.

An analyze that writes a short analysis over one of its limits ends `failed` with `short-analysis-over-limit`. The
runner records the same requirement in the description, the board lands the step's specs branch, and queues one job for
the same spec with Analyze and every step the stopped job had not run, on its models and effort. This happens once per
spec.

## Queueing from a terminal

`aide` is a command installed in `~/.local/bin` with Aide's other commands. It makes the same requests as the page's
buttons, from a terminal or an AI session, and answers in one sentence with no link.

| Command                                                 | What it queues                                                     |
|---------------------------------------------------------|--------------------------------------------------------------------|
| `aide create <project> "<title>"`                       | A create, as the New spec form does                                |
| `aide analyze`, `implement`, `archive`, `reopen <spec>` | That step, as the button on the spec's row does                    |
| `aide close <spec> --reason "<why>"`                    | Close, as the Close button does                                    |
| `aide status <spec>`                                    | Nothing: it says the spec's phase and what its newest job is doing |

- **The description of a create** comes from `--file`, else from standard input, else from `$VISUAL` or `$EDITOR`.
  `--depends-on <spec>` (repeatable), `--autostart`, `--provider`, `--criteria-checks off|warn|stop`,
  `--choose-approach`, `--acceptance-not-required` and `--no-ai-criteria` are the form's other settings. Both boxes the
  form opens ticked are ticked unless the last two flags are given. `--autostart` runs analyze, implement and archive once
  the spec is made, as Analyze on its new row does.
- **The model** is the phase's model from Models per phase. `--model <name>` runs the step on that model instead, and on
  a create it applies to every step the create runs.
- **A spec** is named by its number or its folder. A number is looked up in the specs root of the checkout the command
  runs in, or of the board host's checkout of the project named with `--project`; when that checkout is missing or
  lacks the number, it is matched against the project's jobs on the board, and otherwise the spec's folder is needed. The project is `--project`, else the one
  the current directory belongs to.
- **The board** is `AIDE_BOARD_URL` in `~/.aide/config` ([Configuration](../../docs/CONFIGURATION.md)). The command
  asks the board to fetch the project's specs first.
- **An accepted request** is answered by what was queued, on which model (and provider, when the job has one), and
  whether it starts now or what it waits for. The AI behind a model is named when this machine holds the board's queue
  config (`~/.aide/dashboard/queue-config.json`), as on the board's host.
- **A refused request** prints the board's own reason on stderr and exits 1. A call made wrongly exits 2.
- **Without `AIDE_BOARD_URL`, or with a board that does not know the project,** nothing is queued: the command says so,
  names the `/aide-<step>` skill to run in an AI session instead, and exits 1. A board that cannot be reached, or does
  not answer in time, is said so with exit 1; a request that got no answer may still have been queued.
- **A skill run in an AI session hands its step to `aide`** when the project has a board. `/aide-analyze`,
  `/aide-implement`, `/aide-archive`, `/aide-close` and `/aide-reopen` queue their step, and `/aide-create` queues the
  title, the description and any dependencies, through `aide-hand-off`; the session does nothing else and ends on
  `aide`'s answer. A board that is set but cannot be reached ends the session on that sentence. Without a board the skill
  does the step in the session. A headless run never hands its step over, since it is the board's own step. A reopen that
  asks for a reset is not handed over, because `aide reopen` cannot carry it: the answer says it is chosen with Reopen
  on the spec's page, and nothing is queued. This holds for every AI tool that reads the skills.
- **`aide status`** reads the phase from the spec's repository on this machine, after fetching origin, and says so when
  it had to use this machine's copy. For a project with no checkout here it says only what the job is doing.

Another program called `aide` earlier on `PATH` hides this one.

## Which requests the dashboard answers

The dashboard asks for no sign-in. It refuses requests from other sites instead, with one check in front of every
route:

- **The `Host` must be one of its own names:** `localhost`, `127.0.0.1`, `[::1]`, the machine's own Tailscale name when
  it has one, and any name listed in `allowedHosts` in `queue-config.json`. The port is ignored. Anything else answers
  403 with the refused host in the body.
- **A request that changes something must come from the dashboard's own address.** That is any method but GET, HEAD
  and OPTIONS, and the one GET that starts a test board (`?startTestServer=1`). Its `Origin`, when it has one, must
  equal its own `Host` (the scheme is ignored, because a proxy in front of it ends TLS), and its `Sec-Fetch-Site`, when
  it has one, must be `same-origin` or `none`. Anything else answers 403.
- **A header that is absent passes.** `curl`, the run emitter and the round script send no `Origin`.

`headerAuth` in `queue-config.json` is read, and refused unless the server binds loopback.

**The rule stops web pages, not another machine.** A machine that can reach the port and sends `Host: localhost` is
admitted. Bind loopback (`--bind 127.0.0.1`), which the install does by default.

## The queue config

One file (`--queue-config`) holds the time limit, the permission mode, the model, the push mode, how many jobs run
at once, the project allowlist and the notify command. A wrong value costs a config edit and a restart. The time limit
is checked BEFORE a step starts:

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
unmeasured (`0`, and `(unmeasured)` in the step's phase file), never assumed.

`timeoutSec` is a table per step; a step the table does not name falls to `default`. `analyze` has a ceiling of its own,
2400s, because the three-reviewer routine runs inside it. A tightening override is checked against each step's OWN
ceiling. A file still carrying the old flat `"timeoutSec": 1200` is ignored and the built-in defaults stand.

`model` takes two keys besides the steps, read for an implement only: `review` names the choice implement's review runs
on, and `verify` the choice that checks each defect the review finds. Settings writes these keys; a spec's own Review
and Verify lines win over them
([The runner](the-runner.md#what-counts-as-a-step-having-run)). Each may name any configured Claude Code, Codex or
OpenCode model, independently of Implement's AI. Each resolves like a phase: the spec's choice, then its Models per
phase choice, then the default model. Every completed implement runs Review, and Review finding defects runs Verify;
both are read-only. If the chosen model cannot start or complete, Implement stops with Review or Verify, the model and
the reason in its result; it never falls back.

`resumeAnalysis: true` lets an implement continue its analysis's own AI session. It applies only when both steps run
with the same AI (the model may differ) and the analysis ended within the hour, and the two providers share sessions:
the same provider, or two Codex providers with one `CODEX_HOME`. Off unless set.

The server WRITES some of that file's keys as well as reading them, each from one page: `projects` from the Add and
Remove buttons on `/projects`, `schedules` from a project's Schedule tab, and `model`, `timeoutSec`, `concurrency`,
`modelChoices`, `providers` and `provider` from Settings. A write keeps the file's comments and every other key. Where the file
has a `projects` array, it wins over the `--queue-projects` flag, which seeds a first install. A malformed file is
ignored and the flag is kept.

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

`tool` is `claude` (the default), `codex` or `opencode`. `model` is the literal value handed to the CLI when it differs
from the entry's own key; the key is what the picker shows and what a request posts, so it can be the name the tool
itself shows for the model. Each option sits under a group named after its tool.

**An OpenCode model carries its provider.** Every model belongs to a provider and is named `provider/model`, and that
whole string is what `model` holds (`opencode/gemini-3.1-pro`). Nothing OpenCode offers is reachable until a provider is
logged in (`opencode auth login`); the page of an OpenCode provider answers whether one is.

**A provider's page has four tabs under its heading: Config, Usage, Models and Installation**, and opens on
Config. Config holds the form with the display name and the runtime fields, with Save and Cancel, and nothing else;
both come back to Config. Usage holds the login and the usage; the version is in the heading. Models holds the
models reading and the choices it is set against. Installation holds the table of where Aide is installed for the tool.
The address names the open tab
(`/settings?tab=providers&provider=Claude&aitab=installation`), so a reload or a link opens the same tab; `aitab` takes
`config`, `usage`, `models` and `installation`, and anything else opens Config.

**Usage, Models and Installation read their own answer when the tab is opened,** with no press, before the page
answers. While the page waits, the click shows the same Loading cover as any other link on the board. A reading that
fails or runs out of time says so in the tab. The models are read with the provider's own folders in the environment. Each opening reads again and
records what it read: the models feed Add, the pickers and the notice about models no longer offered, and the
installation check feeds the notice about a login. The installation check also runs at start and before a waiting job,
for Claude Code, Codex and OpenCode, which is what that notice at the top of every page reads; the notice links to the
Providers tab.

**The notice about models no longer offered** at the top of every page names the choices of an AI that its last Models
reading does not offer, and links to the Providers tab, where a provider's Models tab has Remove. Removing a choice
clears the notice on the next page load. An AI whose Models tab has not been opened since the board started, and one
whose last reading failed, get no such notice. The Models reading is kept per tool and names the provider whose folders it was
read with.

**The chosen provider shows how much of its subscription is used**, read with the provider's folders: each usage
window with the share used, when it starts over, and when it was read. Reading it runs the tool and takes seconds,
so a reading is kept for two minutes, and the Usage tab opened again in that time shows it without reading; a
provider saved since is read again. Claude Code's comes from
`claude -p /usage`, and Codex's from `codex app-server`'s `account/rateLimits/read`; neither runs a model. When Claude's
text has no line the board can read as a window, the page shows the text as it came. OpenCode reports no usage windows.

**The Installation tab is a table of where Aide is installed for the tool**: one row per place in
`core/scripts/lib/install-targets.txt`, with what the place holds (instructions, rules, skills, scripts or hooks) and its
path. Under the table a line appears only when something is wrong: a place that is not on the host, with the advice to
press Deploy; installed files behind the repository, with the same advice; the tool's command line not found; or a check
that could not run or whose answer the board could not read. When nothing is wrong, nothing is under the table. The facts
come from `aide-preflight --facts <tool>`, and the login is not on the tab: the Usage tab shows it.

**The Models tab lists the models under three headings.** "Currently supported by Aide" is every model choice of that
AI. "Available" is the models the AI offers that are not choices, each with Add. "No longer available" is the choices it
no longer offers, each with Remove; such a choice can still be picked until it is removed. Nothing is added or removed
without a press, a model is added only when the last Models reading read it, and a choice that is a step's
default model is refused until another model is picked for that step. Claude Code is asked one model at a time with
`claude -p --model <m> "/model"`, which runs no model: the four families `opus`, `sonnet`, `fable` and `haiku`, each
with the version it gives today, and every Claude choice. Of the choices, only a full id Claude Code names is offered:
the other names it takes (`best`, `default`, `opusplan`, the `[1m]` names) are listed as no longer offered. A fixed
Claude version, such as `claude-opus-4-8`, is a choice written into `queue-config.json`. Codex's models come from `codex
debug models`, without the ones it marks hidden, and OpenCode's from `opencode models`. The lists are gone after a
restart until the Models tab is opened again.

**A Claude choice shows the version it gives** in every model picker and on a Claude provider's Models tab. The model id it resolves to
is kept in `model-ids.json`, beside the queue's own file: a run records the id it ran on, and opening the Models tab or an Add
records the id Claude Code names. `model-names.json` keeps the name Claude Code gave the choice for that id
(`Opus 5.5 (1M context)` for `opus[1m]`). A choice written into `queue-config.json` by hand shows the bare name until
the Models tab is opened.

**The tool is a choice per PHASE, not per row.** Every phase's dropdown lists every configured model, grouped per CLI,
`Claude Code` first, then `Codex`; a tool with nothing configured draws no group. A row can run analyze on one CLI and
implement on another (`runnerArgv`, `src/serve/serve-helpers/runner-argv.ts` derives `--model` and `--tool` from that
one entry). There is no row-wide AI select.

**Every phase line has an AI picker beside its model picker.** Picking an AI fills in the model for THAT phase, and no
other: the step's own `model` default when that default belongs to the tool, else the first entry `modelChoices` lists
for it. The picker posts nothing itself; what a phase runs on stays one value on the job, and the tool is derived from
it. The model select it fills is recorded the instant it changes ("A model picked for a phase", below). The picker is
drawn whenever ANY tool has a model configured, one included. There is no `Set all…` control.

The pre-filled model for a phase with no run behind it, no recorded pick and no `model` default of its own is the first
entry `modelChoices` lists. A phase that HAS run shows the model it ran on, which wins over everything else; a recorded
pick wins over the per-step `model` default, which wins over the first-entry fallback.

**A model picked for a phase survives leaving the page.** The instant a reader picks a model or an AI for a phase that
has not run yet, the dashboard records the pick, per spec and per phase. Reloading the page or opening the spec in a
different browser shows the recorded pick, and a run started afterwards uses it. A phase that has since run shows what it
ran on instead. While a job runs, a pick for a phase the job can still take is written to that job; a phase the job was
not queued with is recorded for the spec as well, so the next run of that phase uses it.

The queue, the worktrees, the wall-clock timeout and all the git handling are one path for both tools. **The wall clock
(`timeoutSec`) is the only thing that stops a runaway step**, and it is mandatory for every step. One thing differs:

- **A Codex step reports tokens, never dollars.** The Cost column shows the token count and a dash where the money would
  be, never `$0.00`. A job mixing both tools has a `spentUsd` covering its Claude steps only.

The job page's Logs tab works for both tools. Safety modes are stored as Claude's own names, per step, and
`aide-run-spec` translates them for Codex: `bypassPermissions` becomes `--dangerously-bypass-approvals-and-sandbox`,
`acceptEdits` becomes `--sandbox workspace-write`, and `plan` and `default` become `--sandbox read-only`. A mode with no
entry in that table refuses the run.

## How the board finds a CLI

The board STARTS the CLI from outside, as a launchd job, with a short `PATH` that carries neither `~/.local/bin` (where
the installer puts aide's own scripts, and Claude Code itself) nor mise's shims (the only place Codex, Copilot and
OpenCode are found when installed through mise). So the board puts those two directories back in front of the `PATH`
before it spawns anything (`pathWithToolDirs`, `src/serve/tool-path.ts`), for a step's spawn and for the Settings page's
tool checks alike. A directory that does not exist is not added.

`AIDE_CLAUDE_BIN`, `AIDE_CODEX_BIN` and `AIDE_OPENCODE_BIN` point a run at a particular binary instead, and win over the
`PATH` search. All three are read from the environment. `AIDE_CLAUDE_BIN` is also read from the project's `.aide/config`,
which is how a project points its runs at a stand-in binary; a value written there for the other two does nothing.

The tool checks run when the board starts, when a provider's Installation tab is opened, and for the tool a queued job's next step will run on,
at most once a minute per tool. A check that finds something wrong puts a line at the top of every page, but only for a
tool some model is configured for. The login check reads every provider of the tool, each with its own folder, so the
line names the provider whose login is wrong ("Claude Code: Claude-2 not logged in"). A Claude Code login that names one account with an organization plan it cannot have is
reported as the login in use being another account's. All of this happens only on a board started with
`checkToolsOnStart`.

## Which effort level a step runs at

A step runs at the effort level its own job request named, and at no level when it named none. Nothing on the board sets
one: a level reaches a job through `POST /api/queue` only.

The levels are `low`, `medium`, `high`, `xhigh` and `max`, as listed in `core/scripts/lib/effort-levels.json`.
`ultracode` is deliberately not among them: it turns on multi-agent orchestration, and a routine step must not be able to
opt into a much larger run. The level reaches `aide-run-spec` as `--effort <level>` on the `claude -p` invocation only;
a level chosen for a step that runs on Codex or OpenCode is accepted and dropped. The level a step ran at is recorded in
its phase file as a `- **Effort:**` line, and shown on the job's page beside its Model row.

## Global defaults for the AI and model

`/settings` holds the default AI and model per step, on its Models per phase tab. A step with no provider saved there runs on the first provider that runs its model, which is the provider its row shows. Review and Verify sit directly under Implement, without timeouts, and each list contains every configured model independently of Implement's AI. The same two lines on a spec override these defaults for that spec; without an override, the line shows and uses its Models per phase choice, or the default model when it has none. Every completed implement runs Review, and Review finding defects runs Verify, both read-only. If either chosen model cannot run, Implement stops with the part, model and reason and does not fall back to another model. The other rows are the
six that act on a spec (Create, Analyze, Implement, Archive, Close and Reopen) and Schedule. A step nothing has been saved
for runs on Claude Code's Opus, and its row shows that; a `model.default` in the config file is a saved choice for every
step without one of its own. On a host whose choices hold no Opus, the row shows the first listed choice while the runner
hands `--model opus` to Claude Code. Beside the models the page holds a `timeoutSec` table, in minutes. Saving posts to
`POST /api/queue/settings`, which validates every model name against `modelChoices` and updates `queue-config.json`
atomically. Later jobs use the new values at once; jobs already accepted keep their stored choices.

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

An entry may also carry:

- `"notify": "never" | "failure" | "always"`, read as `failure` when absent
  ([Push notifications](#push-notifications-on-a-phone-or-laptop)).
- `"chrome": true`, set as Browser: each run starts Claude with the browser of the logged-in Chrome on the serving host
  (`aide-run-spec --chrome`), for a prompt that reads a page behind a login. It needs Chrome running there with the
  Claude extension signed in to the same account as Claude Code, and a model run by Claude.
- `"sandbox": false`, set as Sandbox: each run starts Claude without its sandbox (`aide-run-spec --no-sandbox`), for a
  prompt whose commands start a browser ([What a step can reach](the-runner.md#what-a-step-can-reach)).

A fresh install has no scheduled jobs. A project's own files never carry a schedule; a job belongs to the installation
that fires it.

Each entry is:

- `name` — becomes the job's `schedule-<name>` tracking key, never a spec folder.
- `cron` — a standard five-field cron expression, evaluated in the SERVING HOST's local timezone.
- `prompt` — a prompt file's path, relative to the project's own root. A run reads the file as committed in the
  dashboard's checkout, after pulling it, so a change takes effect once it is pushed. A save refuses a path that is not a
  file in the checkout, and stores it normalised.
- `model` — one of the queue's `modelChoices`, for the whole entry. It is picked the way a spec's model is, with the AI
  beside it deriving from it; a name the queue config does not grant is refused at the form. A name that differs from a
  listed one only in case is stored as the listed spelling; one matching several such spellings is refused. An entry
  with no model is enqueued without one and the queue config's `schedule` default decides.

A background poll enqueues a `schedule` step through the same queue and runner whenever an entry is due and nothing is
already queued or running for it. **A scheduled job may commit to the project repository and the specs root.** Its report
is written separately (below). Once the run ends, the board lands what it pushed: the project repository's commit only
once that repository's own test command is green on the merge, the specs root directly. A scheduled job can run
alongside a spec's steps when the queue has a free slot. Each run uses its own worktrees; repository locks serialize
shared checkout changes and landings. Usage limits and an existing run of the same schedule still hold it back.

`/schedule` lists every allowed project's entries (`?q=`, `?sort=` and `?dir=` filter and sort it). It changes nothing:
a click on a row opens the project's Schedule tab, which lists its entries by Name, Next run, the Enabled switch, Run now
and Delete, with New above the list. `/schedule/<project>/<name>` is one entry's page, with two tabs: Report and Settings.
Settings shows every field of the entry with the Enabled switch, Edit and Delete. The prompt file's path links to
`/schedule/<project>/<name>/prompt`, which shows the file as the default branch of the board's checkout last fetched it,
or one sentence saying it cannot be read. Edit (`?tab=settings&edit=1`) draws the fields as inputs with Save and Cancel;
New is `/schedule/new?project=<project>`. A save goes back to the page it was opened from (`back`), and a refused save
stays on the page with the reason and what was typed. The pages post to:

- `POST /api/queue/schedule` — create.
- `POST /api/queue/schedule/<project>/<name>` — edit.
- `POST .../enabled` — toggle.
- `POST .../run` — fire now.
- `POST .../delete` — remove.

`GET /api/queue/schedule/cron-next` previews a cron expression's next fire time for the form.

An entry whose model the queue config does not offer is flagged in its Name cell, linking to its Settings tab. Its runs
are refused: Run now writes the queue's reason above the project's Schedule tab list, and the timer logs the refusal once
per fire window and reason. The step sends the named file's contents to the model verbatim, with no Aide skill or spec
folder involved.

**A run's report.** Each `schedule` run writes into `<output root>/<project>/<key>/runs/<jobId>/`, named in
`AIDE_SCHEDULE_OUTPUT_DIR`. The report is its `index.html` there; a missing file, an empty one, or one with neither text nor an `<img>` counts as no report.
An entry's Report tab lists every run by Started, State and Duration, newest first, and a click on a run opens the same
page with that run's report above the list (`?run=<jobId>`). The report stands in a sandboxed frame, so nothing in it
runs and its links open in a new tab, headed by the run's outcome and how long ago it started, with that run's proposed
specs under it. A run that wrote no report shows a sentence with how it ended. The report's own styling, scripts and
event attributes are removed and the board's tokens put in their place. The file is served under
`/schedule-output/<project>/<key>/runs/<jobId>/index.html`.

**A run's proposed specs.** A run may leave `proposed-specs.json` beside its report: a JSON list of objects with a
`title` and a `description`. When the run ends green, and only then, the board queues one Create job per proposal for the
entry's own project, with no step after Create. A proposal is skipped, with the reason on the run's page, when its title
equals (after trimming, collapsing spaces and lowercasing) a spec of the project (active, archived or closed) or of a
Create job already queued, running or done; when its title is empty, runs over one line or is longer than 120
characters; or when its description does not fit in 10,000 characters together with the source paragraph the board adds.
Closing a proposed spec with a reason is how it is declined; its title keeps it from being created again. The board
writes what it did to `proposed-specs-result.json` beside the report, and the entry's Overview tab lists it. A list that
cannot be read, or a project whose specs the board cannot read, creates nothing and says so there.

**Due is computed from the most recent fire time alone; there is no backfill.** If the dashboard is down across a
scheduled window, that occurrence does not happen. An entry saved from a form records a `since` timestamp, and a fire at
or before it counts as used, so its first run is its next fire after the save. An entry with no `since`, written by hand,
fires on its first eligible window. A window whose fire the queue refused made no job, so it is still due for an entry
with no `since`; an entry saved from a form does not fire for it.

**Where jobs are stored.** Creating, editing, enabling or deleting an entry writes the `schedules` key of the
`--queue-config` file, keeps the rest of the file as it was, and commits nothing. The file is read again on every poll
and page, so a hand edit takes effect at the next poll. A save is refused, with the file untouched, when the server has no
`--queue-config` file or it is not valid JSON; while it cannot be read, no scheduled job starts. A `prompt` path that
resolves outside the project root is dropped when the file is read, and a malformed `cron` drops that one entry.

## How many run at once

`concurrency`, two by default. **1 to 8 is accepted and anything else — missing, non-numeric, out of range — falls back
to two**; it does not clamp.

The Process tab on Settings shows the number the queue is using, with the machine's number of cores beside it, and saves
a new one into the queue config. A number outside 1 to 8 is refused. A saved number is used from the next step the queue
starts. Lowering it stops no step that is running. `1` runs one job at a time.

**A create starts at once and does not count towards `concurrency`.** It takes about a minute and is what gives a new
spec its number and its row. Every other step takes a slot, the later steps of a New spec's own job included. A create
still waits while its AI's usage limit is used up.

Two jobs for the same spec are never started at the same time, nor two `archive` steps in the same project: the second is
held `queued` with the reason on its row until the first has landed. Beyond that the jobs are independent: each run works
in `git worktree` checkouts of its own.

## When an AI's usage limit is used up

A step that stops because its AI's usage limit is used up (`provider-limit`: Claude Code or Codex) is started again by
the board itself once the limit has reset. Nobody presses anything.

- **The hold.** From the stop until the reset time the newest stop on that provider recorded, the board starts no
  queued step on that provider. A newer stop is the AI's latest word, so it moves the time for every stopped step on
  that provider, earlier or later. A step on that provider that started after a stop and completed shows the limit has
  reset, and every stop made before it ends there, whatever time it was given.
  Those jobs stay `queued` and say so on their row and on their job page. Steps on other providers start as before, and
  OpenCode and Copilot, which report no usage limit, behave as always.
- **Starting again.** At the reset time the stopped step is queued again — the same job, in its place in the queue —
  and the steps held behind it start as the slots allow. A step that hits the limit again is held and started again
  the same way, with no limit on how many times.
- **No reset time.** When the AI did not say when its limit resets, the board waits one hour. Then it starts one
  step, the oldest stopped one. If that step runs, the rest follow; if it hits the limit again, the board waits again,
  until the new reset time when the stop gives one and one hour when it does not.
- **A press starts at once.** Choosing another provider in the phase's AI choice and pressing a stopped job's step
  button (Implement, Analyze and so on) queues the step on that provider, and it starts at once, past the hold. The row
  offers no button of its own for this. A held job's row offers Cancel; once it is cancelled the step button
  starts the step at once. When the stopped job's own time comes it is not started a second time.
- **A scheduled run** whose AI is held waits like any other step and starts when that provider's steps start again.
- **A restart of the board.** The hold and the time to start again are stored on the jobs, so a restart keeps them.
  A stop recorded before the wait existed has no time and is never started by the board.

The stopped job's row and page say which provider's limit is used up, which window (five-hour or weekly) when the AI named
one, that the step starts again by itself, and the time. With no reset time they say that the AI did not say when its
limit resets, and the time the board tries again. A held job says that it waits for that provider's usage limit and the
time it starts; while the step sent ahead is running, it says when the board tried again and that it starts once that
step has run. [A job's states](job-states.md) has the fields and the transition behind it.

## Providers

A provider is one named AI login: a tool (Claude Code, Codex or OpenCode) and the folders that tool keeps its login in.
Every AI choice on the board lists providers by name ("Claude", "Claude-Capra", "Codex"), with the model choice under
the provider.

- **One row of tabs.** Settings has four tabs on one row: Models per phase, Providers, Process and Notifications. A
  link that names the AI tab the row once had (`?tab=ai`) opens Models per phase, and one that names a tool tab
  (`?tab=claude`, `codex`, `copilot`, `opencode`) opens Providers. Copilot is offered nowhere under Settings.
- **The list.** The Providers tab shows the providers in a list, with the chosen provider beside it (under it on a
  narrow screen). Each row has the tool's icon, the name, the tool's version, the login and the plan (Claude Code's
  subscription, or the way Codex is logged in), and the provider's on/off switch. Above the list is **+**, which adds a
  provider, and when the status was read, with Check again. **Add provider** ends the list. Pressing a row chooses
  that provider in place, without loading the page again (as do the tabs of its page and Check again); the address
  names it (`/settings?tab=providers&provider=Claude`), and with none named the first is
  chosen. The tool of a provider does not change; to change it, add a provider. No provider is special: the ones the
  board made on its first start can be renamed and removed like the rest.
- **Add.** **+** and **Add provider** open the Add dialog, in three steps. Next moves on only when the step's fields are
  filled in right.
  1. **Provider:** one card each for Claude Code, Codex and OpenCode.
  2. **Identity:** the display name and the ID. The ID is made from the name as it is typed, until it is typed in
     itself.
  3. **Config:** the chosen tool's runtime fields, and the command that logs the provider in on the machine the board
     runs on, written out with the folder and binary path as they are typed
     (`CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login`). The board does not log a provider in: the command is run
     there, and Status shows when it is logged in.

  Add saves the provider and shows it beside the list. A refusal stays in the dialog with the reason; Cancel closes
  it, and it opens empty at the first step again. The old address of the Add page (`/settings/providers/new`) leads
  to the Providers tab.
- **The chosen provider.** Beside the list: the name with the version and **Remove**, which asks first; then the
  four tabs. Config has one form with the display name and the runtime fields, with Save and Cancel; Usage has the
  login (see Status) and the usage; Models and Installation have the readings made when they are opened. Save shows its pending label while it saves; a refusal is written in the
  form's own line and leaves every field as it was typed; Cancel puts back what was saved. Renaming a provider updates
  nothing else: phase defaults, schedule entries and jobs store the provider's key. The old address of a provider's
  page (`/settings/providers/edit?key=`) leads here.
- **The fields.** Claude Code: a config folder, handed over as `CLAUDE_CONFIG_DIR`; empty means Claude Code's own
  `~/.claude`. Codex: a `CODEX_HOME` folder, empty meaning `~/.codex`, and an optional shadow home. OpenCode: none. A
  folder is written from `/` or `~/`. A folder that is not there yet is made on save; a path that is a file is refused.
- **Binary path.** Every provider may name the program its tool runs as, written from `/` or `~/`. Empty means the one
  found on `PATH`. A path that is not there, is a folder or cannot be run is refused. The status, the login check and
  every step and Review or Verify turn on the provider use that program.
- **Auto-compact after.** A Claude Code provider may give a number of tokens, from 100000 to 1000000, after which
  Claude Code compacts the conversation (`claude --autocompact`). Empty leaves Claude Code's own setting. Review and
  Verify turns are not given it.
- **The name and the ID.** The name is what the board shows: one line of up to 64 characters, spaces included. The ID
  is the key the provider is stored under: letters, digits, `-` or `_`, given on Add or made from the name, and never
  changed afterwards.
- **On and off.** A provider can be switched off. A switched-off provider is not offered on an AI choice, except on one
  where it is already the provider chosen, and is not taken when a phase with no provider of its own falls back to the
  first one that runs its model. A step whose own
  provider, or whose phase default, is switched off is held back on the queue with a sentence saying which provider
  to switch on, and starts once it is on. Review and Verify pass a switched-off provider over for the first one that is
  on. The login check does not read it.
- **Adding and saving.** Add and Save run the same rules in this order: the name (empty, invalid or taken in any case
  is refused with a sentence saying which), the fields, the binary path and auto-compact, the login not being another provider's, and the tool being
  installed on the machine serving the board (refused naming the tool, asked with `--version` alone). A provider that is
  not logged in is saved.
- **The status.** A provider's page shows whether its tool is installed and its version, the account it is logged in as
  (the e-mail and the plan where the tool reports them) or that it is not logged in, and, where the tool reports it,
  the date the login ends (Claude Code does). For a provider that is not logged in the page gives the command that logs
  it in, with its folder filled in (`CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login`, `CODEX_HOME=~/.codex-p codex
  login`, `opencode auth login`). A login that could not be read says so and asks to open the page again; it is never
  shown as not logged in.
- **Read as a step would meet it.** The status is read when Settings opens on its Providers tab (for the rows) and when
  a provider's page opens, and no other tab reads anything. The board's own process reads it, with the provider's folder in the environment, so it is what a
  step on that provider would meet, which a terminal's own login need not be: a login kept in the macOS keychain can be
  readable from a terminal and not from the board's service. The login check at start, on the Installation tab and before a waiting
  job reads every provider the same way.
- **One login each.** Save refuses a provider whose login another provider of the same tool already uses: the same
  Claude config folder, the same Codex folder (the shadow home when there is one), or a second OpenCode provider.
- **Stored under a key.** The `providers` table of `queue-config.json` holds each provider under a key that never
  changes, with its `name`, `tool` and fields, and `enabled: false` when it is switched off; the `provider` table gives each phase's provider by key, and has no `default`: a
  phase with no entry runs on the first provider that runs its model. A
  rename changes the name alone, so jobs, schedules and phase defaults need no rewriting. A finished step keeps the
  name it ran under.
- **The first start.** On the first start with no `providers` key, the board makes `Claude`, `Codex` and `OpenCode` for
  the tools' own logins and one provider for each entry that was under `claudeAccounts`, points every phase default,
  schedule entry and job at the provider that is the same login, and removes `claudeAccounts`. A `provider.default` left
  in the file is deleted on start. A `providers` table emptied by Remove stays empty.
- **Remove.** A provider that a phase default, a schedule entry or a job that will still run (queued, running, or
  stopped waiting for a reset) uses is not removed; the refusal names what uses it.
- **Choosing.** The AI choice on a phase line, on the Settings phases table, on New spec and on the Schedule form lists
  the providers that run at least one model choice. Choosing a provider narrows the model choice to the models its tool
  runs. A job, a pending pick and a schedule entry store the provider beside the model.
- **Where it shows.** The phase line names the provider ("Claude-Capra · opus"). The job's page has a Provider line on
  its Overview and on each step, and the Jobs tab names it while the job runs and once it has ended ("Implement ran
  on Claude-Capra").
- **The hold.** A usage limit holds one provider: a step on Claude-Capra waits for Claude-Capra's limit only. The
  stopped step names the provider and the reset time, and is queued again on the same provider when it resets.
  See [When an AI's usage limit is used up](#when-an-ais-usage-limit-is-used-up).
- **What runs on the provider.** Every Claude turn runs with its chosen provider's config folder as
  `CLAUDE_CONFIG_DIR`; Review and Verify use the providers selected on their own lines. Every Codex turn runs with its
  chosen provider's shadow home, else its `CODEX_HOME`, as `CODEX_HOME`. A step that continues an earlier session of the spec (an implement continuing its
  analysis) does so only when both ran on providers that share sessions.
- **The sandbox.** A Claude step may not write the settings, hooks, skills, agents, rules or plugins in any provider's
  Claude folder, nor anything in a Codex folder, nor read a Codex folder's `auth.json`
  ([What a step can reach](the-runner.md#what-a-step-can-reach)).

In this page "provider" means this login. It is not the `provider-limit` stop, and not the `provider/model` an OpenCode
model name starts with.

**Setting up a second Claude login on the serving host** is done by hand, once, in a terminal:

1. Make the directory: `mkdir ~/.claude-2`.
2. Link what the two logins share from `~/.claude`: `settings.json`, `CLAUDE.md`, `hooks`, `skills`, `agents`,
   `rules`, `plugins` and `projects`. For each, `ln -s ~/.claude/<name> ~/.claude-2/<name>`. Without `projects` a
   step cannot continue a session another login made, and without the rest it runs without the skills.
3. Log in: `CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login`.
4. Add it under Settings → Providers, with the name to show and `~/.claude-2`.

**Setting up a second Codex login** is a folder of its own, with its own login, in one of two ways. With a `CODEX_HOME`
of its own and no shadow home the provider keeps its sessions apart. With a shadow home the provider shares its
`CODEX_HOME`'s sessions and settings and keeps its own login, so one provider can continue a session another started:

1. Make an empty folder, such as `~/.codex-personal`, and log in there: `CODEX_HOME=~/.codex-personal codex login`.
2. Add the provider under Settings → Providers with the shared folder as `CODEX_HOME` and the new folder as the
   shadow home. Save links everything in the `CODEX_HOME` except `auth.json` into the shadow home, and again before each
   Codex step, so an entry added since is linked. A shadow home that already has a `sessions` folder or a `config.toml`
   of its own is refused; start from an empty folder and log in there again.

The board's login check and the Usage tab read the tools' own logins only. A step on a provider that is not logged in
ends with the tool's own error.

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

- a step **failed**, ran out of **time**, hit the AI's **usage limit**, found its model **at capacity**, or was **cut off** (its process vanished, or the
  server restarted under it) — the job entered `failed`, `stopped` or `interrupted`; a tap opens the Running tab with
  that spec's row unfolded and scrolled to, where its state and the buttons that act on it are. A stop on shared files names, by
  number, the specs it added to the analysis's record;
- a step finished and its merge into main **did not finish**, or its **tests went red** on the merge — a tap opens the
  Running tab with that spec's row unfolded and scrolled to;
- an **archive is held back** on unticked acceptance criteria — a tap opens the Running tab with that spec's criteria
  unfolded and scrolled to, where they are ticked;
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
- The Running tab with the spec's row unfolded and scrolled to (or, for a held-back archive, its criteria) — which a tap
  opens; for a failed create, New spec filled in.

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

The Running tab is the board's first page, at `/`. It lists every spec the Specs list shows under Active, and the
scheduled jobs, the Close and Reopen jobs and the board's own deploy that are running or wait for the user, in every
project.

When the board starts with nothing running, the first page a browser tab loads, if it is the Running tab with no row left
by its saved filter, replaces itself with the Specs list. Once the board has started in a tab, the Running tab shows,
empty or not, on a click, a link or a reload. [Installing it as an app](hosting.md#installing-it-as-an-app) has the
installed app's part.

The tab offers **New**, as the Specs list does ([Making a spec from the page](#making-a-spec-from-the-page)).

With no rows, the search field, State filter and column headings stay visible, and the table has one row saying "Nothing
is running." Failed-create messages stay above the search row. The first job appears without a page reload.

A spec has a row for as long as the Specs list shows it under Active, whatever its jobs did and whether or not it has one
in the queue. The tab draws the rows from the same jobs and archived rows as the list's Active entry, so the two cannot
show different specs; an archived spec whose branch has not merged is on both, marked that its branch is still on origin.
An archived or closed spec whose work is finished has no row. A job of a spec in a project off the allowlist, of a spec
whose folder is gone, or of a finished archived or closed spec has no row either; its page `/jobs/<id>` still shows it
with its Stop.

A spec's row is the Specs list's row, drawn by the same builder: the same columns and buttons shut. Opened here it
unfolds to the phase lines, the Depends on picker, steps, logs and acceptance criteria, where the Specs list's open row
shows the spec. A spec's title leads to `/specs/<project>/<spec>#spec-<project>/<spec>`: the Specs list with that row open
and scrolled to it. The folds lead to `/`, not `/specs`.

A create that ended without a spec has no row. It shows as the Specs list's message for it, above the table, with Try
again and Dismiss, until Dismiss is pressed on either page.

A scheduled job has a row while it is queued, running or landing. A finished one keeps its row while it waits for the
user: it failed, was stopped (time limit, usage limit, red tests, unticked criteria, shared files) or was interrupted
(`waitsForPerson()` in `src/queue/steps.ts`; push notifications read the same set). A waiting row leaves the tab when:

- a newer job of the same project and tracking key exists and was not cancelled;
- a scheduled job's entry is deleted;
- the user pressed Dismiss on a scheduled job's row. The job stays in the queue with its log and its page; only the row
  goes. A job queued again after a usage limit that ends again has its row back.

The queue keeps 200 jobs, so a waiting job older than that leaves with its history.

The board's own deploy is a job under the tracking key `deploy`, a step the server runs itself, so it takes no slot
(`takesSlot`, `queue/steps.ts`). The Deploy button on the board's own project queues it
(`POST /api/queue/projects/<project>/deploy`). Its row is named "Deploy <project>", and it has a row while it is queued,
held back or running, and once it has failed or been interrupted until a newer deploy of the project is queued. A second
deploy is refused while one is queued or running. It offers Cancel while queued and nothing once it runs, since a job
marked cancelled would go on restarting the service. The open row lists five steps: fetch from origin, install, restart
the service, wait for the service to answer, and check that the newest commit runs. Its cost is a dash. While a merge is
in flight, a queued deploy waits, and a running one waits before its fetch and before its restart; the row says "Held
back" with the reason.

A scheduled job's row (`src/render/pages/jobs-page/job-row.ts`) has the same columns and two-line shape. Its title leads
with the project: "<project>:<name>". It is shut by default, and its › opens it to show Stop or Cancel and a line per
step its log has marked (Aide's preparing, the steps the model marks, Aide's tests and commit), each with its state, its
time and a › that unfolds the step's part of the log. A job that failed, stopped or was interrupted says why in a line
under its state, ending with a Log link and Dismiss. A queued job offers Cancel and a running or landing one Stop, each
asking first; a finished one has Dismiss alone. Which scheduled jobs show is decided in
`src/render/pages/jobs-page/rows.ts`.

The rows stand in one order, spec rows and job rows together: running or landing first, then queued, then the rest, the
most recently changed first in each. A job's change is the newest of its made, started and finished times; a spec's is the
same for its lead job, or the day the spec was made when no job of its round exists. A change made without a job, such as
a description saved from another machine, does not move a spec.

The tab has the Specs list's search box and a State dropdown (All, Running, Waiting, Stopped, Failed and Not verified,
All by default), each counted over the rows the search lets through; a job row is never Not verified. An old address
naming Archived, Closed or Active gets All. There is no Project dropdown: typing a project's name, or `name:`, narrows
the tab to it. The second heading reads "Title", and every heading sorts by the Specs list's rules; a third press on a
sorted heading returns to the tab's own order. A view that hides every row says "Nothing on this tab matches this filter."

The tab remembers its search, filters and sorting in a cookie of its own, apart from the Specs list's. An address that
names any of `state`, `sort`, `dir` or `q` is the whole view and becomes the memory; one that names none gets the view
last chosen.

The rows sit in `#jobrows` and redraw as the Specs list's do: the page script asks the page's own address with `?rows=1`
when the server says something moved, and every press posts and redraws in place. The code keeps the page's old name: the
folder `src/render/pages/jobs-page/`, the `jobs.*` words and the `aide_jobs_view_<port>` cookie.

## Live runs

A spec's row shows a live indicator (session id, liveness and cost so far) while an `/aide-*` command runs against it.
The queue side works with nothing configured.

**The queue's own runner reports a run's phases.** When it spawns a step, it hands the child `AIDE_RUN_URL` pointing at
this server's own `POST /api/aide-run`, and the implement skill calls `aide-emit-run --phase red|green|verify` at each
TDD phase boundary, so a headless run's phases reach the row. A step started by hand in a project with a board is queued
there instead (see Queueing from a terminal).

**`GET /api/aide-runs` is these runs in flight, as JSON.** No page renders it directly: the spec list shows every
queued run per row, and interactive sessions are claude-usage's own page. Runs are kept in memory (LRU 512) and
mirrored to `~/.aide/dashboard/aide-runs.json` so restarts keep them.
