# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-board-wordmark-dark.svg"><img src="docs/assets/aide-board-wordmark-light.svg" alt="Aide -board" height="40"></picture>

## Table of contents

- [What it is](#what-it-is)
- [How it's used](#how-its-used)
- [Installation](#installation)
    - [Requirements](#requirements)
    - [Installing](#installing)
    - [Remote connection](#remote-connection)
- [Reference](#reference)

---

## What it is

A dashboard that automates spec-driven development with **Aide**. Create a spec, queue it through
`create` → `analyze` → `implement` → `archive`, and watch each step run — across every project
**Aide** knows about, from one page.

Under the hood: it scans a root for `.aide/project.yaml` manifests, resolves each project's specs
root, parses spec progress/phase from `4-status.md` files, and renders a small static site — an
overview page plus one page per project, all sharing a left-column nav. Generated where the repos
live and served by a small Bun server that also receives live aide-run events; that server listens
on localhost, and a proxy can put HTTPS in front of it
(see [HTTPS and other devices](docs/hosting.md#https-and-other-devices)). Generator and
server can run on the same machine or on two — no host is named anywhere in this repo.

## How it's used

Open the front page: it lists every spec across every project **Aide** knows about, grouped by
phase. New makes a spec; queuing it runs it through `create` → `analyze` → `implement` →
`archive`, and a queued job shows its live progress on the spec's row — cancel it, or add another
step to it, from there. Click into a spec for the full picture: its description, analysis, plan,
status, and every job that has run against it, in one page.

See [The specs list and the spec page](docs/the-specs-list.md) for what each row and each control
does, and [A spec's lifecycle](docs/spec-lifecycle.md) for the four phases and what moves a spec
between them.

## Installation

### Requirements

The machine that serves the dashboard needs, before it is installed:

- **git**, with `user.name` and `user.email` set: the runs commit as that user.
- **Aide**: `./install-all.sh` at the repo root. It also installs mise, node and Claude Code when they are missing,
  and bun, jq, gh, pandoc and md-to-pdf through mise.
- **An AI CLI, signed in**: run `claude` once and sign in. Codex, OpenCode or Copilot work too.

### Installing

On that machine, or on another one over ssh:

```bash
dashboard/install.sh                # on this machine — first install and every update
MINI=<host> make install-serve      # on <host>, from dashboard/ — first install
MINI=<host> make deploy-serve       # same — for updates
```

Both check the requirements on the serving machine before they change anything. They stop on anything required that
is missing, saying how to install it, and warn about the optional ones. `MINI` has no default: a deploy aimed at a
machine nobody named is worse than one that refuses to start.

On macOS the install runs the dashboard as a launchd service, which starts on its own and keeps running; the user it
runs as must have logged in on the machine's screen once, since the service runs inside that login. On other systems,
`make serve-local` in `dashboard/` runs it without a service.

Once installed, the dashboard answers on that machine alone, at `http://127.0.0.1:8788`.
[Hosting the dashboard](docs/hosting.md) covers the machine that serves it, keeping it up to date there, and installing
it as a browser app.

### Remote connection

Reaching the dashboard from a phone or another computer, over HTTPS, is an optional add-on with Tailscale: see
[Tailscale (optional)](docs/tailscale.md). Nothing in the install depends on it.

## Reference

- [Developing the dashboard](docs/developing.md) — its tests, and running it from a checkout
- [Running specs](docs/running-specs.md) — the queue, the runner, the checkouts, what a step publishes
- [The specs list and the spec page](docs/the-specs-list.md) — what a row says, what its controls do, the spec's own page
- [Projects](docs/projects.md) — adding one, whether a run can start there, the project page
- [A spec's lifecycle](docs/spec-lifecycle.md) — the four phases, what moves a spec between them, what holds one back
- [A job's states](docs/job-states.md) — the queue's state machine: the seven states, who moves a job, the flags beside it
- [Branches and landing](docs/landing.md) — how a step's branch is merged, conflicts, what stops a landing
- [Test server](docs/test-server.md) — the link a requirements review offers to run a spec's branch, and what it shows you
- [How it looks](docs/design-system.md) — tokens, components, the class vocabulary guard
- [Hosting the dashboard](docs/hosting.md) — the machine that serves it, keeping it up to date, HTTPS, installing it as an app
