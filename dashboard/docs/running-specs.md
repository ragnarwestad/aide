# Running specs

How a spec becomes a run: the queue, the runner, the checkouts it works in, and what each step publishes.
Two pages sit beside this one: [The specs list and the spec page](the-specs-list.md) — what a row says and what its
controls do — and [Branches and landing](landing.md) — how each step's branch is merged, and what stops one from
landing.

## Table of contents

- [Making a spec from the page](#making-a-spec-from-the-page)
- [The token](#the-token)
- [Caps](#caps)
- [Which AI runs a step](#which-ai-runs-a-step)
- [Global defaults for the AI and model](#global-defaults-for-the-ai-and-model)
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

---

The spec list runs aide workflow steps headless on this machine: one job at a time, each step a
`claude -p "/aide-<step> <spec>"` process started by aide's `aide-run-spec`. A job is an ordered list of steps; a step
that ends either advances the job or ends it.

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
[what the script adds](the-specs-list.md#what-the-script-adds)). It cannot `import` anything: `queueClientScript()` runs
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

**The project's own page, `/projects/<name>`, answers the two things a generated file could not:** what its
`.aide/config` says, and whether a run could start there at all. The manifest itself is not repeated — a frozen copy
of a file nothing on the page can act on, and a manifest that fails to parse already says so on the project's
`/projects` row, which is the live view of the same thing. Each of the seven recognized config keys is marked
configured, worked out (naming the lockfile that decided it, hedged as a default rather than a verified command) or
not set; a checkout with no `.aide/config` says so in as many words, because "no file" and "a file setting nothing"
are different states and the first is what a project cloned onto a second machine is in. Below that, the same checks
`assessProjectReadiness` runs at Add time, on every load rather than once in a notice gone by the next page. Nothing
is executed and nothing is moved: a git that cannot answer leaves the settings standing, with no readiness section.
The generated `/<slug>.html` page shows the manifest and the specs only: it is generated after a merge lands somewhere
in the queue, and a config file edited between merges would be described there as it stood days ago.

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
