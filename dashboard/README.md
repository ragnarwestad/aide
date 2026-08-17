# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs (spec 80)](#live-runs-spec-80)
- [Running specs (spec 81)](#running-specs-spec-81)
  - [The token](#the-token)
  - [Caps](#caps)
  - [Gates and notifications](#gates-and-notifications)
  - [What a finished step publishes](#what-a-finished-step-publishes)
  - [How the list reads](#how-the-list-reads)
  - [Branches, and merging them](#branches-and-merging-them)
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

- `/` — overview: every project with description and active/archived
  spec counts
- `/<slug>.html` — one page per project (slug = lowercased name,
  non-alphanumerics → hyphens; collisions get `-2`, `-3`, …)
- `/live` — aide runs in flight (server-rendered, refreshes every 10 s)
- `/api/aide-runs` — the same rows as JSON; `POST /api/aide-run`
  receives one event
- `/specs` — one row per spec — every non-archived spec of every
  allowlisted project, whether or not it has ever run — with its
  workflow phases beneath, foldable away; run any phase from its own
  line, watch one, approve a gate (token required)
- `/specs/<id>` — one job, in full
- `/queue` and `/queue/<id>` — where the page used to live; both
  redirect, query string intact, so an old bookmark still lands
- `/api/queue` — the same jobs as JSON; `POST /api/queue` enqueues one;
  `POST /api/queue/<id>/approve` and `/cancel` act on one. The API keeps
  the queue's own name: it is a contract, not a page anyone reads.

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

`/live` merges the stored runs with claude-usage's `/api/live` (same
host — but if claude-usage there binds one address only, pass it
explicitly: `CLAUDE_USAGE=http://<address>:8787 make install-serve`;
fetched lazily and cached 5 s): liveness
state, subagent count and cost so far. claude-usage unreachable →
rows render without enrichment and a notice; never an error. Runs are
kept in memory (LRU 512) and mirrored to `~/aide-dashboard/aide-runs.json`
so restarts keep them.

## Running specs (spec 81)

`/specs` runs aide workflow steps headless on this machine: one job at a
time, each step a `claude -p "/aide-<step> <spec>"` process started by
aide's `aide-run-spec`. A job is an ordered list of steps; a step that
ends either advances the job, parks it for approval, or ends it.

Two ways in, and they do different jobs. The form at the top queues
SEVERAL steps as one job, gated between them if asked. Every phase line
under a spec carries its own run button and model dropdown: one step,
straight through, on the model the line picked — including `analyze`,
because a spec is a row from the moment its folder exists rather than
from the moment it first runs. A phase already queued or running shows
its button disabled, because the queue would refuse it anyway (see
[the duplicate guard](#gates-and-notifications)).

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

The whole queue surface — `GET /specs` and the old `/queue` included —
needs a token; a token a page hands to anyone who can load the page is
not a secret. Open
`/specs?token=<the token>` once and the browser keeps an `HttpOnly`
cookie; API callers send `X-Aide-Token`. The token is read from a file
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
  "notifyCommand": ["/Users/<you>/aide-dashboard/notify-slack.sh"]
}
```

A job may only TIGHTEN a cap, and cannot set the permission mode at all.
A timed-out step is charged its full budget: the accounting over-charges
what it could not measure, never the other way round.

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

### Branches, and merging them

A job that touches two repositories makes a branch of the same name in
both — `aide/89-merge-from-the-dashboard` exists in the project and in
the specs repo, with different contents and two separate compare pages.
Merging one does nothing for the other, and that went unnoticed three
times on one day. So the header names **every** repo the spec pushed
to, each with its own compare link and its own "not merged" text, each
asked of that repo's own checkout. A project whose specs live inside it
(`paceup`, `atlasaurus`) has one repo and reads as a list of one —
the same code, not a special case.

Beside the approve/cancel action sits **Merge (N)**, where N is how
many repos are still unmerged; the button's tooltip names them. It
merges the spec branch into each repo's default branch and pushes,
one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is
  aborted, so no half-merged tree is left behind — the same shape
  `aide-run-spec` already uses when it brings a reused branch up to
  date.
- **A dirty tree refuses before anything touches history.** That is
  also what makes a lock against a concurrent run unnecessary: both
  operations already refuse on the same condition.
- **The report is per repo, never one collective "ok".** Several repos
  cannot be merged atomically, and one succeeding while another fails
  is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and
  deleting is the one step that cannot be undone cheaply.

An unfinished spec may be merged — every step makes branches, and
merging after `analyze` is a legitimate thing to want. The count on the
button says what it will take before it is pressed.

Filtering and sorting work on those groups. "Active" means the spec has
something in flight; sorting by cost sorts on the sum. A step outside
the four (`explore`, `create`, `manifest` — valid steps the form does
not offer) is appended after them rather than dropped, so a run is never
invisible (spec 86).

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
`AIDE_DASH_HOST=<host> make publish`.

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
