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
  - [How many run at once](#how-many-run-at-once)
  - [Gates and notifications](#gates-and-notifications)
  - [What a finished step publishes](#what-a-finished-step-publishes)
  - [How the list reads](#how-the-list-reads)
  - [What the script adds (specs 96 and 101)](#what-the-script-adds-specs-96-and-101)
  - [Branches, and merging them](#branches-and-merging-them)
- [How it looks (spec 102)](#how-it-looks-spec-102)
  - [Tokens](#tokens)
  - [Components](#components)
  - [The guard](#the-guard)
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
  line, watch one, approve a gate (token required). The front page: it
  is what the dashboard is used for, so it is what the dashboard opens
  on.
- `/projects.html` — overview: every project with description and
  active/archived spec counts. Reached from the nav, labelled
  "Overview"; no token needed, like every other generated page.
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
  `POST /api/queue/<id>/approve` and `/cancel` act on one. The API keeps
  the queue's own name: it is a contract, not a page anyone reads.
- `POST /api/queue/create` — project, title and description in; a job
  that MAKES a spec out, which then lands itself and becomes an ordinary
  row (token required, like the rest of `/api/queue*`)

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

One way in: the spec's own row. It carries a checkbox per phase, a
model dropdown, and one Run button that queues everything ticked as a
single job in the workflow's order — the browser submits checkboxes in
the order they are drawn, so ticking `implement` before `analyze` still
queues analyze first. Behind a "more" disclosure sit the two things
nobody sets every time: which other repos the job will touch, and
whether to stop for approval between the steps (off by default).

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

Under the spec's name sits one line for what a reader came to find out:
what is going on and what the next click is — "analyze running —
review-plan to follow", "waiting for your approval to carry on", "done
— the branch is waiting to be merged", "press Run to try implement
again". It invents no vocabulary: the sentence is built from the same
`stateLabel`/`currentStep` the chip and the phase lines use, so the row
cannot say one thing in two ways. Everything it summarises is still
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
not exist yet has no row — so above the table there is a shut "New spec"
panel: a project, a title, a description, and a Create button that posts
to `POST /api/queue/create`. It queues an ordinary job whose single step
is `create`, and the run is guarded, budgeted and timed exactly like any
other.

Two things about it are worth knowing:

- **The project list is the raw allowlist** (`QUEUE_PROJECTS`), not the
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

When the step succeeds the dashboard **lands the branch itself**, through
the same `mergeBranchIntoDefault` the Merge button uses, and renames the
job to the real folder. This is the one merge here that nobody pressed a
button for, and it is not a convenience: the list shows what is on disk
in the main checkout, which every run keeps on its default branch, so a
created spec that is only pushed to a branch appears nowhere at all. A
landing that fails leaves the provisional key in place and says which
repo and why — merge that one by hand. **While any job is landing the
scheduler starts nothing at all**, whatever the concurrency is set to: a
landing merges into the shared main checkout, which worktree isolation
does not cover.

The list holds SPECS, not the machine's whole run history: a spec that
has been archived leaves the page along with the jobs it had. Nothing is
destroyed — `/api/queue` still returns every job and `/specs/<id>` still
renders each one. A project the server knows no specs for at all keeps
every row it has: an empty spec list means "we cannot tell", never
"everything here is archived".

A spec's four phase lines fold away behind the control in front of its
name. The fold is a link and lives in the query string
(`?fold=<project>/<folder>,…`), which is what makes it survive the
table's own five-second refresh — and what makes it work with JavaScript
switched off.

Every control here is a plain form first: ticking phases and pressing
Run works with JavaScript switched off, and so do Approve, Cancel,
Merge, Create and the fold — each posts its form and follows a 303 back
to the list. `queue-client.ts` is a layer ABOVE that floor, never the
mechanism (see
[what the script adds](#what-the-script-adds-specs-96-and-101)). It
cannot `import` anything: `queueClientScript()` runs
`Bun.Transpiler.transformSync` over it and inlines the result into a
plain `<script>` tag — that transpiles, it does not bundle. An
`import` survives as an ESM import inside a
classic inline script (a 404, since this server does not serve that
path), and an `export` is a syntax error. Any shared, unit-testable
browser module needs a bundle step or a `type="module"` tag first; the
fold was built to need neither.

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

The whole queue surface — `GET /` and its old addresses `/specs` and
`/queue` included — needs a token; a token a page hands to anyone who
can load the page is not a secret. Open
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
  "model": { "implement": "opus", "default": "sonnet" },
  "push": "branch",
  "concurrency": 2,
  "notifyCommand": ["/Users/<you>/aide-dashboard/notify-slack.sh"]
}
```

A job may only TIGHTEN a cap, and cannot set the permission mode at all.
A timed-out step is charged its full budget: the accounting over-charges
what it could not measure, never the other way round.

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

### Gates and notifications

A gate sits BETWEEN steps, never inside one. By default, every step
gates: the job parks in `awaiting-approval`, the notifier fires once,
and nothing starts until someone presses Approve. A job posted with
`gateAfter: []` runs straight through.

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line
of JSON on stdin (claude-usage's contract, copied so one wrapper can
serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a
second later, and absent unless configured. `deploy/notify-slack.sh` is
the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done, waiting for approval · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
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

One row per spec, not per job. Underneath it sit the four workflow
phases — analyze, review-plan, implement, archive — always in that
order, so how far a spec has got is readable without counting rows. A
phase never run shows a muted "not run yet". A phase run more than once
shows its LATEST attempt with the count beside it, because a re-run is
ordinary: one spec needed three `archive` runs.

The header carries what belongs to the spec rather than to one run: the
summed cost, one link per repo the spec pushed to, and the state that
matters most right now — whatever is in flight, else the most recent
outcome. The approve/cancel action sits there too, once per spec
instead of once per job.

### What the script adds (specs 96 and 101)

The page's own browser code does one thing to the controls: it keeps
the reader where they are. Every one of the five — Run, Approve,
Cancel, Merge, Create — is a real `<form>` that works on its own, and
the script only intercepts.

- **A press changes the button at once.** It disables and says what it
  is doing ("starting…", "approving…", "cancelling…", "merging…",
  "creating…"). The wording is in the markup, as `data-pending` beside
  the label it replaces, not in a verb table inside the script.
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
what pressing it will land: **Merge the plan** when only the specs repo
is behind, **Merge the code** when only the project is, **Merge the
plan and the code** when both are. The repo names stay in the tooltip.
A branch whose label is a known project name is that project's code; a
label that is not any project on this machine is the specs repo, which
is a closed set rather than a guess (`.claude/rules/development.md`:
"the run only watches ... the roots it knows about").

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
- **A dirty tree refuses before anything touches history.** A lock
  against a concurrent run is still unnecessary, though not for the
  reason it once was: a run no longer dirties the main tree at all,
  since it works in a worktree of its own and only ever fast-forwards
  this one. What the two can collide over is git's `index.lock`, and
  there the run yields — its pull is a courtesy, recorded and never
  fatal.
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
  what turns this into a merge to do by hand.
- **The report is per repo, never one collective "ok".** Several repos
  cannot be merged atomically, and one succeeding while another fails
  is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and
  deleting is the one step that cannot be undone cheaply.

An unfinished spec may be merged — every step makes branches, and
merging after `analyze` is a legitimate thing to want. It goes through
the confirmed "merge anyway", so it is a choice rather than a surprise.

Filtering and sorting work on those groups. "Active" means the spec has
something in flight; sorting by cost sorts on the sum. A step outside
the four (`explore`, `create`, `manifest` — valid steps the form does
not offer) is appended after them rather than dropped, so a run is never
invisible (spec 86).

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

| Component | Variants |
|---|---|
| `btn()` | bare (secondary), `primary`, `ok`, `danger`, `busy`, disabled, `small` |
| `badge()` | `b-idle`, `b-running`, `b-waiting`, `b-ready`, `b-refused`, `b-done` |
| `phaseChip()` | `default`, `checked`, `done`, `busy`, `off` (with the reason in `title`) |
| `rowMessage()` | `err`, `warn`, `info` |
| `field()` | label above any control, one height and one radius |
| `filterPills()` | "Label · count", the chosen one marked with `aria-current` |

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
(`rowrun`, `actionform`, `mergeform`, `mergeoverride`, `refused`,
`refusal`, `newspec`, `newspecform`) or one of the short list of
structural names it writes out in full.

So a spec that wants a look it cannot build from the tokens has to
change the TOKENS — visibly, in one block — rather than add a colour
beside them.

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

| Variable | Default | What it is |
| --- | --- | --- |
| `MINI` | — required | the ssh target |
| `PORT` | `8788` | port to serve on |
| `MINI_SRC` | `develop/aide-dashboard` | the checkout |
| `REMOTE_STATE` | `aide-dashboard` | site, mirrors, queue state |
| `REMOTE_BUN` | `.local/share/mise/shims/bun` | bun on that host |
| `LABEL` | `com.aide-dashboard.serve` | launchd job label |
| `QUEUE_PROJECTS` | `aide,aide-dashboard` | what the queue may run |
| `ROOT` | unset | project root there (omitted when unset) |
| `BIND` | unset | address to bind (omitted when unset) |
| `CLAUDE_USAGE` | unset | claude-usage URL (omitted when unset) |

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
