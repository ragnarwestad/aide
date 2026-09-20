# <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/aide-board-wordmark-dark.svg"><img src="docs/assets/aide-board-wordmark-light.svg" alt="Aide -board" height="40"></picture>

## Table of contents

- [What it is](#what-it-is)
- [How it's used](#how-its-used)
- [Installation](#installation)
    - [Requirements](#requirements)
    - [Installing](#installing)
- [Reference](#reference)

---

## What it is

Aide's dashboard lists every spec in every project it has been given, and runs the workflow itself: you queue a
spec, and create, analyze, implement and archive run in order, on the AI CLI and the model chosen for each phase,
with several specs running at once.

How a project gets in, and where its settings are kept, is in [Projects](docs/projects.md).

## How it's used

The front page lists every spec, grouped by phase. **New** writes a spec; a queued job shows its progress on the
spec's row, and can be cancelled or given another phase from there. A spec's own page holds its four files and
every job that has run against it.

[The specs list and the spec page](docs/the-specs-list.md) says what each row and each control does, and
[A spec's lifecycle](docs/spec-lifecycle.md) covers the four phases and what moves a spec between them.

## Installation

### Requirements

The installer checks all of this on the serving machine before it changes anything, and stops with instructions
for whatever is missing. It is listed here so you can have it ready:

- **git**, with `user.name` and `user.email` set — a run commits as that user
- **Aide itself**: `./install-all.sh` at the repository root, on that machine. Every phase the dashboard runs goes
  through Aide's own scripts, so they have to be there first
- **An AI CLI, signed in**: run `claude` on that machine and sign in. Codex, OpenCode or Copilot work too

### Installing

Which command to run depends on where the dashboard will run:

| Where it will run               | Command, from the repository root                   |
|---------------------------------|-----------------------------------------------------|
| This machine, on macOS          | `dashboard/install.sh`                              |
| Another macOS machine, over ssh | `MINI=<host> make install-serve`, from `dashboard/` |
| Linux, which has no launchd     | `dashboard/serve.sh`                                |

The first two are the same command for a first install and for every update after it. Over ssh, it clones the
repository on that host the first time and pulls it on every later run, so nothing has to be put there by hand —
but the sign-in is yours to do there, over ssh, since it is interactive. Set `MINI` to the host's name; it has no
default.

On macOS the install runs the dashboard as a launchd service, `com.aide-dashboard.serve`, which starts on its own
and keeps running. The user it runs as must have logged in on the machine's screen once, since the service runs
inside that login; without it, the job is installed and the port answers nothing.
`launchctl kickstart -k gui/$(id -u)/com.aide-dashboard.serve` restarts it, and
[Hosting the dashboard](docs/hosting.md) has the logs, the arguments it was loaded with, and how to remove it.

`install.sh` does not support Linux: it says so and installs nothing. `dashboard/serve.sh` runs the dashboard in
a terminal instead, queue included, with the same arguments and the same state under `~/.aide/dashboard` as the
service, and checks the same requirements first. It runs until it is stopped and does not start again after a
reboot. `PORT`, `BIND`, `ROOT` and `QUEUE_PROJECTS` are given to it as `NAME=value` arguments. On Windows, all of
this runs inside WSL.

Once it is installed, the dashboard answers at `http://127.0.0.1:8788`, on that machine alone. Reaching it from
another device is [Hosting the dashboard](docs/hosting.md) and [Tailscale](docs/tailscale.md). The first thing to
do there is add a project, which [Projects](docs/projects.md) covers.

## Reference

- [Developing the dashboard](docs/developing.md) — its tests, and running it from a checkout
- [Running specs](docs/running-specs.md) — the queue: making a spec, time limits, which AI runs a step, schedules
- [The runner and its checkouts](docs/the-runner.md) — what a run does to the repositories, and what a step publishes
- [The specs list and the spec page](docs/the-specs-list.md) — what a row says, what its controls do, the spec's own page
- [Projects](docs/projects.md) — adding one, whether a run can start there, the project page
- [A spec's lifecycle](docs/spec-lifecycle.md) — the four phases, what moves a spec between them, what holds one back
- [A job's states](docs/job-states.md) — the queue's state machine: the seven states, who moves a job, the flags beside it
- [Branches and landing](docs/landing.md) — how a step's branch is merged, conflicts, what stops a landing
- [Test server](docs/test-server.md) — the link a requirements review offers to run a spec's branch, and what it shows you
- [Error sentences](docs/error-sentences.md) — the one rule every error the board shows follows
- [The dashboard's HTTP routes](docs/http-routes.md) — every path, its method, whether it reads or acts
- [How it looks](docs/design-system.md) — tokens, components, the class vocabulary guard
- [The hand-paired bash/TypeScript pairs](docs/bash-typescript-decisions.md) — the decisions made twice, and the tests that pin them together
- [Hosting the dashboard](docs/hosting.md) — the machine that serves it, keeping it up to date, HTTPS, installing it as an app
- [Tailscale](docs/tailscale.md) — optional: reaching the dashboard from a phone or another computer, over HTTPS
