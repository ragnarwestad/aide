# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs](#live-runs)

Longer pages of their own:

- [Running specs](docs/running-specs.md) — the queue, the runner, the checkouts, what a step publishes
- [The specs list and the spec page](docs/the-specs-list.md) — what a row says, what its controls do, the spec's own page
- [Branches and landing](docs/landing.md) — how a step's branch is merged, conflicts, what stops a landing
- [How it looks](docs/design-system.md) — tokens, components, the class vocabulary guard
- [Deploying](docs/deploying.md) — HTTPS, the serving host, installing it as an app

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root, parses spec progress/phase from `4-status.md` files,
and renders a small static site — an overview page plus one page per project, all sharing a left-column nav. Generated
where the repos live and served by a small Bun server that also receives live aide-run events; that server listens on
localhost, and a `tailscale serve` proxy puts HTTPS in front of it
(see [HTTPS, and the one address](docs/deploying.md#https-and-the-one-address)). Generator and server can run on the same machine or on
two — no host is named anywhere in this repo.

## URL scheme

This is the map. The rules behind each page — what a row says, what a tab shows, what a route refuses — are in
[The specs list and the spec page](docs/the-specs-list.md) and [Running specs](docs/running-specs.md). Every served page and every `/api/queue*` route requires
[the token](docs/running-specs.md#the-token); the generated `.html` pages and the app-install files do not.

Pages:

- `/` — the spec list: one row per spec of every allowlisted project, phases beneath, run and cancel from the row.
  `?state=` picks a chip and `?q=` searches;
  see [Filtering and searching the list](docs/the-specs-list.md#filtering-and-searching-the-list).
- `/new` — the form that makes a spec. Create queues the job and returns to the list; Cancel returns having done nothing.
- `/projects` — every project with its spec counts, plus the panel that adds and removes them.
- `/projects/<name>` — one project: what its `.aide/config` says, whether a run could start there, and the settings
  that can be edited inline.
- `/settings` — the default AI and model per step.
- `/specs/<project>/<spec>` — the whole spec in seven tabs; see [The spec page](docs/the-specs-list.md#the-spec-page).
- `/specs/<id>` — one job, in full. Nothing links here any more; the route stays because an old link is a promise.
- `/<slug>.html` — one generated page per project (slug = lowercased name, non-alphanumerics → hyphens; collisions get
  `-2`, `-3`, …; `index`, `about` and `projects` are reserved). It is what a site published by
  `deploy/rsync-publish.sh`, with no server behind it, still shows; a live server's nav links `/projects/<name>` instead.

Queue API (`/api/queue*`):

- `GET /api/queue` — the jobs as JSON; `POST /api/queue` enqueues one; `POST /api/queue/<id>/cancel` cancels one.
  There is no `approve` and no `merge`: every step lands its own work.
- `POST /api/queue/<id>/steps` — add or remove a phase at the tail of a running job.
- `POST /api/queue/create` — project, title and description in; a job that makes a spec out.
- `POST /api/queue/specs/<project>/<spec>/save` — write, commit and push the Description tab.
- `POST /api/queue/specs/<project>/<spec>/tick` — the same for the check boxes on Overview, `4-status.md` alone.
- `POST /api/queue/specs/<project>/<spec>/update` — pull the specs checkout.
- `POST /api/queue/settings` — save the per-step defaults.
- `POST /api/queue/projects` and `POST /api/queue/projects/<name>/remove` — the Projects panel's two actions.
- `GET /api/queue/events` — `text/event-stream`; a bare `changed` event whenever something moved.

Live runs:

- `GET /api/aide-runs` — aide runs in flight, as JSON; `POST /api/aide-run` receives one event. No page renders them:
  the spec list shows every queued run per row, and interactive sessions are claude-usage's own page.

Redirects and retired routes:

- `/specs` and `/queue` redirect to `/`, query string intact; `/queue/<id>` to `/specs/<id>`; `/projects.html` to
  `/projects` (the file stays: bookmarks point at it, and `deploy/rsync-publish.sh` refuses to publish a site without
  it); `/projects/<name>/settings` to `/projects/<name>`.
- `GET /specs/<project>/<spec>/edit` and `POST .../status/tick` answer 404: a retired route is removed, not redirected.

App install: `/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`, `/icon-512-maskable.svg` and `/apple-touch-icon.png`,
without a token — a manifest fetch that answers 401 is a page no browser offers to install. See "Installing it as an
app" under [Deploying](docs/deploying.md).

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

Both `AIDE_DASH_HOST` and `MINI` are required and have no default: a sync with `--delete` aimed at a machine nobody
named is worse than one that refuses to start.

The remote site directory (`~/aide-dashboard/site` on the serving host)
must remain exclusively the dashboard's: publish syncs with `--delete`, so anything else placed there is removed on the
next publish.

## Live runs

A Claude Code `UserPromptSubmit` hook (`aide-emit-run`, installed by aide to `~/.local/bin`) POSTs one small event per
slash-launched
`/aide-*` command — host, session id, command, spec, project; never the prompt text. It is inert until `AIDE_RUN_URL` is
set. aide's
`install.sh` prints the ready-to-paste block; on this laptop it lives in `~/.claude/settings.json` as:

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

That hook is one of two producers, and only this one is a person's own setting. The other is the queue itself (spec
222): when the runner spawns a step, it hands the child `AIDE_RUN_URL` pointing at this server's own `/api/aide-run`,
derived from the port it actually bound, so the TDD phases of a headless run reach the row with nothing configured on
the machine. Before that, every phase report from a headless step exited silently and the rows sat at `phase: null`. An
`AIDE_RUN_URL` already in the server's own environment is left alone, so pointing reporting at another sink still works.

The address in that block is the HTTPS one; the `:8788` address answers on the
serving host itself and nowhere else. A bookmark carrying `?token=` works on the HTTPS address, and a browser signed
in on the old one signs in once more, because the token cookie belongs to the origin it was set on.

The job page (and `/api/aide-runs`) merge the stored runs with claude-usage's `/api/live` (same host — but if
claude-usage there binds one address only, pass it explicitly: `CLAUDE_USAGE=http://<address>:8787 make install-serve`;
fetched lazily and cached 5 s): liveness state, subagent count and cost so far. claude-usage unreachable → rows render
without enrichment and a notice; never an error. Runs are kept in memory (LRU 512) and mirrored to
`~/aide-dashboard/aide-runs.json`
so restarts keep them.
