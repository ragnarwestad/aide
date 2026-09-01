# Running specs

How a spec becomes a run: the queue, the runner, the checkouts it works in, and how each
step's branch is landed.

## Table of contents

- [Making a spec from the page](#making-a-spec-from-the-page)
- [The token](#the-token)
- [Caps](#caps)
- [Which AI runs a step](#which-ai-runs-a-step)
- [Running a job on a schedule](#running-a-job-on-a-schedule)
- [Adding and removing a project](#adding-and-removing-a-project)
    - [Whether a run can start there](#whether-a-run-can-start-there)
    - [A page render never waits on the network](#a-page-render-never-waits-on-the-network)
    - [What Add finishes itself](#what-add-finishes-itself)
- [How many run at once](#how-many-run-at-once)
- [The dashboard's own checkouts](#the-dashboards-own-checkouts)
- [Notifications](#notifications)
- [Telling claude-usage a branch landed](#telling-claude-usage-a-branch-landed)
- [What a finished step publishes](#what-a-finished-step-publishes)
- [How the list reads](#how-the-list-reads)
- [What the script adds](#what-the-script-adds)
- [The page changes when something changes](#the-page-changes-when-something-changes)
- [A spec's date does not move, and a phase says how long it took](#a-specs-date-does-not-move-and-a-phase-says-how-long-it-took)
- [Branches, and merging them](#branches-and-merging-them)
- [Archive resolves the conflict itself](#archive-resolves-the-conflict-itself)
- [Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished)

---

The spec list runs aide workflow steps headless on this machine: one job at a time, each step a
`claude -p "/aide-<step> <spec>"` process started by aide's `aide-run-spec`. A job is an ordered list of steps; a step
that ends either advances the job, parks it for approval, or ends it.

One way in: the spec's own row, expanded — collapsed is the default;
see [How the list reads](#how-the-list-reads). It carries a checkbox per phase, a model dropdown, and one Run button
that queues everything ticked as a single job in the workflow's order — the browser submits checkboxes in the order they
are drawn, so ticking `implement`
before `analyze` still queues analyze first. After the model, quiet and small-text on that same controls line — no
disclosure to open — sits the one thing nobody sets every time: which other repos the job will touch. There is no "stop
for approval between steps" box: a reader who wants to stop between steps runs one phase at a time.

**Every phase the job in flight was queued with shows its box disabled**, not merely the step it has reached, because
the queue would refuse any of them anyway (see
[the duplicate guard](#notifications)). A box left tickable for a step the job already holds is a box whose press
answers "already running on this spec". The box says why on hover ("analyze is running"), in the same words the state
chip uses.

What is pre-ticked is every phase the spec has not had: a press takes the spec as far as it can go, and
unticking a box is how a reader says to stop somewhere. The button names the FIRST of the ticked phases and not the
whole list — a label is a name, not a summary, and the boxes are on the row that the press acts on. A phase already done
is left unticked; ticking it anyway is a rerun, and no rule stands in the way. `archive` is the exception the rule
needs: a spec still on this list is by definition not archived, so it counts as outstanding however the history reads,
and the pre-ticked set is therefore never empty.

**Which phases a spec has HAD is read off one line, and nothing else:**
`- **Workflow steps completed:** create, analyze` in the Tracking info of its `4-status.md`. Each step
writes its own name there once it has succeeded, and `core/rules/spec-structure.md` § 4-status is where that contract
lives. Nothing is inferred from a file's size, from a heading being present, or from a percentage — each of those is a
proxy for the question rather than an answer to it, and a proxy that reads a spec as analysed before analyze has run
sends the next step off an empty template.

The percentage keeps its own job: it says how far the TDD phases
INSIDE implement have got, which is a different question from whether implement ran. It is not shown on the row —
implement is ONE step, so the figure reads 0 until implement finishes and 90-something after, never
anything between, and two specs of entirely different sizes both read "0% done".
The spec's own page shows it in full.

A status file carrying no such line has had nothing as far as the page is concerned. That is deliberate: a spec
that reads as unfinished is visible and is fixed by running the step, where a silent guess is neither.

The State column answers what a reader came to find out, and its FIRST line is one of two things, always: the
verb for what is happening — "analyzing", "implementing", "implementing queued" — or, once nothing is running, the
resting state and what can happen next —
"ready for implement", "archive held back — the Slack webhook", "done — nothing waiting on you". The bare words
"done" and "queued" are neither, and neither appears alone: "done" says nothing about WHAT was done, and "queued"
nothing about which step is waiting, while both facts are known.

There is no second line telling a reader to press the button beside it. The row's
button stands next to the badge and NAMES the phase it would run. The page says what IS; the controls say what can be
done.
The pips, the chip and the branch marks each answer their own narrower question beside it.

The branch marks answer WHERE the work is and whether it landed, and nothing else. An unmerged repo reads "waiting for
archive" — one answer, whether or not a step is running for that spec, because the branch is open either way and
`archive` is what lands it. It never echoes the running job's verb: the State column beside it says that already, and
on a row with two repos the verb would appear three times.

The four sentences about how runs work on this machine sit behind a shut "How runs work here" disclosure, like the
New-spec panel and for the same reason: the list is what people come here for. The runner-unavailable notice is NOT
folded in with them — "nothing here spends money" must not need a click.

There is no form above the table with a spec dropdown of its own. The row does everything such a form could, and a
dropdown could not stay current: the row refresh deliberately replaces the ROWS alone, so a half-set control is never
wiped — and a spec created since the page loaded would be in the list and not in the dropdown.

## Making a spec from the page

Every spec that exists is a row, and every row runs. A spec that does not exist yet has no row — so above the table
there is a "New spec"
button, and it is a plain link to `/new`. That page is the form and nothing else: a project, what the spec
builds on, a title, a description, and two actions — Create, which posts to
`POST /api/queue/create` and returns to the list, and Cancel, which returns having done nothing. Create queues an
ordinary job whose single step is `create`, and the run is guarded, budgeted and timed exactly like any other.

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

When the step succeeds the dashboard **lands the branch itself** and renames the job to the real folder. It was the
first step to do so, and it is not a convenience: the list shows what is on disk in the main checkout, which every run
keeps on its default branch, so a created spec that is only pushed to a branch appears nowhere at all. A landing that
fails leaves the provisional key in place and says which repo and why. **While any job is landing the scheduler starts
nothing at all**, whatever the concurrency is set to: a landing merges into the shared main checkout, which worktree
isolation does not cover.

The list holds SPECS, not the machine's whole run history: a spec that has been archived leaves the page along with the
jobs it had. Nothing is destroyed — `/api/queue` still returns every job and `/specs/<id>` still renders each one. A
project the server knows no specs for at all keeps every row it has: an empty spec list means "we cannot tell", never
"everything here is archived".

A spec's row is collapsed by default: name, title, one status line, the five phase pips, and at most one action button.
The four phase lines and every control — phase checkboxes, model dropdown, the also-touches field, Run, Cancel — sit
behind the same chevron in front of the name. Expanding is a link and lives in the query string
(`?open=<project>/<folder>,…`), which is what makes it survive the table's own row refresh, what makes it work with
JavaScript switched off, and what keeps the row a person just acted on open across the swap/redirect that follows their
own submit.

Every control here is a plain form first: ticking phases and pressing Run works with JavaScript switched off, and so do
Cancel, Create and expanding a row — each posts its form and follows a 303 back to the list. `queue-client.ts` is a
layer ABOVE that floor, never the mechanism (see
[what the script adds](#what-the-script-adds)). It cannot `import` anything: `queueClientScript()` runs
`Bun.Transpiler.transformSync` over it and inlines the result into a plain `<script>` tag — that transpiles, it does not
bundle. An
`import` survives as an ESM import inside a classic inline script (a 404, since this server does not serve that path),
and an `export` is a syntax error. Any shared, unit-testable browser module needs a bundle step or a `type="module"` tag
first; the expand/collapse link was built to need neither.

The page is called Specs, not Queue. That a queue orders the runs is an implementation detail — `QueueStore`,
`/api/queue`, `QUEUE_PROJECTS`
and the rest keep the name; what a reader reads does not.

Nothing is guessed at across a restart: the runner spawns detached, in its own process group (measured: such a child
survives
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
`Strict` the dashboard installed on a phone opened on "unauthorized"
while the same browser was signed in (measured on a Samsung S23+). `Lax` is
still withheld from a cross-site POST, which is what `Strict` was guarding here, and every form on this page posts
same-site. Tightening it again breaks the installed app and nothing will say so until someone opens it.

A cookie already in a browser is NOT rewritten by this change: a reader who signed in before it has to open
`/?token=<the token>` once more.

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
    "aide-dashboard"
  ],
  "notifyCommand": [
    "/Users/<you>/aide-dashboard/notify-slack.sh"
  ],
  "mergeEventUrl": "http://localhost:8787/api/merge-event"
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
and `--tool` from that one entry (`runnerArgv`, `src/serve.ts`). There is no row-wide AI select: one that filtered the
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

`model:` is which of the queue's own `modelChoices` every fire of that entry runs on — one name for the whole entry,
since a scheduled job is a single `schedule` step and has no phases to tell apart. It is picked on the New-job and Edit
forms the same way a spec's model is picked on the Specs page, with the AI beside it deriving from it; a name the queue
config does not grant is refused at the form rather than at 03:00. An entry that names no model is enqueued without one
and the queue config's own `schedule` default decides, which is what every entry did before the field existed. "Run now"
reads the same field, so pressing it tests what the schedule actually does. The step sends the named file's contents to the model verbatim, with no aide skill or spec folder
involved at all; write it the way you would write a prompt by hand.

**Due is computed from the most recent fire time alone — there is no backfill.** If the dashboard is down across a whole
scheduled window, that occurrence simply does not happen; nothing catches up retroactively the next time the poll runs.
A project's own page shows each entry's name, cron expression, prompt path and next computed fire time, and the projects
overview names the soonest across a project's entries.

**A cron expression is evaluated in the SERVING HOST's local timezone**, the same as an ordinary crontab — there is no
`tz:` field. Check what
"3am" means on the machine actually running the poll before relying on it across a daylight-saving transition.

**A schedule is a committed, reviewed setting, like `codeLanding` — it has no `.aide/config` fallback and no edit
form.** Change it by editing
`.aide/project.yaml` directly. A `prompt:` path that would resolve outside the project root (an absolute path, or one
whose `..` climbs past it) is dropped at parse time, and a malformed `cron:` drops that one entry — never the whole
list.

## Adding and removing a project

The Projects panel on `/projects`, behind the queue token like every other mutating control. It sits under the listing
it changes, which it can because the overview is a served page with a server behind it to check a token against. Add
takes a name plus either a git URL (cloned to
`<projects root>/<name>`) or a path to a checkout already there, and optionally a specs root and a one-line description.
It writes a minimal manifest — the name and that description, nothing else — only when the checkout has none; filling in
the rest is `/aide-manifest`'s job afterwards, and the form says so.

### Whether a run can start there

An Add that answers "added" and nothing else leaves the things that decide whether `aide-run-spec` will START
invisible until Run is pressed and the run refuses. A project can be on the allowlist, cloned where the
form said and carrying a minimal manifest, and still be unable to run: a feature branch whose upstream is gone, no
specs root named, no worktree links set.

So the answer says two things, and keeps them apart. `ok` means the registration completed. `readiness.canRun` means
a run would start. Only the first is commonly true of a fresh add, and folding them into one would report a checkout
that IS on disk as an add to try again.

The form asks for one thing beyond the registration: **Worktree links**, the space-separated repo-relative paths a run has
to symlink into its worktree because git does not carry them (`node_modules`, `.venv`). A run works in a `git worktree`,
which checks out TRACKED files only, so a project whose test command lives behind a gitignored path fails in every run
for a reason that has nothing to do with its change. Nothing can derive which paths those are, so the form asks; leaving
it empty is normal and is reported as a note rather than a fault.

Most of these checks are `aide-run-spec`'s own prerequisites, read-only, taken after the Add has written its files —
the `.aide` written a second earlier is part of what the runner will see. Two rows are not: `gitRoot`'s
"inside a bigger repository" case and `specsRepo` are this dashboard's own, stricter reading — `aide-run-spec` does
not refuse on either today, a known asymmetry recorded in
`tests/fixtures/project-readiness-prerequisites.json`'s own comment rather than pinned against the runner.

| Check           | Blocks a run when                                                                                                        |
|-----------------|----------------------------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository at all — or, in this dashboard check only, is inside a bigger one (`aide-run-spec` does not refuse that second case) |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory           |
| `specsRepo`     | (dashboard only) that specs root is in no git repository — `aide-run-spec` silently leaves such a root out of what it commits, rather than refusing |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out         |
| `worktreeLinks` | a configured entry leaves the repository, or names a path that is not there                              |

`worktreeLinks` is read from the project's committed `.aide/project.yaml`
first and from `.aide/config`'s older `AIDE_WORKTREE_LINKS` second — the same order, and the same winner, as
`aide-run-spec` itself reads them in.
`tests/fixtures/worktree-links-precedence.json` is the one table both sides are tested against, because the two are
written independently and nothing else would stop them drifting.

`tests/fixtures/project-readiness-prerequisites.json` is the equivalent table for `gitRoot`, `specsRoot`,
`defaultBranch` and `worktreeLinks` themselves: a test on each side reads it and asserts `aide-run-spec` really
refuses what this page says it does, for the same identifier and the same blocking answer.

`defaultBranch` is asked of **every** repository a run touches — the project's, and the specs repo when the specs live
elsewhere — because the runner refuses on it in any of them. A checkout on a feature branch is reported and does not
block: the runner puts the checkout on its default branch itself.

There is no `clean` check: a run reads origin's default branch into a worktree of its
own, so what somebody left uncommitted in the main checkout reaches nothing, and the runner does not refuse over it
either.

Nothing in the assessment mutates anything: no branch is switched, no directory made, no file committed. That is also
why the answer can go stale. A default branch resolvable when the project was added is one somebody can delete or park a
second worktree on a minute later, and Run says so at the time — this is a preflight check, not a promise.

The result is shown where Save was pressed. With script it goes into the form's own slot and the page stays put, because
the Specs root and Worktree links fields on that page are usually what fixes it and saving again re-assesses. Without
script the redirect carries the same sentence to `/projects` in the query string, where the page renders it. The
sentence is built once, on the server, so the two modes cannot drift apart.

### A page render never waits on the network

`assessProjectReadiness`, above, only ever touches disk — `rev-parse`,
`show-ref`, `symbolic-ref`, `worktree list` — and that was already the rule. The commits-behind-origin count beside it
on the same row broke it: `BranchStatusChecker.commitsBehindOrigin` ran a real `git fetch
origin` (4 s timeout) inline in the `GET /projects` handler on every cache miss, which is every project on server boot
and every project again once its 30 s cache entry expires. Six configured projects made the page 1.83 s against
0.04-0.10 s for `/`, and it gets slower with every project added.

The fix moves the fetch off the request path entirely rather than shortening it: `refreshDrift()` walks the configured
projects and calls
`commitsBehindOrigin` on an `.unref()`'d `setInterval`, the same shape as the runner's own tick and the SSE keep-alive
ping, cleared in
`stop()` beside them. The request handler calls a new synchronous
`peekDrift()` instead, which reads `commitsBehindOrigin`'s existing cache and never spawns git. A project the poll has
never reached yet returns `checkedAt: null`, and the row says "origin drift not checked yet" rather than showing nothing
or waiting for an answer — the reader sees a labelled stale number instead of a spinner, never a page that blocks on
GitHub being reachable.

### What Add finishes itself

Skjer again, the same afternoon: Add reported success and a run still could not start, and making one possible took
three hand steps — `mkdir`
of the specs root and its `archive/`, `AIDE_SPECS_PATH` written into
`.aide/config`, and `.aide/` appended to `.git/info/exclude`. Two of those were things the form knew and did not do, and
one was a remedy named nowhere at all.

**The name is the directory's, not the typed one.** A project is discovered as a directory under the projects root, and
`discoverProjects` reads its name off that entry and out of no manifest — so a project registered under a name that
differs could never be found again. Where a pick and a typed name disagree — `skjer` picked, `Skjer` typed — the pick
wins, rather than a refusal naming
`<root>/Skjer`, a path that does not exist either. The Name field says what it is actually for:
naming the directory a **clone** creates. A full path typed by hand is not the picker, mismatch refusal
and all.

**A specs root that is not there is made.** Writing the path into `.aide/config` and then reporting the project as
unable to run over a directory that is not there is a refusal over a path known the moment it was written. Add
creates it, with the `archive/` beside it that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the real state either way.

**Nothing is appended to `.git/info/exclude`.** No run refuses over a dirty tree, so an untracked manifest Add has
just written needs no getting out of. Where a manifest belongs
is a question with two answers — in git in a project of one's own, out of it in an employer's checkout — and nothing an
Add can decide; it is not a question anybody is forced to answer before running anything.

**Worktree links are suggested from the checkout's own `.gitignore`.**
Nothing can derive which gitignored paths a project's commands need, which is why the field exists — but the checkouts
on offer name the candidates in a file the reader had to go and open. The field carries a
`<datalist>` of the literal, top-level entries from every offered checkout's `.gitignore`, deduped: a suggestion the
reader may ignore, needing no script, like every other control on this page. Globs, negations, comments and nested paths
are left out — they are not values
`worktreeLinks` can take. A suggestion is not an endorsement either: a
`.gitignore` routinely lists `build`, `dist` or `.gradle` beside
`node_modules`, and those are refused — with the path named — because a link is one shared symlink, and a build writing
through it would collide with every other run's.

**And both fields are PROPOSED where they can be worked out.** A checkout's own lockfile says which package
manager owns its dependency tree, and each of those puts that tree in one well-known gitignored directory: `bun.lock`/
`package.json` proposes `node_modules`,
`pyproject.toml`/`requirements.txt` proposes `.venv`, both propose both. The Specs root is proposed from how the
projects already added lay theirs out — at least two sharing a `<parent>/<projectName>` pattern proposes
`<parent>/<newName>`, and fewer than two is an example rather than a pattern. Anything that cannot be worked out is left
blank, never guessed. With exactly one checkout on offer the answer is unambiguous and goes straight into the fields, so
a browser with no script gets the help too; with several, the proposals ride on the form and the pick fills them in.

**A project's settings can be changed after it is added.** Its own
`/projects/<name>` page keeps the current values and the read-only settings overview visible while Edit opens Specs
root, Worktree links and Code landing inline. Save and Cancel return to the same project page. The same writer still
saves the specs path to `.aide/config` and the other two settings to
`.aide/project.yaml`; unchanged values are not rewritten. The old
`/projects/<name>/settings` address redirects to the project page.

**And the readiness note is recomputed on every visit.** Each row that cannot run carries its own note, beside the
Settings link that acts on it — a note shown once, in the query string of the redirect an Add lands on, leaves an
operator who did not act on it there no way to rediscover what was missing except by starting a run and having it
refused.

Remove takes the project off the allowlist and off this dashboard, and that is all it does: the checkout and the specs
root stay on disk, untouched. It asks for the project's name to be typed back, and the server refuses anything but an
exact match — the browser turning the button off until it matches is a convenience over that check, not the check
itself.

The generated `projects.html` carries neither control: it is a redirect to the served page now. The generated pages stay
open, which means they carry nothing that needs the token — and both of these actions do.

A server started without `--root` has no projects root to list or add to. Its `GET /projects` redirects to the generated
`projects.html`
instead of rendering an empty listing, and its nav goes on naming that file — an empty page would read as "no projects
on this machine" rather than "this server was never told where they are".

The daily cap counts the budgets of the steps **already in flight**, not only what has been recorded. Recording happens
at completion, so with several slots N jobs would otherwise each pass the same check on the same numbers, and the cap be
exceeded by (N−1) budgets before anything noticed. A job the daily cap holds back does not block the queue either:
a cheaper job behind it may take the free slot.

## How many run at once

`concurrency`, two by default. **1 to 4 is accepted and anything else — missing, non-numeric, out of range — falls back
to two**; it does not clamp, because `concurrency: 9` would otherwise have to be both 4 and 2 depending on which rule
you read. The upper bound is the only thing between a typo in this file and sixteen `claude` sessions on the serving
host.

`1` runs one job at a time, so backing out of concurrent runs is a config edit and a restart.

Two jobs for the same spec are never started at the same time — analyze and implement for one spec are ordered by
nature. Beyond that the jobs are genuinely independent: each `aide-run-spec` run works in `git
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
  rewritten to name the dashboard's own specs.

A project whose checkout has no `origin` gets no clone of its own. It keeps running exactly as it did before this — in
the person's checkout — and its readiness line says so, so the one project where a run and a person's editing can still
meet is named rather than silent.

## Notifications

There is no stop between steps and no way to ask for one. Every step lands its own work, so there is nothing between
two steps for anyone to weigh, and no form on the page can park a job for approval. A
request naming `gateAfter` is accepted and the field ignored, like any other unknown key.

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line of JSON on stdin (claude-usage's contract,
copied so one wrapper can serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a second later, and absent
unless configured. `deploy/notify-slack.sh` is the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
```

## Telling claude-usage a branch landed

claude-usage builds its shipping-pipeline ledger out of transcripts: a merge reaches it as a `gh pr merge` inside a Bash
tool call, and a review as the prompt `/aide-analyze`'s review step writes. The reviews already arrive with nothing
configured. The merges never do — the dashboard merges in its own Bun process, so no session writes a
transcript to read one out of, and a merge made by hand from a terminal is `git merge`
rather than `gh pr merge`. The ledger therefore cannot answer the question it exists for, "was this merge reviewed?",
about any of our work. So the dashboard says what it did.

`mergeEventUrl` in the queue config is where it says it. Every repo a step successfully lands — `create`, `analyze` and
`archive`, code roots and specs repos alike — sends one POST with a flat JSON body:

```json
{
  "project": "aide",
  "specFolder": "158-a-merge-is-an-event-claude-usage-can-see",
  "branch": "aide/158-a-merge-is-an-event-claude-usage-can-see",
  "repoRoot": "/Users/<you>/projects/aide-specs",
  "step": "archive",
  "jobId": "1f2e3d4c",
  "timestamp": "2026-08-21T10:00:00.000Z"
}
```

**Absent unless configured**, like `notifyCommand`: with no
`mergeEventUrl` the dashboard makes no request at all, which is what every instance does today. **And never fatal** —
the merge already happened, so a sink that refuses or times out is written to the log beside it and nothing else. One
request, bounded at 1.5 s, no retries.

The receiving end is claude-usage's to settle: `pipeline_event` is keyed on a transcript uuid and a session id, and a
merge reported by a machine has neither. Leave `mergeEventUrl` unset until that endpoint exists.

## What a finished step publishes

`push` in the queue config, passed on to `aide-run-spec`:

- `none` — commit locally and stop. Review by fetching from the host that ran it.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs repo's own commits. The specs page and the
  notification then link to the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving host; a broken `gh` records the error and leaves
  the run successful.

## How the list reads

One row per spec, not per job, and collapsed by default:
name, title, one status line, the phase pips, and at most one action button. Expanding it (the chevron in front of the
name, `?open=…`)
reveals the workflow phases underneath, always in that order, so how far a spec has got is readable without counting
rows, plus the run controls (phase checkboxes, model, the also-touches field after it, Run, Cancel). A phase never run
shows a muted "not run yet". A phase run more than once shows its LATEST attempt with the count beside it, because a
re-run is ordinary.

The first line is `create` — history, not a control. It reads done once `4-status.md` records it, which is
what `/aide-create`
writes into a new spec; a spec with a create job in the queue's history additionally shows that run (state, model, time,
cost, link), and a spec made by hand shows the line inert, the same way any phase run outside the
queue does. It has no checkbox. It has a pip like the other four, but not on their rule: `done` comes from the git
history, which counts only the runner's
own commits, so a spec written by hand has no create commit and would show grey. Create gets the LINE's rule instead,
and it has only two states — a spec that exists was created, so the pip is past unless a create job is running right
now.

**The running phase's own pip carries the motion.** The closed row is the whole interface for
the ordinary case, so "this is running" cannot live on a phase line that only exists once a row is expanded — a reader
watching the collapsed list would see no
motion at all. The signal is `.pip.now`, the running phase's marker: it already says WHICH phase without a word
(drawn in
`--accent`), so a lighter band skimming across it left to right, in the direction the four pips already run, adds "and
it is alive" in the same mark instead of a second element. A pulse was rejected — on a 14×4 bar it reads as an alert,
not as work in progress. Every running row animates on one shared timing rather than each starting when its row was
drawn, so several at once move together instead of shimmering at random. `phaseChip`'s `busy` option is gone along with
`.phase.busy` in
`css.ts` — `SPINNER` itself is used by `btn()`'s busy variant and by `queue-client.ts`'s in-flight-press
spinner, a different fact with a different lifetime (see [what the script adds](#what-the-script-adds)).

`prefers-reduced-motion` is honoured here: `.pip.now` drops the animation and holds
`--accent` still, so a machine set to reduce motion still tells a running phase from a waiting one, just without the
movement.

The header carries what belongs to the spec rather than to one run, unconditionally (collapsed or expanded): the summed
cost, one link per repo the spec pushed to, and the state that matters most right now — whatever is in flight, else the
most recent outcome. A collapsed row's single action button — the way out of a conflict, where the refusal is — sits
there too, once per spec instead of once per job; Cancel is only offered once the row is expanded.

## What the script adds

The page's own browser code does one thing to the controls: it keeps the reader where they are. Every one of them — Run,
Cancel, Create — is a real `<form>` that works on its own, and the script only intercepts.

- **A press changes the button at once, without changing its width.**
  It disables, gains the `busy` look and a spinner ahead of its own label — the label itself stays put, only
  the `title` carries the pending word ("starting…", "cancelling…", "queueing…",
  "merging…", "creating…"), read from `data-pending` beside the label. On a row control the same
  press swaps that row's own `.phases` chips for the same spinner, holding their width with
  `style.minWidth` so the buttons beside them do not shift — freed again once the boxes come back. The `finally` block
  that undoes all of this runs under the same `isConnected` guard the button already had, which matters because
  `swapRows()` returns without touching
  `#jobrows` when the rows re-fetch itself fails: without that guard a row can get stuck holding a spinner for a request
  that is already over. The `.phases` boxes are Run's own form fields — the ticked checkboxes live there — so the swap
  only happens after `new
  FormData(form)` has already read them; writing the spinner in first would silently queue a job with no phases at all.
- **The answer lands in place.** `#jobrows` is re-fetched and swapped; the page does not reload, does not scroll to the
  top, and does not wipe a control someone is half-way through setting.
- **A refusal does not navigate either.** The reason and the spec it belongs to are written into the address bar with
  `history.replaceState` — the same `?error=&errorSpec=` query the server's own 303 would have built — and the rows are
  re-asked with it, so the message comes back rendered on the spec's own row. The filter, the sort and the fold ride
  along in that query, which is why a refusal cannot throw the reader back to the default list.
- **The New-spec form answers for itself.** It sits outside `#jobrows`
  on purpose (a half-typed description must survive the row swap), so it is bound directly rather than by delegation,
  and a refused create has no row to land on — the spec it named was never made. Its reason is written beside the form;
  on success the form empties and shuts, and the new row arrives with the swap.

Without the script every one of those falls back to a form post and a 303 to the list: slower, and one full page load,
but functionally complete.

## The page changes when something changes

The list does not re-ask the server on a timer. Polling every five seconds and redrawing whether anything had happened
or not costs twice: a reader with the browser's own tools open has the ground move under them twelve times a minute,
and a step that finished waits up to five seconds to show. The server says when instead.

`GET /api/queue/events` is held open and answers `text/event-stream`. It is behind the queue token like every other
route on this surface, and `EventSource` reaches it with the cookie the page was given on load — it cannot set a header,
so the cookie is the whole of its auth. The event it writes is a bare `changed` signal with no payload: the browser
already knows how to fetch a fresh `#jobrows`, so
`renderQueueRows` stays the one place a row is described and there is no second format to keep in step with it.

Two things broadcast, because two independent stores feed a row.
`QueueStore`'s `onChange` hook covers every write to a job — the runner's step transitions, the page's presses, the
API's enqueues — because `insert`, `editTailStep` and `update` are the only three ways in. `POST /api/aide-run`
broadcasts separately: cost, subagent count and live state arrive there and are invisible to the queue's store, so a
push driven by the store alone would let those numbers sit still for the whole of a long step. A write that was REFUSED
broadcasts nothing.

On the browser's side there is no polling timer that fetches. The one timer there is — a one-second tick that
rewrites the TEXT of the running-phase elapsed marks, see "A spec's date does not move"
below — fetches nothing, swaps no rows and touches nothing that could move the page, so the rule this section states
holds: the rows redraw when the server says something moved, and at no other time. A `changed` event redraws the
rows unless a press is in flight — the same `inFlight`
guard the tick had, for the same reason: the server still shows the pre-press state until the press answers. The `open`
event redraws too, and that is what makes a dropped network or a restarted server heal itself: `EventSource` reconnects
on its own, `open` fires again, and the resync picks up whatever was missed. A hidden tab closes its connection and
opens a fresh one when it comes back, which is the
"the timer already stops for a hidden tab" behaviour applied to a socket.

Two things this deliberately does NOT do. There is no periodic server-side broadcast to reconcile drift — an idle page
must issue no requests and redraw not at all, which is the whole point — so a spec file hand-edited outside the
dashboard leaves its staleness badge behind until some real change happens nearby. And the runner's own two-second poll
is untouched: "about a second" means about a second after the SERVER notices, not after the step really moved.

The one server-side timer this adds is a `: ping\n\n` comment every 45 seconds. `Bun.serve` cuts a connection quiet for
`idleTimeout` (120 seconds here, set for slow git work), and a page watching a quiet queue is exactly that. It is
`.unref()`'d like the runner's timer and cleared in `stop()` besides — `bun test` runs many suites in one process, and a
timer from a stopped test's server would fire into the next one.

## A spec's date does not move, and a phase says how long it took

The **Created** column holds when the spec was made, and a run does not move it. Holding the most recently active job's
own start instead would throw a row to the top of a list sorted by it every time a phase started, so a spec made months
ago and re-run an hour ago would outrank one made this morning. The list opens sorted by this column, newest first.

The date comes from **git, never from the queue**. `QueueStore` is an LRU of 200 jobs, so a spec older than that has no
`Job` record of its own beginning left; the specs repo still has the first commit that touched the folder, years on.
`firstCommitAt` in
`src/description-freshness.ts` asks for it and
`SpecCreatedAtChecker` caches the answer, both shaped exactly like
`DescriptionFreshnessChecker` beside them — same TTL, same key, same fail-to-nothing. `withFreshness` attaches it to
each `QueueTarget`.

Two traps worth knowing before touching this:

- **The oldest commit is not `git log -1 --reverse`.** `-1` limits the commit SELECTION, which runs newest-first, and
  `--reverse` only turns the already-limited output round — the two together still answer with the newest. The oldest is
  the last line of the unlimited log.
- **A spec git cannot date shows a dash, and deliberately no fallback to a job's own time.** A `Job`-backed fallback
  would put the jumping straight back for exactly the specs that cannot be dated. The never-run tie-break in
  `sortGroups` therefore asks two things now, not one: neither spec has a job AND neither has a date.
- **An archived spec's folder has moved, and a plain path-filtered log only sees the move.** Once `aide-archive-spec`
  has `git mv`'d a spec's folder into `archive/<folder>`, `git log -- .` on the new path only shows the move commit and
  anything after it — every earlier commit touched the old path and is invisible to that query. `--follow` crosses
  exactly this kind of rename, but only for a single-file pathspec, not a directory — so an archived row's Created date
  is read with `firstCommitAtFollowingRenames()` against `0-README.md` (written once by `/aide-create`, never
  independently edited or renamed), not the plain directory lookup live rows use.

The other half is duration. **Nothing stores one.** A job carries a single `startedAt` however many steps it ran, so `finishedAt -
startedAt` is the whole job's span and belongs to no one step of it — reaching for that is the mistake `phaseDuration`
exists to prevent. What does exist is an end per finished step (`StepResult.at`), so a step's own span runs from where
the step before it ended, or from the job's own start for the first one.

Three things the column then says, by row type:

- A finished phase: its own settled duration, in the phase line's own time cell.
- A running phase: the same cell, carrying `data-elapsed` — the instant to count up from. The server writes a readable
  figure into it too, so the cell says something with script switched off.
- A spec with nothing left to run: its phases' durations **added together**, beside the creation date on the header row.
  A sum, never a span — a spec that waited three days between two phases did not take three days.

The live count is the one timer on this page, and it is deliberately the narrowest one there can be: a one-second
`setInterval` in
`src/queue-client.ts` that re-queries `[data-elapsed]` fresh each tick and rewrites `textContent`. Re-querying is what
lets it survive
`swapRows()` replacing `#jobrows` with no rebinding. It fetches nothing and touches no layout-affecting attribute, so
the redraw rule above holds.

**`formatElapsed` there is HAND-PAIRED with `durationLabel` in
`src/render/job-state.ts`** — the client file is transpiled into an inline `<script>` and can neither import nor export,
so the wording rule exists twice. `test/queue-client.test.ts`'s "the page words a duration exactly as the server does"
runs a tick against the imported
`durationLabel` over a table of spans and pins them; change one and change the other, or a phase changes its wording the
first time the clock ticks over the figure the server drew.

## Branches, and merging them

A job that touches two repositories makes a branch of the same name in both — `aide/89-merge-from-the-dashboard` exists
in the project and in the specs repo, with different contents and two separate compare pages. Merging one does nothing
for the other, and a header naming one repo hides the other. So the header names **every** repo the spec pushed to,
each with its own compare link and its own badge, each asked of that repo's own checkout. A project whose specs live
inside it (`paceup`, `atlasaurus`) has one repo and reads as a list of one — the same code, not a special case.

The badge says what the reader needs, not merely what git answered. A flat "not merged" is a fact about the BRANCH
that reads as a verdict on the spec, and in the same amber while the step writing that branch
is still running. So while the spec's job is in flight the badge names what it is doing (`analyze running`), and once
nothing is running it says what is open and why — the one window that still exists being the code after
`implement` and before `archive`.

**Nothing here is merged by hand.** Every step lands its own work the moment it finishes: `create` and
`analyze`
merge the branch they pushed into that repo's default branch and delete it on origin; `implement` lands nothing, so the
code stays on the branch for anyone who wants to read or test it first; `archive`
merges every repo it was TOLD about — the roots its own run reported, plus the ones the queue's own history recorded for
the spec — the specs repo first, the code last, so the code is the last word — runs
`AIDE_INSTALL_CMD` after a code root, and then archives. It is not "every repo the
spec's branch exists in":
the loop can only merge what it knows about, which is why it ASKS ORIGIN afterwards, see
[Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished). Leaving `archive`
unticked IS the inspection point. A landing that cannot be made (a conflict with the default branch) is refused by name
and the branch stays where it was — but
`archive` settles most of those itself before it gets that far, see
[Archive resolves the conflict itself](#archive-resolves-the-conflict-itself). A branch whose label is a known
project name is that project's code; a label that is not any project on this machine is the specs repo, which is a
closed set rather than a guess (`.claude/rules/development.md`: "the run only watches ... the roots it knows about").

There is no Merge button and no Approve button: the step that made the work is what knows it is done.

A landing merges the spec branch into each repo's default branch and pushes, one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is aborted, so no half-merged tree is left behind — the
  same shape
  `aide-run-spec` already uses when it brings a reused branch up to date.
- **A dirty tree decides nothing.** A run does not dirty the main tree — it works in a worktree of
  its own and only ever fast-forwards this one — so a refusal over a dirty tree could only ever stop a merge over
  somebody's unrelated uncommitted file. The `switch`, `pull` and
  `merge` write nothing but what differs between the commits, and a file that genuinely collides raises git's own error
  instead of a guess made in advance. What the two sides can still collide over is git's `index.lock`, and there the run
  yields — its pull is a courtesy, recorded and never fatal.
- **`index.lock` is not a conflict.** Losing that race is not a diverged base and must not be refused with the same
  sentence. The pull is retried twice, a quarter
  of a second apart, and ONLY when git's own stderr names `index.lock`; every other failure is refused on the first
  attempt.
- **The plan lands first, the code last.** A run records the project before its specs root, so the merge order is
  reversed deliberately: the code is the one that matters, so it is the last word.
- **A code merge can install.** Merged is not deployed: for a project that installs itself somewhere, the default branch
  moving changes nothing on this machine. Set `AIDE_INSTALL_CMD` in that project's own
  `.aide/config` and it is run in that checkout after its code merges — argv, no shell, bounded by a timeout, and
  reported beside the merge rather than turning a completed merge into a failed one. Without the key nothing runs and
  the result says plainly that deploying is still a hand step. Either way the sentence reaches the page — in the same
  banner a refusal uses, whether the merge was posted from the page or by a plain form.
- **More conflicts than before are expected, not a regression.** Two branches touching the same file conflict at merge
  time, and running several specs side by side means it happens more often. Both sides refuse and name the repo rather
  than corrupting anything, which is what turns this into a merge to do by hand — or into one more
  queue step (below).
- **The report is per repo, never one collective "ok".** Several repos cannot be merged atomically, and one succeeding
  while another fails is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and deleting is the one step that cannot be undone
  cheaply.

## Archive resolves the conflict itself

A spec's branch is brought up to date with the default branch before a step's own work starts, and every step but one
treats a conflict there as a person's problem: the merge is aborted and the run refuses on the spot with
`errorReason: "conflict"`. `archive` is the exception, because
`archive` is the step that LANDS the branch — a merge that fails is the merging step's problem, not a phase of its own.

So `core/scripts/aide-run-spec` hands `archive`, and only `archive`, the worktree exactly as git left it: `MERGE_HEAD`
set, the markers in the files. `/aide-archive`'s Step 1 checks for that and, when it finds it, follows
`core/skills/aide-archive/references/resolve-conflict.md` before anything else — read the conflict, resolve it or decide
not to, finish the merge with `git commit --no-edit`, run the project's own test command — and only then goes on to
archive the spec. The default branch is never touched by the step itself; the dashboard lands the resolved branch
afterwards, the way it lands any other step's work.

There is no `resolve` step and no Resolve button: `resolve` is not in `WORKFLOW_STEPS`, so a post that names it is
refused as an invalid entry in `steps`, and no
control on the page draws off
`errorReason`.

- **The condition is the literal string `archive`, never a denylist.**
  A step this got backwards would carry conflict markers into a commit, which is worse than the refusal it replaced.
- **It either finishes or puts the branch back.** Tests red, or a conflict the skill will not decide, and the merge is
  undone to the commit the branch started on. `aide-run-spec` pushes a repo only when its `HEAD` moved, so a branch put
  back never reaches origin — no new rollback machinery, the gate that already exists. A run interrupted mid-merge is
  aborted by the script before the commit loop, so conflict markers are never committed either way.
- **The test command is the gate the design rests on.** A machine resolving a conflict unattended and then landing it is
  defensible because a resolution that does not pass the project's own tests does not land.
- **A conflict that still reaches a reader is one no machine could settle.** The row shows it as the failure's own
  text — which names the branch — beside the ordinary re-run control every other failed step offers. Understanding it is
  a person's job, with the diff in front of them.
- **Archive's cost and duration are variable now.** It was a short, cheap step; a run that meets a conflict is as big a
  piece of work as a resolution ever was. No timeout change was needed — `resolve` used the same `timeoutSec.default`
  (1200s) and the same model archive already falls to.

## Origin decides whether a landing finished

Three specs reached the archive with their code still sitting on a branch, and every row said done. The archive STEP had
succeeded, so the job was `done` and the folder was already under `archive/` — the folder moves before the code merge is
even attempted. The landing that failed after it stored a sentence and a reason on the job, and nothing was drawing
either. **A spec whose code did not land is not finished, and its row has to say so.**

- **The archive landing asks origin, after merging.** One
  `git ls-remote --heads origin 'refs/heads/aide/*'` per repo root, cached for 30 seconds, asked fresh at the end of a
  landing because the merge has just deleted the branch it is about to ask about. A root that still holds
  `aide/<folder>` is a landing that did not finish, whatever the merge loop reported — and this catches every cause at
  once: a conflict, a repo the queue never knew about, history the LRU cap evicted, a push that half-succeeded.
- **It is `archive`'s question and no other step's.** An `analyze`
  landing runs while implement's code branch is legitimately open, and the same check there would call a healthy landing
  failed.
- **A failed landing moves the job to `failed`.** Every page reads the state through one path, so it reads as unfinished
  wherever the job is shown. Downgraded only from `done`: the runner may have queued the job's NEXT step in between, and
  a landing must not overwrite a job that has moved on.
- **`errorReason` is `"conflict" | "unlanded"`.** The class, beside the sentence a person reads — the sentence is joined
  across repos before any page sees it, so nothing may match on it. Declared twice, in
  `src/queue.ts` and `src/render/job-state.ts`, and pinned to each other by a test in `test/queue.test.ts` the way
  `PHASE_STEPS` is pinned to
  `QUEUE_STEPS`.
- **An unanswerable question invents nothing.** `ls-remote` that fails is `null`, and `null` claims neither that the
  branch is open nor that it is gone — the same fail-open rule `isMerged` keeps. A network blip must not report every
  archive as unlanded.
- **The spec keeps its row while its branch is open.** Every archived spec has a reader row on the specs list, but
  only on a chip that asks for one; a spec whose own `aide/<folder>` is still on origin is built whatever the
  chip, so it stays on the DEFAULT view — wearing the "not landed" mark, and counted by the Problems chip. The filter is
  the BRANCH,
  never the job's `errorReason`: a spec can reach this state with no reason recorded at all, and a stale reason on an
  old job would resurrect a row
  for a spec that is genuinely finished.
- **The way out is the step that already exists.** `archive` can be enqueued again for such a spec: `aide-run-spec`
  hands it the open merge, `/aide-archive`'s Step 1 resolves it, Step 2 stops because the folder has already moved, and
  the landing that follows merges cleanly. A set that has not been refreshed yet is empty, so the enqueue fails closed.
- **What it does not do.** The Slack ping that already said "finished"
  is not withdrawn — `announce` belongs to the Runner and fires before the landing exists. And a page loaded in the
  second between
  `complete()` writing `done` and the landing settling still reads
  `done`; the correction arrives a moment later.

Filtering and sorting work on those groups. "Active" means the spec has something in flight; sorting by cost sorts on
the sum. A step outside the four (`explore`, `create`, `manifest` — valid steps the form does not offer) is appended
after them rather than dropped, so a run is never invisible.
