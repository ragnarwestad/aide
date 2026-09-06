# Running specs

How a spec becomes a run: the queue, the runner, the checkouts it works in, and what each step publishes.
Five pages sit beside this one: [A spec's lifecycle](spec-lifecycle.md) — the four phases and what moves a spec
between them — [A job's states](job-states.md) — the job's state machine, in one place —
[The specs list and the spec page](the-specs-list.md) — what a row says and what its controls do —
[Projects](projects.md) — adding one, and whether a run can start there — and
[Branches and landing](landing.md) — how each step's branch is merged, and what stops one from landing.

## Table of contents

- [Making a spec from the page](#making-a-spec-from-the-page)
- [The token](#the-token)
- [Caps](#caps)
- [Which AI runs a step](#which-ai-runs-a-step)
- [Global defaults for the AI and model](#global-defaults-for-the-ai-and-model)
- [Running a job on a schedule](#running-a-job-on-a-schedule)
- [How many run at once](#how-many-run-at-once)
- [The dashboard's own checkouts](#the-dashboards-own-checkouts)
- [How a run touches the repositories](#how-a-run-touches-the-repositories)
- [Notifications](#notifications)
- [Live runs](#live-runs)
- [What a finished step publishes](#what-a-finished-step-publishes)

---

The spec list runs aide workflow steps headless on this machine: one job at a time, each step a
`claude -p "/aide-<step> <spec>"` process started by aide's `aide-run-spec`. A job is an ordered list of steps; a step
that ends either advances the job or ends it.

## Making a spec from the page

Every spec that exists is a row, and every row runs. A spec that does not exist yet has no row — so above the table
there is a "New spec"
button, and it is a plain link to `/new`. That page is the form and nothing else: a project, what the spec
builds on, a title, a description, a phase table, and two actions — Create, which posts to
`POST /api/queue/create` and returns to the list, and Cancel, which returns having done nothing. The phase table has
one row per phase — create, analyze, implement, archive — each with a tick, an AI choice and a model choice, drawn by
the same pickers the spec row on the list uses. `create`'s tick is always checked and cannot be unchecked; the other
three are unticked by default, so a form submitted without touching them queues the same single-step `create` job as
before. Ticking further phases queues one job whose `steps` runs all of them in order, guarded, budgeted and timed
exactly like any other.

It is a page rather than a disclosure folded into `/`: a primary button that unfolds the page under it reads oddly,
and leaves no way out but pressing the same button again. Both actions work with no script at
all — a link and a form POST — and a refused submission comes back to `/new?error=…`, where what was typed can be
corrected.

Two things about it are worth knowing:

- **The project list is the raw allowlist** (`queue-config.json`'s
  `projects`, seeded from `QUEUE_PROJECTS`), not the projects the server has found specs for. Every other control on the
  page is about a spec that exists; this one is about a project whose FIRST spec may not, and such a project appears in
  no other list here.
  `/api/queue` is unchanged and still refuses a project with no discovered spec.
- **Nothing here names the spec.** The job carries a provisional key (`new-abc123de`) which names its branch and its
  worktree and nothing else; the number and the slug are decided inside the `/aide-create`
  run, whose own steps own that rule. `aide-run-spec` then reports the folder that actually appeared, as `specFolder` in
  its result — read off the disk, and left unreported when zero or several appeared rather than guessed at.

When the step succeeds the dashboard **lands the branch itself** and renames the job to the real folder. That is not a
convenience: the list shows what is on disk in the main checkout, which every run
keeps on its default branch, so a created spec that is only pushed to a branch appears nowhere at all. A job that
ticked further phases runs its next step under that real folder name, never the provisional one. A landing that
fails leaves the provisional key in place and says which repo and why. **While any job is landing the scheduler starts
nothing at all**, whatever the concurrency is set to: a landing merges into the shared main checkout, which worktree
isolation does not cover.

The list holds SPECS, not the machine's whole run history: a spec that has been archived leaves the page along with the
jobs it had. Nothing is destroyed — `/api/queue` still returns every job and `/specs/<id>` still renders each one. A
project the server knows no specs for at all keeps every row it has: an empty spec list means "we cannot tell", never
"everything here is archived".

Nothing is guessed at across a restart: the runner spawns detached, in its own process group (such a child survives
`launchctl bootout`), and **the result file is the contract** — the scheduler polls the pid and the file, and a job left
`running` is reconciled from both.

A run that hits a cap is **stopped**, never **failed**. With caps this tight a cap-stop is a common, healthy outcome,
and a reader who cannot tell it from a broken agent will start ignoring both.

## The token

The whole queue surface — `GET /`, `GET /new` and `GET /projects`, and the old addresses `/specs` and `/queue`,
included — needs a token; a token a page hands to anyone who can load the page is not a secret. Open
`/?token=<the token>` once and the browser keeps an `HttpOnly`
cookie; API callers send `X-Aide-Token`. The generated pages (`/projects.html`, `/<slug>.html`, `/about.html`) and
`/live` stay open:
they carry nothing that needs the token. The token is read from a file (`--token-file`), never an argument: `ps` shows
arguments to every user on the machine.

**The cookie is `SameSite=Lax`, and it has to be.** A `Strict` cookie is withheld on a top-level navigation that STARTED
somewhere else, and an installed app launched from the home screen is exactly that — so with
`Strict` the dashboard installed on a phone opens on "unauthorized" while the same browser is signed in. `Lax` is
still withheld from a cross-site POST, which is what `Strict` was guarding here, and every form on this page posts
same-site. Tightening it again breaks the installed app and nothing will say so until someone opens it.

**With no token configured every queue route answers 503** — off loudly, rather than open quietly. `/live`,
`POST /api/aide-run` and the static site are unaffected: the run emitter sends no credential and swallows the answer,
so a 401 there would silently empty `/live`.

## Caps

Four, all checked BEFORE a step starts — a cap that only stops you afterwards is a report, not a cap. They live in the
queue config (`--queue-config`), so a wrong number costs a config edit and a restart:

```json
{
  "budgetUsd": 3,
  "jobCapUsd": 10,
  "dailyCapUsd": 20,
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

A job may only TIGHTEN a cap, and cannot set the permission mode at all. A timed-out step is charged its full budget:
the accounting over-charges what it could not measure, never the other way round. That over-charge is a ceiling, not a
measurement, so every figure it is summed into carries an `est.` beside it — the step's own row, the job's total and the
spec's.

`timeoutSec` is a table per step, read the same way `permissionMode` and
`model` below are: a step the table does not name falls to `default`. It is per step because a plain `analyze` is
minutes and an `implement` on a twenty-file change is the better part of an hour, and one number for both stops a step
with its tests already green. `analyze` carries a longer-than-default ceiling of its own — 2400s — because the
three-reviewer-perspective routine runs inside it. A tightening
override is checked against each step's OWN ceiling, so a job holding both steps cannot buy `analyze` more time by
naming `implement`. A file still carrying the old flat `"timeoutSec": 1200` is ignored and the built-in defaults stand,
the same direction every other malformed key here fails in.

The daily cap counts the budgets of the steps **already in flight**, not only what has been recorded. Recording happens
at completion, so with several slots N jobs would otherwise each pass the same check on the same numbers, and the cap be
exceeded by (N−1) budgets before anything noticed. A job the daily cap holds back does not block the queue either:
a cheaper job behind it may take the free slot.

`projects` is the odd one out in that file: it is the only key the server WRITES as well as reads. It is the queue's
allowlist, and the Projects panel on `/` rewrites it on every Add and Remove — which is what makes those take
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
    "sonnet": {
      "budgetUsd": 3
    },
    "opus": {
      "budgetUsd": 15,
      "jobCapUsd": 30
    },
    "codex-fast": {
      "budgetUsd": 5,
      "tool": "codex",
      "model": "gpt-5.6"
    }
  }
}
```

`tool` is `claude` (the default, and what an entry that says nothing means) or `codex`. `model` is the literal value
handed to the CLI when it differs from the entry's own key — the key is what the picker shows and what a request posts,
so a readable name can front a model string nobody wants to read. No entry carries a `(codex)` suffix in the dropdown:
the entries are called `codex-sol` and `codex-luna`, so the name says it, and each option
sits under a group named after its tool, which says it a second time while the list is open. A model name that does NOT
say which tool it starts is a name to fix here, not something to patch in the label.

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
`model.<step>` fields it always did. What a phase runs on stays one value on the job and the tool is derived from it, so
the picker is read on change (to fill the model in) and written on redraw (to reflect it), never the reverse. Change a
model select by hand and the AI select beside it follows at once. Picking it — or moving a model select by hand — does
reach the server at once, though: the model select it fills is recorded the instant it changes, on a phase that has not
run yet as much as on one that has (see "A model picked for a phase" below). It is drawn only when two tools are
configured — one AI is nothing to choose between — and filling a model in is a script's job, so with scripting off the
pickers and their caption are hidden outright (`<noscript>`) and the five model selects underneath stay exactly as
usable as they are with one.

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

The queue, the worktrees, the wall-clock timeout and all the git handling are one path for both tools. Three things
differ, and all three are visible on the page rather than papered over:

- **A Codex step's budget is not enforced while it runs.** Claude Code takes a `--max-budget-usd` and stops itself;
  Codex has no equivalent flag, so for a Codex entry `budgetUsd` feeds the dashboard's own grant-and-tighten arithmetic
  before the step starts and nothing else. **The wall clock (`timeoutSec`) is the only thing that stops a runaway Codex
  step**, and it is mandatory for every step either way.
- **A Codex step reports tokens, never dollars.** No dollar figure exists anywhere in Codex's output, so the Cost column
  shows the token count and a dash where the money would be — never `$0.00`, which would add up as though the step had
  been free. A job mixing both tools has a
  `spentUsd` covering its Claude steps only.
- **A Codex step has no "Live right now" panel.** That panel's contents come from `claude-usage`, which watches Claude
  Code sessions and knows nothing of Codex threads. The Activity tab works for both: the run's transcript is parsed in
  whichever schema wrote it.

Safety modes are stored the same way for both — the queue keeps Claude's own names, per step, config-only.
`aide-run-spec` translates them for Codex: `bypassPermissions` becomes
`--dangerously-bypass-approvals-and-sandbox`, `acceptEdits` becomes
`--sandbox workspace-write`, and `plan`/`default` become `--sandbox
read-only`. A mode with no entry in that table refuses the run rather than being guessed at. (`codex exec` is
non-interactive and has no
`--ask-for-approval` flag at all — that one belongs to the interactive command — so the sandbox mode is the whole of
what there is to say.)

## Which effort level a step runs at

Every phase line carries an Effort select beside its model select, offering `low`, `medium`, `high`, `xhigh` and
`max` — the plain reasoning-effort levels Claude Code's `--effort` flag accepts — plus a leading, always-present "—"
option for "nothing chosen". `ultracode` is deliberately not offered: it is a Claude-Code-specific setting that turns
on multi-agent workflow orchestration on top of `xhigh` reasoning, not a plain effort level, and offering it here
would let a routine step silently opt into a much larger, multi-agent run.

Unlike the model choice, there is no admin-configured default to fall back to and no whole-job pick: a step with
nothing chosen runs exactly as it always has, and "unset" is a real, resting value the select can show — never a
placeholder standing in for a real name the way the old "default" model option used to. The resolution is `used`
(what the phase actually ran at) over `pending` (an earlier pick, see below) over unset, three tiers where the model
select's own chain has four.

**An effort level picked for a phase survives leaving the page**, the same way a model pick does: the instant a
reader picks one for a phase that has not run yet, the dashboard records it — per spec, per phase — and a run started
later, from a reload, a different browser, or another day, uses it. A phase that has since actually run shows what it
ran at instead. There is no live edit of a running job's not-yet-reached step's effort, unlike the model select: a
reader who wants to change it waits for the current step to finish first.

The chosen level reaches `aide-run-spec` as `--effort <level>`, appended to the `claude -p` invocation only — Codex
has no equivalent flag, and a level chosen for a phase that ends up running on Codex is accepted and silently
dropped, the same "ignored, not refused" treatment the script already gives Codex's other Claude-only knobs. The
level a step actually ran at is recorded in that step's own phase file, as a `- **Effort:**` line beside
`- **Model:**`, and shown on the job's own detail page beside its Model row.

## Global defaults for the AI and model

`/settings` holds the default AI and model per step — Explore, Create, Analyze, Implement, Archive, Manifest and
Reopen. Saving posts to `POST /api/queue/settings`, which validates all seven model names against `modelChoices`,
updates `queue-config.json` atomically while retaining comments and unrelated values, and changes the live defaults
only after the write succeeds. Later jobs use them immediately; jobs already accepted keep their stored choices.

## Running a job on a schedule

A project can name recurring work of its own — a periodic analysis or report — in a `schedule:` list in its committed
`.aide/project.yaml`:

```yaml
schedule:
  - name: nightly-report
    cron: "0 3 * * *"
    prompt: docs/nightly-report.md
    model: claude-opus-5
```

Each entry is a name (becomes the job's `schedule-<name>` tracking key, never a spec folder), a standard five-field cron
expression, and a prompt file's path, relative to the project's own root. A background poll checks every project's
entries and enqueues a `schedule` step through the same queue, runner and worktree machinery every other step uses
whenever an entry is due and nothing is already queued or running for it.

`/schedule` lists every allowed project's entries, flattened into one list (`?q=`, `?sort=` and `?dir=` filter and
sort it); `/schedule/new` makes an entry and `/schedule/<project>/<name>` is one entry's own page (Overview and
History tabs), with `/schedule/<project>/<name>/delete` its delete confirmation. A run's own recorded output is
served as static files under `/schedule-output/<project>/<key>/...`. The pages post to
`POST /api/queue/schedule` (create), `POST /api/queue/schedule/<project>/<name>` (edit), and
`POST .../enabled`, `.../run` and `.../delete` (toggle, fire now, remove); `GET /api/queue/schedule/cron-next`
previews a cron expression's next fire time for the form.

`model:` is which of the queue's own `modelChoices` every fire of that entry runs on — one name for the whole entry,
since a scheduled job is a single `schedule` step and has no phases to tell apart. It is picked on the New-job and Edit
forms the same way a spec's model is picked on the Specs page, with the AI beside it deriving from it; a name the queue
config does not grant is refused at the form rather than at 03:00. An entry that names no model is enqueued without one
and the queue config's own `schedule` default decides. "Run now"
reads the same field, so pressing it tests what the schedule actually does. The step sends the named file's contents to the model verbatim, with no aide skill or spec folder
involved at all; write it the way you would write a prompt by hand.

**Due is computed from the most recent fire time alone — there is no backfill.** If the dashboard is down across a whole
scheduled window, that occurrence simply does not happen; nothing catches up retroactively the next time the poll runs.
A project's own page shows each entry's name, cron expression, prompt path and next computed fire time, and the projects
overview names the soonest across a project's entries.

**A cron expression is evaluated in the SERVING HOST's local timezone**, the same as an ordinary crontab — there is no
`tz:` field. Check what
"3am" means on the machine actually running the poll before relying on it across a daylight-saving transition.

**A schedule is a committed, reviewed setting, like `codeLanding` — it has no `.aide/config` fallback.**
Creating, editing, enabling/disabling or deleting an entry through `/schedule`'s own forms commits and
pushes the change from the dashboard's own checkout immediately, the same way a spec's own Save does — no
manual git step. A save that cannot be committed or pushed (no reachable origin, a checkout that cannot
fast-forward) is refused with the reason on the page, and the manifest is left exactly as it was rather
than holding an edit nothing recorded. A `prompt:` path that would resolve outside the project root (an
absolute path, or one whose `..` climbs past it) is dropped at parse time, and a malformed `cron:` drops
that one entry — never the whole list.

## How many run at once

`concurrency`, two by default. **1 to 4 is accepted and anything else — missing, non-numeric, out of range — falls back
to two**; it does not clamp, because `concurrency: 9` would otherwise have to be both 4 and 2 depending on which rule
you read. The upper bound is the only thing between a typo in this file and sixteen `claude` sessions on the serving
host.

`1` runs one job at a time, so backing out of concurrent runs is a config edit and a restart.

Two jobs for the same spec are never started at the same time — analyze and implement for one spec are ordered by
nature. Nor are two `archive` steps in the same project: both land into the code root's main, and the second is held
`queued` with the reason on its row until the first has landed. Beyond that the jobs are genuinely independent: each `aide-run-spec` run works in `git
worktree` checkouts of its own, so the main checkouts never leave their default branch and no run can see another's.

## The dashboard's own checkouts

**The checkout a run is cut from is not the one a person edits.** Cutting a worktree from
`<projects root>/<project>` — the directory Add clones into and the directory somebody works in — puts two writers on
one tree: the runner puts every root it touches onto its default branch before it starts, and a landing merges and
pushes from the same tree, while a person edits it meanwhile. The per-repo lock serializes the dashboard against
itself; nothing serializes it against a person's own git client, and nothing can.

So the dashboard keeps clones of its own, under
`~/aide-dashboard-checkouts/<project>/` — `code/`, plus `specs/` when the specs root is a separate repository. One per
project, never one per run;
`--dashboard-checkouts <dir>` moves them. They are made the first time they are needed, by cloning the person's
checkout's own `origin`, and reused ever after. Everything that MUTATES goes there: `aide-run-spec
--project-dir`, a landing's merge and push, Save, Update, the dependency gate's fetches, the drift poll. The person's
checkout is read for the project list and the manifests, and is otherwise asked one read-only question ever — which
origin to clone from.

**The spec list itself is read from the dashboard's own checkout, not the person's.** Every reader-facing
listing —
`GET /projects/:name`, `GET /projects` and the home page's queue rows, archived rows included — lists from
`resolvedCheckouts.get(project)?.specs`
when the dashboard's own clone exists, falling back to the person's checkout otherwise (a new project, or one whose
clone failed). This is the same clone `aide-run-spec` resolves a spec folder against, so a folder that only exists in
the person's checkout, committed but never pushed, does not appear in the list — a row for it would offer a step that
fails with `unknown spec: ... (not under
<dashboard-checkout>/specs/<project>)`. The fetch that keeps the dashboard's clone current happens inside
`refreshSpecCaches`'s existing schedule, never inside a request, so this costs no git spawn on the render path.

Two consequences worth knowing:

- **A landed run and a Save do not show up in a person's own checkout until they pull it.** Nothing auto-syncs into
  it, deliberately: an auto-pull would recreate exactly the collision this removes. The specs cron pulls it every two
  minutes, which is what closes the gap in practice.
- **`.aide/config` is gitignored, so a clone never carries it.** It is copied from the person's checkout on every
  ensure — it is the file an operator edits by hand between merges, and a copy taken once would go on answering with
  whatever was true the day the clone was made.
  `AIDE_SPECS_PATH` is the one key that does not survive the copy: it names a directory in the person's checkout, and is
  replaced with the dashboard's own specs. The file is written once, finished, through a rename — a run starting for
  another job never reads a copy that still names the person's path.

A project whose checkout has no `origin` gets no clone of its own. It runs in the person's checkout, and its readiness
line says so, so the one project where a run and a person's editing can still
meet is named rather than silent.

## How a run touches the repositories

**`aide-run-spec` branches EVERY repo it touches, not just the project.** An `analyze` step changes only the specs
repo, so branching the project alone would leave the analysis committed on `main` — the one thing `push branch` exists
to prevent. A repo whose HEAD did not move during the run is not pushed at all, and the compare link is built from the
repos that actually changed (`branchUrls` in the result; `branchUrl` keeps the single most interesting one). **HEAD
movement is the test, not `changedFiles`** — that field counts only what the run's own commit loop found uncommitted,
and a step that commits its own work (archive does) leaves it at `0` with real commits on the branch.

**It branches them in `git worktree` checkouts of its own**, under `$HOME/aide-worktrees/<project>/<spec>/`. The real
checkouts are put back **onto** their default branch before the worktrees are made and never leave it, so several runs
can go at once, the dashboard's spec list never describes whatever branch a running job is on, and a person can use the
checkout meanwhile. Two consequences worth knowing before changing anything here:

- The result's `repos[].root` is the MAIN checkout, not the directory the work happened in — the dashboard spawns git
  in that path after the run is over, and a worktree path is deleted when the run ends. `repos[].worktree` carries the
  throwaway one.
- A worktree carries tracked files only, so `.venv` and `dashboard/node_modules` reach it through `worktreeLinks:` in
  the COMMITTED `.aide/project.yaml` — symlinked in, and excluded from `git add -A` by pathspec, because a `dir/`
  gitignore rule does not match a symlink. `.aide/config`'s `AIDE_WORKTREE_LINKS` is still read when the manifest names
  none — the manifest wins where both do, and the run reports which file it read (`worktreeLinksSource` in the result
  blob, and a line on stderr).

**A run reaches the project and its specs root, and nothing else.** A repo the run was not told about is not touched,
and there is no flag to name a third one. A spec that has to change two projects at once needs that naming built,
deliberately.

**`aide-run-spec` runs from a private copy of itself, and that is load-bearing:** an `implement` step reinstalls aide,
which copies the script over itself while bash is still reading it by byte offset. The copy's marker holds its own
path and is unset before `claude` starts — a bare exported flag would be inherited by `claude`, and the next nested
invocation would delete the installed script.

**`aide-run-spec`'s shebang finds `/bin/bash` on this machine, and that is bash 3.2 — `mapfile` is bash 4 and is not
available.** Anything added to this script that wants an array built from multiple lines has to set it via repeated
`array+=(...)` instead.

## Notifications

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line of JSON on stdin (claude-usage's contract,
copied so one wrapper can serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a second later, and absent
unless configured. `deploy/notify-slack.sh` is the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
```

## Live runs

A spec's row shows a live indicator — session id, and (see below) liveness and cost so far — while an `/aide-*`
command is actually running against it. Two things feed that, and most people never have to touch either: the queue
side works with nothing configured.

**The queue's own runner is the producer for anything it queued itself.** When it spawns a step, it hands the child
`AIDE_RUN_URL` pointing at this server's own `POST /api/aide-run`, derived from the port it actually bound — so a
headless run's phases reach the row automatically. Before that existed, every phase report from a headless step
exited silently and the row sat at `phase: null`.

**A Claude Code `UserPromptSubmit` hook is the other producer, and it is a person's own, opt-in setting** — for
reporting an `/aide-*` command run BY HAND, in an interactive terminal, outside the queue entirely. `aide-emit-run`
(installed by aide to `~/.local/bin`) POSTs one small event per slash-launched command — host, session id, command,
spec, project; never the prompt text. It is inert until `AIDE_RUN_URL` is set; an `AIDE_RUN_URL` already in the
server's own environment (the case above) is left alone, so pointing reporting at another sink still works. aide's
`install.sh` prints the ready-to-paste block; it lives in `~/.claude/settings.json` as:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "AIDE_RUN_URL=\"https://<serving-host>.<tailnet>.ts.net/api/aide-run\" '/Users/<you>/.local/bin/aide-emit-run'"
          }
        ]
      }
    ]
  }
}
```

The address in that block is the HTTPS one; the `:8788` address answers on the serving host itself and nowhere
else. A bookmark carrying `?token=` works on the HTTPS address, and a browser signed in on the old one signs in
once more, because the token cookie belongs to the origin it was set on.

**`GET /api/aide-runs` is these runs in flight, as JSON.** No page renders it directly: the spec list shows every
queued run per row, and interactive sessions are claude-usage's own page. Runs are kept in memory (LRU 512) and
mirrored to `~/aide-dashboard/aide-runs.json` so restarts keep them.

## What a finished step publishes

`push` in the queue config, passed on to `aide-run-spec`:

- `none` — commit locally and stop. Review by fetching from the host that ran it.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs repo's own commits. The specs page and the
  notification then link to the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving host; a broken `gh` records the error and leaves
  the run successful.
