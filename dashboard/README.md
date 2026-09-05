# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-board-wordmark-dark.svg"><img src="docs/assets/aide-board-wordmark-light.svg" alt="aide -board" height="40"></picture>

## Table of contents

- [What it is](#what-it-is)
- [How it's used](#how-its-used)
- [Installation](#installation)
- [Development](#development)
- [Reference](#reference)

---

## What it is

A dashboard that automates spec-driven development with **aide**. Create a spec, queue it through
`create` → `analyze` → `implement` → `archive`, and watch each step run — across every project
**aide** knows about, from one page.

Under the hood: it scans a root for `.aide/project.yaml` manifests, resolves each project's specs
root, parses spec progress/phase from `4-status.md` files, and renders a small static site — an
overview page plus one page per project, all sharing a left-column nav. Generated where the repos
live and served by a small Bun server that also receives live aide-run events; that server listens
on localhost, and a `tailscale serve` proxy puts HTTPS in front of it
(see [HTTPS, and the one address](docs/deploying.md#https-and-the-one-address)). Generator and
server can run on the same machine or on two — no host is named anywhere in this repo.

## How it's used

Open the front page: it lists every spec across every project **aide** knows about, grouped by
phase. New makes a spec; queuing it runs it through `create` → `analyze` → `implement` →
`archive`, and a queued job shows its live progress on the spec's row — cancel it, or add another
step to it, from there. Click into a spec for the full picture: its description, analysis, plan,
status, and every job that has run against it, in one page.

See [The specs list and the spec page](docs/the-specs-list.md) for what each row and each control
does, and [A spec's lifecycle](docs/spec-lifecycle.md) for the four phases and what moves a spec
between them.

## Installation

```bash
MINI=<host> make install-serve      # clone/pull + deps + launchd job there — first install
MINI=<host> make deploy-serve       # same — for updates
```

Both required, no default: a sync aimed at a machine nobody named is worse than one that refuses
to start. See [Deploying](docs/deploying.md) for HTTPS, the serving host, and installing it as a
browser app.

A server is not required — `make serve-local` generates the site and serves it on this machine
with no launchd job, and `AIDE_DASH_HOST=<host> make publish` generates it and rsyncs it to a host
as a plain static site, with no server behind it at all (see [Development](#development) for both).

## Development

```bash
make test                           # tsc + bun test (single-run)
make generate                       # write the site to out/
make serve-local                    # generate + serve out/ on this machine
AIDE_DASH_HOST=<host> make publish  # generate + rsync out/ to that host
                                    # (--delete: pages removed locally
                                    # disappear remotely too)
```

`AIDE_DASH_HOST` is required and has no default, for the same reason as `MINI` above. The remote
site directory (`~/aide-dashboard/site` on the serving host) must remain exclusively the
dashboard's: publish syncs with `--delete`, so anything else placed there is removed on the next
publish.

## Reference

- [Running specs](docs/running-specs.md) — the queue, the runner, the checkouts, what a step publishes
- [The specs list and the spec page](docs/the-specs-list.md) — what a row says, what its controls do, the spec's own page
- [Projects](docs/projects.md) — adding one, whether a run can start there, the project page
- [A spec's lifecycle](docs/spec-lifecycle.md) — the four phases, what moves a spec between them, what holds one back
- [A job's states](docs/job-states.md) — the queue's state machine: the seven states, who moves a job, the flags beside it
- [Branches and landing](docs/landing.md) — how a step's branch is merged, conflicts, what stops a landing
- [How it looks](docs/design-system.md) — tokens, components, the class vocabulary guard
- [Deploying](docs/deploying.md) — HTTPS, the serving host, installing it as an app
