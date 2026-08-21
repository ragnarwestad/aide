# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs (spec 80)](#live-runs-spec-80)
- [Running specs (spec 81)](#running-specs-spec-81)
  - [Making a spec from the page (spec 93)](#making-a-spec-from-the-page-spec-93)
  - [The token](#the-token)
  - [Caps](#caps)
  - [Which AI runs a step (spec 125)](#which-ai-runs-a-step-spec-125)
  - [Adding and removing a project](#adding-and-removing-a-project)
    - [Whether a run can start there (spec 138)](#whether-a-run-can-start-there-spec-138)
    - [What Add finishes itself (spec 140)](#what-add-finishes-itself-spec-140)
  - [How many run at once](#how-many-run-at-once)
  - [Gates and notifications](#gates-and-notifications)
  - [What a finished step publishes](#what-a-finished-step-publishes)
  - [How the list reads](#how-the-list-reads)
  - [What the script adds (specs 96 and 101)](#what-the-script-adds-specs-96-and-101)
  - [Branches, and merging them](#branches-and-merging-them)
    - [Letting aide resolve a conflict (spec 106)](#letting-aide-resolve-a-conflict-spec-106)
- [How it looks (spec 102)](#how-it-looks-spec-102)
  - [Tokens](#tokens)
  - [Components](#components)
  - [The guard](#the-guard)
  - [Spacing lives in the container, not the component (spec 120)](#spacing-lives-in-the-container-not-the-component-spec-120)
  - [One busy flag, not a per-step lookup (spec 105)](#one-busy-flag-not-a-per-step-lookup-spec-105)
  - [A structural marker with no CSS rule uses data-*, not a class (spec 123)](#a-structural-marker-with-no-css-rule-uses-data--not-a-class-spec-123)
  - [Theme choice (spec 107)](#theme-choice-spec-107)
  - [Header and tab bar, not a sidebar (spec 119)](#header-and-tab-bar-not-a-sidebar-spec-119)
- [Deploying](#deploying)
  - [On a second host](#on-a-second-host)
  - [Saying it once instead of every time](#saying-it-once-instead-of-every-time)
  - [On one machine](#on-one-machine)

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root,
parses spec progress/phase from `4-status.md` files, and renders a
small static site — an overview page plus one page per project, all
sharing a left-column nav. Generated where the repos live and served on
port 8788 by a small Bun server that also receives live aide-run
events. Generator and server can run on the same machine or on two —
no host is named anywhere in this repo.

## URL scheme

- `/` — one row per spec — every non-archived spec of every
  allowlisted project, whether or not it has ever run — with its
  workflow phases beneath, foldable away; run any phase from its own
  line, watch one, cancel one (token required). The front page: it
  is what the dashboard is used for, so it is what the dashboard opens
  on.
- `/new` — the form that makes a spec: a project, what it builds on, a
  title and a description, with Create (queues the job and returns to
  the list, where the new spec's row shows its progress) and Cancel
  (returns having done nothing). Reached from the "New spec" button on
  `/`, which is a plain link. Token required, like `/`: it carries a
  real form.
- `/projects` — every project with description and active/archived spec
  counts, plus the panel that adds and removes them. Reached from the
  nav, labelled "Projects". Token required, like `/`: the panel is a
  mutating control, and a page carrying one needs a server to check the
  token per request.
- `/projects.html` — where that overview was generated until it was
  served. Now a redirect to `/projects`, keeping whatever the address
  carried; no token needed, like every other generated page. The file
  stays: bookmarks point at it, and `deploy/rsync-publish.sh` refuses to
  publish a site without it.
- `/<slug>.html` — one page per project (slug = lowercased name,
  non-alphanumerics → hyphens; collisions get `-2`, `-3`, …; `index`,
  `about` and `projects` are reserved)
- `/api/aide-runs` — aide runs in flight, as JSON; `POST /api/aide-run`
  receives one event. (The `/live` page that rendered them was dropped
  on 2026-08-18: the spec list shows every queued run per row, and
  interactive sessions are claude-usage's own page.)
- `/specs/<id>` — one job, in full. It did NOT move with the list: every
  job link already sent out points here.
- `/specs` and `/queue` — where the list used to live; both redirect to
  `/`, query string intact, so an old bookmark still lands
- `/queue/<id>` — redirects to `/specs/<id>`, where the job still is
- `/api/queue` — the same jobs as JSON; `POST /api/queue` enqueues one;
  `POST /api/queue/<id>/cancel` acts on one. The API keeps the queue's
  own name: it is a contract, not a page anyone reads. `approve` and
  `merge` were routes here until spec 149 and are gone: there is no stop
  between steps to approve, and every step lands its own work.
- `POST /api/queue/create` — project, title and description in; a job
  that MAKES a spec out, which then lands itself and becomes an ordinary
  row (token required, like the rest of `/api/queue*`)
- `POST /api/queue/projects` — add a project to the allowlist: clone it
  under the projects root (`gitUrl`) or register a checkout already
  there (`existingPath`), write a minimal `.aide/project.yaml` if it has
  none, and optionally write `AIDE_SPECS_PATH` into its `.aide/config`.
  Answers per step, in the merge route's shape (spec 112).
- `POST /api/queue/projects/<name>/remove` — take it off the allowlist
  and off this dashboard. Requires `confirm` to equal the project's name
  exactly, and never touches the checkout or the specs root.

Keep the scheme stable: the pages are linked from outside.

## Usage

```bash
make test                           # tsc + bun test (single-run)
make generate                       # write the site to out/
make serve-local                    # generate + serve out/ on this machine
AIDE_DASH_HOST=<host> make publish  # generate + rsync out/ to that host
                                    # (--delete: pages removed locally
                                    # disappear remotely too)
MINI=<host> make install-serve      # clone/pull + deps + launchd job there
MINI=<host> make deploy-serve       # same — for updates
```

Both `AIDE_DASH_HOST` and `MINI` are required and have no default: a
sync with `--delete` aimed at a machine nobody named is worse than one
that refuses to start.

The remote site directory (`~/aide-dashboard/site` on the serving host)
must remain exclusively the dashboard's: publish syncs with `--delete`,
so anything else placed there is removed on the next publish.

## Live runs (spec 80)

A Claude Code `UserPromptSubmit` hook (`aide-emit-run`, installed by
aide to `~/.local/bin`) POSTs one small event per slash-launched
`/aide-*` command — host, session id, command, spec, project; never
the prompt text. It is inert until `AIDE_RUN_URL` is set. aide's
`install.sh` prints the ready-to-paste block; on this laptop it lives
in `~/.claude/settings.json` as:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "AIDE_RUN_URL=\"http://<serving-host>:8788/api/aide-run\" '/Users/<you>/.local/bin/aide-emit-run'" }] }]
  }
}
```

The job page (and `/api/aide-runs`) merge the stored runs with claude-usage's `/api/live` (same
host — but if claude-usage there binds one address only, pass it
explicitly: `CLAUDE_USAGE=http://<address>:8787 make install-serve`;
fetched lazily and cached 5 s): liveness
state, subagent count and cost so far. claude-usage unreachable →
rows render without enrichment and a notice; never an error. Runs are
kept in memory (LRU 512) and mirrored to `~/aide-dashboard/aide-runs.json`
so restarts keep them.

## Running specs (spec 81)

The spec list runs aide workflow steps headless on this machine: one job at a
time, each step a `claude -p "/aide-<step> <spec>"` process started by
aide's `aide-run-spec`. A job is an ordered list of steps; a step that
ends either advances the job, parks it for approval, or ends it.

One way in: the spec's own row, expanded (spec 103 — collapsed is the
default; see [How the list reads](#how-the-list-reads)). It carries a
checkbox per phase, a model dropdown, and one Run button that queues
everything ticked as a single job in the workflow's order — the browser
submits checkboxes in the order they are drawn, so ticking `implement`
before `analyze` still queues analyze first. After the model, quiet and
small-text on that same controls line (spec 117 — no disclosure to
open), sits the one thing nobody sets every time: which other repos the
job will touch. A "stop for approval between steps" box sat beside it
until spec 133; its two states were "run straight through" and "stop
after every step", and a reader who wants the second runs one phase at
a time instead.

**Every phase the job in flight was queued with shows its box
disabled**, not merely the step it has reached, because the queue would
refuse any of them anyway (see
[the duplicate guard](#gates-and-notifications)) — a job queued as
`analyze` + `review-plan` left `review-plan` tickable until the moment
it got there, and Run then answered "already running on this spec".
The box says why on hover ("analyze is running"), in the same words the
state chip uses.

What is pre-ticked is what you almost always came to run: the first
phase the spec has not had — except for a spec nothing has ever run at
all, which gets `analyze` and `review-plan` ticked together, because
that pair as one gated job is how a spec is actually started here. A
phase already done is marked with a tick and left unticked; ticking it
anyway is a rerun, and no rule stands in the way.

**Which phases a spec has HAD is read off one line, and nothing else**
(spec 139): `- **Workflow steps completed:** create, analyze` in the
Tracking info of its `4-status.md`. Each step writes its own name there
once it has succeeded, and `core/rules/spec-structure.md` § 4-status is
where that contract lives.

The three things this replaced were each a proxy for the question
rather than an answer to it: `2-analysis.md` being over 400 bytes and
free of a placeholder string meant analysed, a `## Plan review` heading
in `3-solution.md` meant reviewed, and 100% in `4-status.md` meant
implemented. On 2026-08-20 the first of them marked spec 138 analysed
before any analyze had run — its untouched analysis template is 693
bytes — so the row offered review-plan instead, and review-plan ran
three times against an empty template. The percentage keeps its own
job: it says how far the TDD phases INSIDE implement have got, which is
a different question from whether implement ran.

A spec whose status file predates the line has had nothing as far as
the page is concerned. That is deliberate: a spec that reads as
unfinished is visible and is fixed by running the step, where a silent
guess is neither.

The State column answers what a reader came to find out, and its FIRST
line is one of two things, always (spec 132): the verb for what is
happening — "analyzing", "implementing", "implementing queued" — or,
once nothing is running, the resting state and what can happen next —
"ready for implement", "archive held back — the Slack webhook", "done —
nothing waiting on you". The bare words
"done" and "queued" are neither, and neither appears alone: "done" said
nothing about WHAT was done, and "queued" said nothing about which step
was waiting, while both facts were known.

The line beneath it is for the states whose badge cannot carry the
whole answer: "never run — tick a phase and press Run", "waiting for
your approval to carry on", "press Run to try implement again", and the
held-back archive of a run that stopped short. For a row at rest it is
empty, exactly as it has been for a running row since spec 101 — the
sentence is in the badge, and saying it twice is the row telling a
reader one fact at two levels of precision. It invents no vocabulary:
both are built from the same `stateLabel`/`currentStep` the chip and the
phase lines use, so the row cannot say one thing in two ways. Everything it summarises is still
there beside it — the pips, the chip, the branch badges — each
answering its own narrower question.

The four sentences about how runs work on this machine sit behind a
shut "How runs work here" disclosure, like the New-spec panel and for
the same reason: the list is what people come here for. The
runner-unavailable notice is NOT folded in with them — "nothing here
spends money" must not need a click.

There used to be a form above the table as well, with a spec dropdown
of its own. It was the only way to queue several steps as one job, and
it read as the way you were meant to start anything — while the
five-second refresh could not keep its dropdown current, because that
refresh deliberately replaces the ROWS alone so a half-set control is
never wiped. A spec created since the page loaded was in the list and
not in the dropdown. The row does everything the form did, so the form
is gone (spec 94).

### Making a spec from the page (spec 93)

Every spec that exists is a row, and every row runs. A spec that does
not exist yet has no row — so above the table there is a "New spec"
button, and it is a plain link to `/new` (spec 121). That page is the
form and nothing else: a project, what the spec builds on, a title, a
description, and two actions — Create, which posts to
`POST /api/queue/create` and returns to the list, and Cancel, which
returns having done nothing. Create queues an ordinary job whose single
step is `create`, and the run is guarded, budgeted and timed exactly
like any other.

It was a disclosure folded into `/` until spec 121: pressing a primary
button and having the page unfold under it read oddly, and there was no
way out of the open form but pressing the same button again. Both
actions work with no script at all — a link and a form POST — and a
refused submission comes back to `/new?error=…`, where what was typed
can be corrected.

Two things about it are worth knowing:

- **The project list is the raw allowlist** (`queue-config.json`'s
  `projects`, seeded from `QUEUE_PROJECTS`), not the
  projects the server has found specs for. Every other control on the
  page is about a spec that exists; this one is about a project whose
  FIRST spec may not, and such a project appears in no other list here.
  `/api/queue` is unchanged and still refuses a project with no
  discovered spec.
- **Nothing here names the spec.** The job carries a provisional key
  (`new-abc123de`) which names its branch and its worktree and nothing
  else; the number and the slug are decided inside the `/aide-create`
  run, whose own steps own that rule. `aide-run-spec` then reports the
  folder that actually appeared, as `specFolder` in its result — read off
  the disk, and left unreported when zero or several appeared rather than
  guessed at.

When the step succeeds the dashboard **lands the branch itself** and
renames the job to the real folder. It was the first step to do so, and
it is not a convenience: the list shows what is on disk in the main
checkout, which every run keeps on its default branch, so a created spec
that is only pushed to a branch appears nowhere at all. A landing that
fails leaves the provisional key in place and says which repo and why.
**While any job is landing the
scheduler starts nothing at all**, whatever the concurrency is set to: a
landing merges into the shared main checkout, which worktree isolation
does not cover.

The list holds SPECS, not the machine's whole run history: a spec that
has been archived leaves the page along with the jobs it had. Nothing is
destroyed — `/api/queue` still returns every job and `/specs/<id>` still
renders each one. A project the server knows no specs for at all keeps
every row it has: an empty spec list means "we cannot tell", never
"everything here is archived".

A spec's row is collapsed by default: name, title, one status line, the
four phase pips, and at most one action button (Resolve, after a landing
on that row was refused for a conflict). The four phase lines and every
control — phase checkboxes, model dropdown, the also-touches field, Run,
Cancel — sit behind the same chevron in front
of the name (spec 103). Expanding is a link and lives in the query
string (`?open=<project>/<folder>,…`), which is what makes it survive
the table's own five-second refresh, what makes it work with JavaScript
switched off, and what keeps the row a person just acted on open across
the swap/redirect that follows their own submit.

Every control here is a plain form first: ticking phases and pressing
Run works with JavaScript switched off, and so do Cancel, Resolve,
Create and expanding a row — each posts its form and follows a
303 back to the list. `queue-client.ts` is a layer ABOVE that floor,
never the mechanism (see
[what the script adds](#what-the-script-adds-specs-96-and-101)). It
cannot `import` anything: `queueClientScript()` runs
`Bun.Transpiler.transformSync` over it and inlines the result into a
plain `<script>` tag — that transpiles, it does not bundle. An
`import` survives as an ESM import inside a
classic inline script (a 404, since this server does not serve that
path), and an `export` is a syntax error. Any shared, unit-testable
browser module needs a bundle step or a `type="module"` tag first; the
expand/collapse link was built to need neither.

The page was called Queue until spec 87. That a queue orders the runs is
an implementation detail — `QueueStore`, `/api/queue`, `QUEUE_PROJECTS`
and the rest keep the name; what a reader reads does not.

Nothing is guessed at across a restart: the runner spawns detached, in
its own process group (measured: such a child survives
`launchctl bootout`), and **the result file is the contract** — the
scheduler polls the pid and the file, and a job left `running` is
reconciled from both.

A run that hits a cap is **stopped**, never **failed**. With caps this
tight a cap-stop is a common, healthy outcome, and a reader who cannot
tell it from a broken agent will start ignoring both.

### The token

The whole queue surface — `GET /`, `GET /new` and `GET /projects`, and
the old addresses `/specs` and `/queue`, included — needs a token; a token a page
hands to anyone who can load the page is not a secret. Open
`/?token=<the token>` once and the browser keeps an `HttpOnly`
cookie; API callers send `X-Aide-Token`. The generated pages
(`/projects.html`, `/<slug>.html`, `/about.html`) and `/live` stay open:
they carry nothing that needs the token. The token is read from a file
(`--token-file`), never an argument: `ps` shows arguments to every user
on the machine.

**With no token configured every queue route answers 503** — off loudly,
rather than open quietly. `/live`, `POST /api/aide-run` and the static
site are unaffected: spec 80's emitter sends no credential and swallows
the answer, so a 401 there would silently empty `/live`.

### Caps

Four, all checked BEFORE a step starts — a cap that only stops you
afterwards is a report, not a cap. They live in the queue config
(`--queue-config`), so a wrong number costs a config edit and a restart:

```json
{
  "budgetUsd": 3,
  "jobCapUsd": 10,
  "dailyCapUsd": 20,
  "timeoutSec": 1200,
  "permissionMode": {
    "implement": "bypassPermissions",
    "default": "acceptEdits"
  },
  "model": { "implement": "opus", "resolve": "sonnet", "default": "sonnet" },
  "push": "branch",
  "concurrency": 2,
  "projects": ["aide", "aide-dashboard"],
  "notifyCommand": ["/Users/<you>/aide-dashboard/notify-slack.sh"]
}
```

A job may only TIGHTEN a cap, and cannot set the permission mode at all.
A timed-out step is charged its full budget: the accounting over-charges
what it could not measure, never the other way round.

`projects` is the odd one out in that file: it is the only key the
server WRITES as well as reads. It is the queue's allowlist, and the
Projects panel on `/` rewrites it on every Add and Remove (spec 112) —
which is what makes those take effect without a restart. The
`--queue-projects` flag is the seed for a first install where this file
does not exist yet; where the file HAS a `projects` array, it wins over
the flag. A malformed one is ignored entirely and the flag is kept, the
same direction every other key here fails in.

### Which AI runs a step (spec 125)

Every step runs on Claude Code unless a `modelChoices` entry says
otherwise. That table is what the per-phase model picker offers, and
each entry may name a `tool` and a `model` of its own:

```json
{
  "modelChoices": {
    "sonnet": { "budgetUsd": 3 },
    "opus": { "budgetUsd": 15, "jobCapUsd": 30 },
    "codex-fast": { "budgetUsd": 5, "tool": "codex", "model": "gpt-5.6" }
  }
}
```

`tool` is `claude` (the default, and what an entry that says nothing
means) or `codex`. `model` is the literal value handed to the CLI when
it differs from the entry's own key — the key is what the picker shows
and what a request posts, so a readable name can front a model string
nobody wants to read. An entry naming a tool other than claude says so
in the dropdown, so two entries are tellable apart before one is picked.

That baseline is what the row's own AI select rests on: it opens on
Claude Code whatever order `modelChoices` is written in, and a phase
with no run behind it and no `model` default of its own is pre-filled
with a Claude entry rather than with whichever entry the table happens
to list first. A phase that HAS run still shows the model it ran on,
and a per-step `model` default still wins over both.

The queue, the worktrees, the wall-clock timeout and all the git
handling are one path for both tools. Three things differ, and all three
are visible on the page rather than papered over:

- **A Codex step's budget is not enforced while it runs.** Claude Code
  takes a `--max-budget-usd` and stops itself; Codex has no equivalent
  flag, so for a Codex entry `budgetUsd` feeds the dashboard's own
  grant-and-tighten arithmetic before the step starts and nothing else.
  **The wall clock (`timeoutSec`) is the only thing that stops a runaway
  Codex step**, and it is mandatory for every step either way.
- **A Codex step reports tokens, never dollars.** No dollar figure
  exists anywhere in Codex's output, so the Cost column shows the token
  count and a dash where the money would be — never `$0.00`, which would
  add up as though the step had been free. A job mixing both tools has a
  `spentUsd` covering its Claude steps only.
- **A Codex step has no "Live right now" panel.** That panel's contents
  come from `claude-usage`, which watches Claude Code sessions and knows
  nothing of Codex threads. The Activity tab works for both: the run's
  transcript is parsed in whichever schema wrote it.

Safety modes are stored the same way for both — the queue keeps Claude's
own names, per step, config-only. `aide-run-spec` translates them for
Codex: `bypassPermissions` becomes
`--dangerously-bypass-approvals-and-sandbox`, `acceptEdits` becomes
`--sandbox workspace-write`, and `plan`/`default` become `--sandbox
read-only`. A mode with no entry in that table refuses the run rather
than being guessed at. (`codex exec` is non-interactive and has no
`--ask-for-approval` flag at all — that one belongs to the interactive
command — so the sandbox mode is the whole of what there is to say.)

### Adding and removing a project

The Projects panel on `/projects`, behind the queue token like every
other mutating control. It sits under the listing it changes — spec 112
had to put it on `/` because the overview was a generated file with no
server behind it to check a token against, and spec 115 made the
overview a served page. Add takes a name plus either a git URL (cloned to
`<projects root>/<name>`) or a path to a checkout already there, and
optionally a specs root and a one-line description. It writes a minimal
manifest — the name and that description, nothing else — only when the
checkout has none; filling in the rest is `/aide-manifest`'s job
afterwards, and the form says so.

#### Whether a run can start there (spec 138)

Add answered "added" and nothing else, and the things that decide
whether `aide-run-spec` will START were invisible until Run was pressed
and the run refused. Skjer, added 2026-08-20, is the case: on the
allowlist, checkout where the form said, minimal manifest written — and
unable to run, because the `.aide/` the Add itself had just made was
untracked, the checkout stood on a feature branch whose upstream was
gone, no specs root had been named, and no worktree links were set.

So the answer says two things now, and keeps them apart. `ok` means the
registration completed. `readiness.canRun` means a run would start. Both
were asked of Skjer's add and only the first was true — and folding them
into one would have reported a checkout that IS on disk as an add to try
again.

The form asks for one thing more than it used to: **Worktree links**,
the space-separated repo-relative paths a run has to symlink into its
worktree because git does not carry them (`node_modules`, `.venv`). A
run works in a `git worktree`, which checks out TRACKED files only, so a
project whose test command lives behind a gitignored path fails in every
run for a reason that has nothing to do with its change. Nothing can
derive which paths those are, so the form asks; leaving it empty is
normal and is reported as a note rather than a fault.

The checks are `aide-run-spec`'s own prerequisites, read-only, taken
after the Add has written its files — the `.aide` written a second
earlier is part of what the runner will see:

| Check           | Blocks a run when                                                                                        |
|-----------------|----------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository, or is inside a bigger one — a run would branch and push that one |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory           |
| `specsRepo`     | that specs root is in no git repository, so nothing would commit the spec a run writes                   |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out         |
| `worktreeLinks` | a configured entry leaves the repository, or names a path that is not there                              |

`defaultBranch` is asked of **every** repository a run touches — the
project's, and the specs repo when the specs live elsewhere — because
the runner refuses on it in any of them. A checkout on a feature branch
is reported and does not block: the runner puts the checkout on its
default branch itself.

There was a `clean` check beside it until spec 144, refusing a
repository with uncommitted or untracked files. The runner stopped
refusing over that, so this stopped asking: a run reads origin's default
branch into a worktree of its own, and what somebody left uncommitted in
the main checkout reaches nothing.

Nothing in the assessment mutates anything: no branch is switched, no
directory made, no file committed. That is also why the answer can go
stale. A default branch resolvable when the project was added is one
somebody can delete or park a second worktree on a minute later, and Run
says so at the time — this is a preflight check, not a promise.

The result is shown where Save was pressed. With script it goes into the
form's own slot and the page stays put, because the Specs root and
Worktree links fields on that page are usually what fixes it and saving
again re-assesses. Without script the redirect carries the same sentence
to `/projects` in the query string, where the page renders it. The
sentence is built once, on the server, so the two modes cannot drift
apart.

#### What Add finishes itself (spec 140)

Skjer again, the same afternoon: Add reported success and a run still
could not start, and making one possible took three hand steps — `mkdir`
of the specs root and its `archive/`, `AIDE_SPECS_PATH` written into
`.aide/config`, and `.aide/` appended to `.git/info/exclude`. Two of
those were things the form knew and did not do, and one was a remedy
named nowhere at all.

**The name is the directory's, not the typed one.** A project is
discovered as a directory under the projects root, and
`discoverProjects` reads its name off that entry and out of no manifest
— so a project registered under a name that differs could never be
found again. Picking `skjer` and typing `Skjer` beside it used to be
refused, in a message naming `<root>/Skjer`, a path that does not exist
either. The pick wins now, and the Name field says what it is actually
for: naming the directory a **clone** creates. A full path typed by
hand is not the picker and is unchanged, mismatch refusal and all.

**A specs root that is not there is made.** The form used to write the
path into `.aide/config` and then report the project as unable to run
because there is no such directory — a refusal over a path known the
moment it was written. Add creates it, with the `archive/` beside it
that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the
real state either way.

**The third hand step is gone rather than automated.** Appending
`.aide/` to `.git/info/exclude` was needed because the untracked
manifest Add had just written made the tree dirty, and a dirty tree
refused the run. Spec 140 answered that by naming both ways out of it
in the message — commit it, or exclude it — and spec 144 removed the
refusal itself, so there is nothing left to get out of. Where a manifest
belongs is still a question with two answers (in git in a project of
one's own, out of it in an employer's checkout) and still nothing an
Add can decide; it is now a question nobody is forced to answer before
running anything.

**Worktree links are suggested from the checkout's own `.gitignore`.**
Nothing can derive which gitignored paths a project's commands need,
which is why the field exists — but the checkouts on offer name the
candidates in a file the reader had to go and open. The field carries a
`<datalist>` of the literal, top-level entries from every offered
checkout's `.gitignore`, deduped: a suggestion the reader may ignore,
needing no script, like every other control on this page. Globs,
negations, comments and nested paths are left out — they are not values
`AIDE_WORKTREE_LINKS` can take.

Remove takes the project off the allowlist and off this dashboard, and
that is all it does: the checkout and the specs root stay on disk,
untouched. It asks for the project's name to be typed back, and the
server refuses anything but an exact match — the browser turning the
button off until it matches is a convenience over that check, not the
check itself.

The generated `projects.html` carries neither control: it is a redirect
to the served page now. The generated pages stay open, which means they
carry nothing that needs the token — and both of these actions do.

A server started without `--root` has no projects root to list or add
to. Its `GET /projects` redirects to the generated `projects.html`
instead of rendering an empty listing, and its nav goes on naming that
file — an empty page would read as "no projects on this machine" rather
than "this server was never told where they are".

The daily cap counts the budgets of the steps **already in flight**, not
only what has been recorded. Recording happens at completion, so with
several slots N jobs would otherwise each pass the same check on the same
numbers, and the cap be exceeded by (N−1) budgets before anything
noticed. A job the daily cap holds back does not block the queue either:
a cheaper job behind it may take the free slot.

### How many run at once

`concurrency`, two by default. **1 to 4 is accepted and anything else —
missing, non-numeric, out of range — falls back to two**; it does not
clamp, because `concurrency: 9` would otherwise have to be both 4 and 2
depending on which rule you read. The upper bound is the only thing
between a typo in this file and sixteen `claude` sessions on the serving
host.

`1` reproduces the behaviour the queue had before spec 91 exactly, so
rolling back is a config edit and a restart.

Two jobs for the same spec are never started at the same time — analyze
and implement for one spec are ordered by nature. Beyond that the jobs
are genuinely independent: each `aide-run-spec` run works in `git
worktree` checkouts of its own, so the main checkouts never leave their
default branch and no run can see another's.

### Notifications

There is no stop between steps and no way to ask for one (spec 149). A
gate used to park a job in `awaiting-approval` until someone pressed
Approve; no form on the page could ever set one, the three jobs that
ever had one were posted as JSON by hand, and every step lands its own
work now, so there is nothing between two steps for anyone to weigh. A
request that still names `gateAfter` is accepted and the field ignored,
like any other unknown key.

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line
of JSON on stdin (claude-usage's contract, copied so one wrapper can
serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a
second later, and absent unless configured. `deploy/notify-slack.sh` is
the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
```

### What a finished step publishes

`push` in the queue config, passed on to `aide-run-spec`:

- `none` — commit locally and stop. Review by fetching from the host
  that ran it.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs
  repo's own commits. The specs page and the notification then link to
  the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving
  host; a broken `gh` records the error and leaves the run successful.

### How the list reads

One row per spec, not per job, and collapsed by default (spec 103):
name, title, one status line, the phase pips, and at most one action
button. Expanding it (the chevron in front of the name, `?open=…`)
reveals the workflow phases underneath, always in that order, so how
far a spec has got is readable without counting rows, plus the run
controls (phase checkboxes, model, the also-touches field after it,
Run, Cancel). A
phase never run shows a muted "not run yet". A phase run more than once
shows its LATEST attempt with the count beside it, because a re-run is
ordinary: one spec needed three `archive` runs.

The first line is `create` (spec 116) — history, not a control. It
reads done once `4-status.md` records it, which is what `/aide-create`
writes into a new spec; a spec with a create job in the queue's history additionally
shows that run (state, model, time, cost, link), and a spec made by
hand or before spec 93 shows the line inert, the same way any phase run
outside the queue does. It has no checkbox and no pip of its own — the
pips still count only the four RUNNABLE phases below it: analyze,
review-plan, implement, archive.

The header carries what belongs to the spec rather than to one run,
unconditionally (collapsed or expanded): the summed cost, one link per
repo the spec pushed to, and the state that matters most right now —
whatever is in flight, else the most recent outcome. A collapsed row's
single action button — the way out of a conflict, where the refusal
is — sits there too, once per spec instead of once per job; Cancel is
only offered once the row is expanded.

### What the script adds (specs 96 and 101)

The page's own browser code does one thing to the controls: it keeps
the reader where they are. Every one of them — Run, Cancel, Resolve,
Create — is a real `<form>` that works on its own, and the script only
intercepts.

- **A press changes the button at once, without changing its width**
  (spec 104). It disables, gains the `busy` look and a spinner ahead of
  its own label — the label itself stays put, only the `title` carries
  the pending word ("starting…", "cancelling…", "queueing…",
  "merging…", "creating…"), read from `data-pending` beside the label
  it used to replace. On a row control the same press swaps that row's
  own `.phases` chips for the same spinner, holding their width with
  `style.minWidth` so the buttons beside them do not shift — freed
  again once the boxes come back. The `finally` block that undoes all
  of this runs under the same `isConnected` guard the button already
  had, which matters because `swapRows()` returns without touching
  `#jobrows` when the rows re-fetch itself fails: without that guard a
  row can get stuck holding a spinner for a request that is already
  over. The `.phases` boxes are Run's own form fields — the ticked
  checkboxes live there — so the swap only happens after `new
  FormData(form)` has already read them; writing the spinner in first
  would silently queue a job with no phases at all.
- **The answer lands in place.** `#jobrows` is re-fetched and swapped;
  the page does not reload, does not scroll to the top, and does not
  wipe a control someone is half-way through setting.
- **A refusal no longer navigates either.** The reason and the spec it
  belongs to are written into the address bar with
  `history.replaceState` — the same `?error=&errorSpec=` query the
  server's own 303 would have built — and the rows are re-asked with
  it, so the message comes back rendered on the spec's own row. The
  filter, the sort and the fold ride along in that query, which is why
  a refusal cannot throw the reader back to the default list.
- **The New-spec form answers for itself.** It sits outside `#jobrows`
  on purpose (a half-typed description must survive the five-second
  swap), so it is bound directly rather than by delegation, and a
  refused create has no row to land on — the spec it named was never
  made. Its reason is written beside the form; on success the form
  empties and shuts, and the new row arrives with the swap.

Without the script every one of those falls back to a form post and a
303 to the list: slower, and one full page load, but functionally
complete.

### Branches, and merging them

A job that touches two repositories makes a branch of the same name in
both — `aide/89-merge-from-the-dashboard` exists in the project and in
the specs repo, with different contents and two separate compare pages.
Merging one does nothing for the other, and that went unnoticed three
times on one day. So the header names **every** repo the spec pushed
to, each with its own compare link and its own badge, each asked of
that repo's own checkout. A project whose specs live inside it
(`paceup`, `atlasaurus`) has one repo and reads as a list of one —
the same code, not a special case.

The badge says what the reader needs, not merely what git answered. It
used to read "not merged" whatever was going on — a fact about the
BRANCH that read as a verdict on the spec, shown in the same amber
while the step writing that branch was still running. So while the
spec's job is in flight the badge names what it is doing
(`review-plan running`), and once nothing is running it reads **ready
to merge**.

Beside the approve/cancel action sits the merge button, and it says
**Merge** — one word. What a press would land is said on the row
instead, in the State column: **ready to merge the plan** when only the
specs repo is behind, **ready to merge the code** when only the project
is, **ready to merge plan and code** when both are. The repo names stay
in the tooltip. A branch whose label is a known project name is that
project's code; a label that is not any project on this machine is the
specs repo, which is a closed set rather than a guess
(`.claude/rules/development.md`: "the run only watches ... the roots it
knows about").

Spec 96 put that sentence ON the button, because the button was where a
reader was looking; spec 132 moved it to where the rest of the row's
state lives. What 96 was for is untouched — a plan merge changes only
the specs repo, a code merge is what reaches the serving host, and the
page still says which. What went is a button whose label was a sentence
for a control with one outcome: whatever it read, pressing it merged
whatever was open. There is no choice AT the button, so there was
nothing there for a label to help decide. The button also left the
collapsed row entirely: it was the one action on this page living
outside the panel every other action lives in, and acting now means
opening the row.

While a step is still running that button is **disabled**, and a small
"merge anyway" sits beside it behind a confirmation. Merging an
unfinished spec stays possible for someone who means it; it is no
longer the thing a mouse lands on. The count is gone: `Merge (1)` said
how many repos and nothing about which kind, so a reader had to know
that one meant the specs repo, that the specs repo is the plan, and
that the running step was about to rewrite it.

With JavaScript on, the button posts from the page rather than through
a navigation — the shape every control on this page now shares, see
[what the script adds](#what-the-script-adds-specs-96-and-101).

The merge itself merges the spec branch into each repo's default branch
and pushes, one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is
  aborted, so no half-merged tree is left behind — the same shape
  `aide-run-spec` already uses when it brings a reused branch up to
  date.
- **A dirty tree decides nothing (spec 144).** It used to refuse
  before anything touched history, back when whichever side got to the
  checkout first left it dirty. A run no longer dirties the main tree
  at all — it works in a worktree of its own and only ever
  fast-forwards this one — so the refusal only ever stopped merges over
  somebody's unrelated uncommitted file. The `switch`, `pull` and
  `merge` write nothing but what differs between the commits, and a
  file that genuinely collides raises git's own error instead of a
  guess made in advance. What the two sides can still collide over is
  git's `index.lock`, and there the run yields — its pull is a
  courtesy, recorded and never fatal.
- **`index.lock` is not a conflict.** A merge that loses that race used
  to be refused with "cannot fast-forward main — merge it by hand",
  which is the same sentence a genuinely diverged base gets. The pull
  is now retried twice, a quarter of a second apart, and ONLY when
  git's own stderr names `index.lock`; every other failure is refused
  on the first attempt, as immediately as before.
- **The plan lands first, the code last.** A run records the project
  before its specs root, so the code used to merge before the plan
  describing it. The code is the one that matters, so it is the last
  word — a passenger repo named with `--extra-project-dir` counts as
  code too.
- **A code merge can install.** Merged is not deployed: for a project
  that installs itself somewhere, the default branch moving changes
  nothing on this machine. Set `AIDE_INSTALL_CMD` in that project's own
  `.aide/config` and it is run in that checkout after its code merges —
  argv, no shell, bounded by a timeout, and reported beside the merge
  rather than turning a completed merge into a failed one. Without the
  key nothing runs and the result says plainly that deploying is still
  a hand step. Either way the sentence reaches the page — in the same
  banner a refusal uses, whether the merge was posted from the page or
  by a plain form.
- **More conflicts than before are expected, not a regression.** Two
  branches touching the same file conflict at merge time, and running
  several specs side by side means it happens more often. Both sides
  refuse and name the repo rather than corrupting anything, which is
  what turns this into a merge to do by hand — or, since spec 106, into
  one more queue step (below).
- **The report is per repo, never one collective "ok".** Several repos
  cannot be merged atomically, and one succeeding while another fails
  is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and
  deleting is the one step that cannot be undone cheaply.

An unfinished spec may be merged — every step makes branches, and
merging after `analyze` is a legitimate thing to want. It goes through
the confirmed "merge anyway", so it is a choice rather than a surprise.

### Letting aide resolve a conflict (spec 106)

A conflict refusal carries a second choice beside "merge it by hand":
**Resolve**, drawn as the row's primary action because resolving is what
to do next there (spec 135). Pressing it queues an ordinary job with one
step, `resolve`, which does by machine what the by-hand routine did —
in a worktree of the spec's branch, merge origin's default branch into
it, resolve the conflicts, run the project's test command, and push the
BRANCH. The row then reads "ready to merge" again and a person presses
Merge, so the resolution is a diff they look at first. The default
branch is never touched by the step.

- **It is offered for a conflict and nothing else.** Every other
  refusal here — a branch gone from origin, a base that will not
  fast-forward, a failed push — is one a resolve step could not finish,
  and the control is absent for all of them. The gate is a
  structured `reason` field on the merge result, carried to the page as
  `errorReason=conflict`, never a match against the refusal sentence:
  that text is joined across repos before the page sees it, and a
  rewording would silently take the offer away.
- **It is a queue step like the others.** Visible on the row and the
  job page, costed, cancellable, under the same caps and concurrency
  limit, on the model the config names for it (`sonnet` — a merge is
  not an implement). The two guards that already exist hold for it
  unchanged: no two jobs for one spec run at once, and a second
  unfinished job covering the same step is refused.
- **It either finishes or puts the branch back.** Tests red, or a
  conflict `/aide-resolve` will not decide, and the merge is undone to
  the commit the branch started on. `aide-run-spec` pushes a repo only
  when its `HEAD` moved, so a branch put back reaches origin at all —
  no new rollback machinery, the gate that already exists. A step
  interrupted mid-merge is aborted by the script before the commit
  loop, so conflict markers are never committed.

Filtering and sorting work on those groups. "Active" means the spec has
something in flight; sorting by cost sorts on the sum. A step outside
the four (`explore`, `create`, `manifest`, `resolve` — valid steps the
form does not offer) is appended after them rather than dropped, so a
run is never invisible (spec 86).

## How it looks (spec 102)

One design foundation, and nothing outside it. Before spec 102 the
stylesheet was the sum of one small addition per spec: ten font sizes
with no scale, nine greys, blue/amber/red from three unrelated
palettes, and a class per control per spec (`.stepbox`, `.chip`,
`.state`, `.pip`, `.tick`, …) — a button in three versions depending on
which form it sat in.

### Tokens

`src/render/css.ts` declares every colour, type size, space and radius
ONCE, as CSS custom properties, between the `tokens:start` and
`tokens:end` sentinels — and again inside
`@media (prefers-color-scheme: dark)`, where the same ramp is read from
the other end. Every rule below the block uses `var(--…)`; nothing else
in the file may contain a literal.

The palette is the brand's: warm neutrals (paper `--bg`, card
`--surface`, ink `--text`), vermilion `--accent`, and `--danger` set to
the darkest bar of the mark rather than to a shade of the accent — so
"running" and "refused" never rest on hue alone. The refused badge is
also the only live one with a visible border, and the row that carries
it carries a `.rowmsg.err` with a warning mark beside the reason.

### Components

`src/render/components.ts` is the one place markup for them is built:

| Component       | Variants                                                                 |
|-----------------|--------------------------------------------------------------------------|
| `btn()`         | bare (secondary), `primary`, `ok`, `danger`, `busy`, disabled, `small`   |
| `badge()`       | `b-idle`, `b-running`, `b-waiting`, `b-ready`, `b-refused`, `b-done`     |
| `phaseChip()`   | `default`, `checked`, `done`, `busy`, `off` (with the reason in `title`) |
| `rowMessage()`  | `err`, `warn`, `info`                                                    |
| `field()`       | label above any control, one height and one radius                       |
| `filterPills()` | "Label · count", the chosen one marked with `aria-current`               |

`STEP_LABELS` lives there too: the `review-plan` step is SHOWN as
`review` everywhere a reader sees it, while `data-phase`, the checkbox
`value`, the queue step and the skill all keep the technical name.

The brand is `src/render/brand.ts` — the mark, the wordmark and the
favicons, all inline SVG and data URIs, because the generated site is
published as plain files and has to work opened from a folder.

### The guard

`test/css-token-guard.test.ts` fails the suite on a colour literal or
an off-scale font size anywhere in `css.ts` outside the token block,
and on any CSS class a render file emits that is not one of the
components, one of the named `queue-client.ts` selector hooks
(`rowrun`, `actionform`, `mergeform`, `refused`,
`refusal`, `newspec`, `newspecform`) or one of the short list of
structural names it writes out in full.

So a spec that wants a look it cannot build from the tokens has to
change the TOKENS — visibly, in one block — rather than add a colour
beside them.

`mergeoverride` in that allow-list and in `queue-client.ts`'s `ACTIONS`
selector is dead in production since spec 105: no render path emits it
any more (the server stopped emitting it in commit `cd81e95`, before
that spec). It stays deliberately — generic pending/disable plumbing
shared by four form classes, not worth touching `queue-client.ts`/
`queue-client.test.ts` to remove for a class nothing else needs.

### Spacing lives in the container, not the component (spec 120)

A gap between two interactive controls comes from the flex `gap` on
the row that holds them, never from a `margin` on one of the
components. Spec 102 fixed colours, sizes and radii the same way — one
token, used everywhere — but left spacing per spot: `.mergeform`,
`.actionform`, `.resolveform` and `.extra` each carried their own
`margin-left`, so a component that looked right beside one sibling
carried the wrong (or doubled) gap into the next place it was used.
`test/css-token-guard.test.ts` now asserts these classes declare no
`margin`, alongside the existing check that `tr[data-controls] .row`
still has a scoped, non-`center` `align-items` — a row that mixes a
labelled field with plain buttons needs its own baseline, not `.row`'s
default, and the override must stay scoped to that one row's
`data-controls` attribute rather than changing what `.row` means
everywhere else (the filter bar uses `.row` too).

### One busy flag, not a per-step lookup (spec 105)

A spec's queue row reads its "is anything in flight" state from a
single predicate, `specBusy()` in `queue-list.ts`, rather than each
control re-deriving it from the in-flight job's own `steps` list. The
earlier per-step lookup let a row show a step as tickable, and Run as
clickable, while a job was already running on the spec — the queue
would refuse the request, so the row promised something it could not
keep. Every control that can act on a busy row — the phase boxes, the
Run button, the model/gate/"also touches" fields, and the Merge button
in the opened row's stack — reads the same flag, so a new control
cannot forget to check it.

### A structural marker with no CSS rule uses data-*, not a class (spec 123)

`test/css-token-guard.test.ts` holds render files to a closed class
vocabulary (see [The guard](#the-guard)). A render change that needs to
mark up a structural role — nothing to style, just something a test or
a future render pass needs to find — should not grow that vocabulary
for a class that carries no CSS rule. Spec 123's per-phase caption row
(`Phase` / `Model` above the phase lines' pickers) is marked
`data-caption="1"` instead of a class for exactly this reason: adding
it to the guard's allow-list would have been accepted, but every entry
there is meant to declare tokens, and this one declares nothing.

### Theme choice (spec 107)

The nav carries a Dark/Light/Auto control, stored in the browser
(`localStorage`), not on the server — the generated pages are files
with no server in front of them when opened from a folder, so nothing
server-computed could carry the choice. An explicit pick sets
`data-theme` on `<html>`; two extra token blocks in `css.ts`,
`:root[data-theme="dark"]` and `:root[data-theme="light"]`, override
the `@media (prefers-color-scheme: dark)` block by attribute-selector
specificity (0-2-0 beats 0-1-0) regardless of source order. Auto needs
no rule at all — no attribute set falls straight through to the
existing OS-driven CSS.

**This is the one deliberate exception to "generated pages carry no
page code."** Applying the stored choice before first paint (no flash)
needs a script that runs before body content, on every page — served
and generated alike — so `src/render/shell.ts`'s `pageShell()` now
emits exactly one shared, unconditional `<script>` in `<head>`:
`src/render/theme-script.ts`, inlined the same way `serve.ts` inlines
`queue-client.ts` for the served `/` page, and tested the same way
(transpile the file and run it against a fake DOM — `theme-script.ts`
cannot `import`/`export`, for the same reason `queue-client.ts` can't).
This is a separate mechanism from `opts.script` (end-of-body,
served-`/`-only, unchanged) — a page can now carry two `<script>` tags,
so a test that locates "the" script by first occurrence will silently
grab the wrong one; find each by a substring unique to its content.

### Header and tab bar, not a sidebar (spec 119)

Every page's `<body>` is `header + nav.tabs + main` now — `pageShell()`
no longer wraps a `.layout` flex-row around a sidebar `nav()` and
`main`. `nav()` is gone; `shell.ts` builds `pageHeader()` (the wordmark,
then a "..." menu) and `tabBar()` (Specs/Projects) instead, and the
sidebar's ~12rem reserved column is gone with it.

The "..." menu is a `<details>`/`<summary>` disclosure, the same pattern
`.more`, `.newspec` and `.intro` already used — not a JS-driven popover.
That keeps `queue-routes.test.ts`'s "no page script beyond the theme
switcher" guarantee true by construction and keeps the menu working with
JavaScript off, like every other control on the site. The tab bar reuses
`filterPills()` in its `"page"` mode (the same call the job detail page
already made for its own tabs), which is why `filterPills()` now omits
the `<span class="lbl">` wrapper when its `label` argument is `""` — a
page-level tab bar needs no group caption, and the wrapper used to render
empty regardless.

`.layout`'s `min-height: 100vh` had no other rule carrying it — removing
`.layout` without carrying that forward would have let short pages (an
empty spec list) stop filling the viewport. It now sits on `body`.

## Deploying

### On a second host

`MINI=<host> make install-serve` clones or pulls the repo there (the
clone URL comes from this checkout's own `origin`), installs deps,
renders a launchd plist and starts the job. No plist is committed:
`deploy/render-plist.ts` builds it per invocation from the target's own
`$HOME`, resolved over ssh at install time. Logs go to
`~/Library/Logs/aide-dashboard/serve.log` on that host.

Everything is overridable, nothing personal is baked in:

All paths are relative to the serving host's own `$HOME`.

| Variable         | Default                       | What it is                              |
|------------------|-------------------------------|-----------------------------------------|
| `MINI`           | — required                    | the ssh target                          |
| `PORT`           | `8788`                        | port to serve on                        |
| `MINI_SRC`       | `develop/aide-dashboard`      | the checkout                            |
| `REMOTE_STATE`   | `aide-dashboard`              | site, mirrors, queue state              |
| `REMOTE_BUN`     | `.local/share/mise/shims/bun` | bun on that host                        |
| `LABEL`          | `com.aide-dashboard.serve`    | launchd job label                       |
| `QUEUE_PROJECTS` | `aide,aide-dashboard`         | the allowlist's first-boot seed         |
| `ROOT`           | unset                         | project root there (omitted when unset) |
| `BIND`           | unset                         | address to bind (omitted when unset)    |
| `CLAUDE_USAGE`   | unset                         | claude-usage URL (omitted when unset)   |

Publishing the generated site to that host is separate:
`AIDE_DASH_HOST=<host> make publish`. Before rsyncing (with `--delete`),
`deploy/rsync-publish.sh` checks that a specific file exists under
`out/` — a guard against wiping the serving host with an empty
directory. That filename is a second place the front page's identity
lives, next to the route table above: renaming which generated page is
the front page (spec 100) means updating this guard too, not just the
route strings.

### Saying it once instead of every time

Copy `.env.deploy.example` to `.env.deploy` and fill in your own
machines. The Makefile includes it, so `make install-serve` and
`make publish` stop needing a wall of variables on the command line.
The file is gitignored — which is the point: the tracked repo names
nobody's machine, and this is where yours lives instead.

### On one machine

`make serve-local` generates the site and serves `out/` from the same
machine — no ssh, no rsync, no launchd, no second host involved. `PORT=`
and an optional `ROOT=` (the directory to scan for projects) are the
only knobs. This is the whole thing running in one place.
