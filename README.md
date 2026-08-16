# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs (spec 80)](#live-runs-spec-80)
- [The queue (spec 81)](#the-queue-spec-81)
  - [The token](#the-token)
  - [Caps](#caps)
  - [Gates and notifications](#gates-and-notifications)
  - [What a finished step publishes](#what-a-finished-step-publishes)
- [Serving on the mac mini](#serving-on-the-mac-mini)

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root,
parses spec progress/phase from `4-status.md` files, and renders a
small static site — an overview page plus one page per project, all
sharing a left-column nav. Generated on the laptop (where the repos
live), served on the always-on mac mini, port 8788, by a small Bun
server that also receives live aide-run events.

## URL scheme

- `/` — overview: every project with description and active/archived
  spec counts
- `/<slug>.html` — one page per project (slug = lowercased name,
  non-alphanumerics → hyphens; collisions get `-2`, `-3`, …)
- `/live` — aide runs in flight (server-rendered, refreshes every 10 s)
- `/api/aide-runs` — the same rows as JSON; `POST /api/aide-run`
  receives one event
- `/queue` — the job queue: enqueue a spec, watch a job, approve a gate
  (token required)
- `/api/queue` — the same jobs as JSON; `POST /api/queue` enqueues one;
  `POST /api/queue/<id>/approve` and `/cancel` act on one

Keep the scheme stable: the pages are linked from outside.

## Usage

```bash
make test           # tsc + bun test (single-run)
make generate       # write the site to out/
make publish        # generate + rsync out/ to the mac mini (--delete:
                    # pages removed locally disappear remotely too)
make install-serve  # clone/pull + bun install + launchd job on the mini
make deploy-serve   # same — for updates
```

The remote site directory (`~/aide-dashboard/site` on the mini) must
remain exclusively the dashboard's: publish syncs with `--delete`, so
anything else placed there is removed on the next publish.

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
      "command": "AIDE_RUN_URL=\"http://rw-macmini-m2:8788/api/aide-run\" '/Users/<you>/.local/bin/aide-emit-run'" }] }]
  }
}
```

`/live` merges the stored runs with claude-usage's `/api/live`
(same host — but claude-usage there binds its Tailscale IP only, so
the plist passes `--claude-usage http://100.115.106.17:8787`; fetched
lazily and cached 5 s): liveness
state, subagent count and cost so far. claude-usage unreachable →
rows render without enrichment and a notice; never an error. Runs are
kept in memory (LRU 512) and mirrored to `~/aide-dashboard/aide-runs.json`
so restarts keep them.

## The queue (spec 81)

`/queue` runs aide workflow steps headless on this machine: one job at a
time, each step a `claude -p "/aide-<step> <spec>"` process started by
aide's `aide-run-spec`. A job is an ordered list of steps; a step that
ends either advances the job, parks it for approval, or ends it.

Nothing is guessed at across a restart: the runner spawns detached, in
its own process group (measured: such a child survives
`launchctl bootout`), and **the result file is the contract** — the
scheduler polls the pid and the file, and a job left `running` is
reconciled from both.

A run that hits a cap is **stopped**, never **failed**. With caps this
tight a cap-stop is a common, healthy outcome, and a reader who cannot
tell it from a broken agent will start ignoring both.

### The token

The whole queue surface — `GET /queue` included — needs a token; a token
a page hands to anyone who can load the page is not a secret. Open
`/queue?token=<the token>` once and the browser keeps an `HttpOnly`
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
  "notifyCommand": ["/Users/ragnarwestad/aide-dashboard/notify-slack.sh"]
}
```

A job may only TIGHTEN a cap, and cannot set the permission mode at all.
A timed-out step is charged its full budget: the accounting over-charges
what it could not measure, never the other way round.

### Gates and notifications

A gate sits BETWEEN steps, never inside one. By default every step
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

- `none` — commit locally and stop. Review by fetching from the mini.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs
  repo's own commits. The queue page and the notification then link to
  the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the mini;
  a broken `gh` records the error and leaves the run successful.

## Serving on the mac mini

`deploy/com.ragnarwestad.aide-dashboard-serve.plist` runs
`bun run src/serve.ts serve --site ~/aide-dashboard/site --port 8788`
from a checkout at `~/develop/aide-dashboard` (bun via the mise shim
path — bare `bun` is not on launchd's PATH). Logs:
`~/Library/Logs/aide-dashboard/serve.log`.
