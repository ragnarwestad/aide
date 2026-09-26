# Test server

When a spec's `archive` step is held back because its acceptance criteria still need reviewing —
someone has to go through the Status tab and tick each requirement off before it can be archived —
the specs list offers that reviewer a link to start a test server: a running copy of the project,
built from that spec's own branch, on the same machine as this dashboard. Open it and click through
the change instead of reading the diff again.

## Table of contents

- [Where you find it](#where-you-find-it)
- [What happens when you click it](#what-happens-when-you-click-it)
- [What you are looking at](#what-you-are-looking-at)
- [What it costs](#what-it-costs)
- [Checking on it afterwards](#checking-on-it-afterwards)
- [Stopping it](#stopping-it)
- [Running the sample specs again](#running-the-sample-specs-again)
- [After the dashboard restarts](#after-the-dashboard-restarts)
- [Which commit it serves](#which-commit-it-serves)
- [Which projects this works for](#which-projects-this-works-for)
- [Under the hood](#under-the-hood)

---

## Where you find it

On the specs list, a spec waiting only on that requirements review gets a second note on its row,
beside the "archive held back" one: **"Click the link to start a test server running this
branch."** The branch has to be on origin — a test server is built from what origin has, so work
that is still only on your own machine is refused with "no such branch on origin".

A project's own page has a second entry point, on its Deploy tab: beside "Deploy for prod", a
"Test server with the test specs" section with its own "Start test server" button. It starts a test
server from the project's latest main rather than from a spec's branch, for when you want to try
the project as it stands today. It opens in a new tab the same way.

The two differ on a second press:

| Pressed again                | What happens                                                                                  |
|------------------------------|-----------------------------------------------------------------------------------------------|
| **The link on a spec's row** | Takes you to the one that link already started, whatever state it is in — never a second one. |
| **The Deploy tab's button**  | Stops the one it started and starts a fresh one, so it ends up running the latest main.       |

## What happens when you click it

The link opens a new tab and holds it: building a test server takes a minute or two, not seconds,
so the page you land on says so and waits — "leave it open". It checks again every few seconds on
its own; there is nothing to click or refresh by hand.

The moment the server answers, that same tab is carried straight to it — that is well before the
test run has finished: the specs on it are created one by one, and you watch the list fill.

If it failed to start, the tab says so with the reason it gave, and offers **Try again**, which
clears the failed attempt and starts a fresh server. Having closed that tab, click the same link on
the spec's row again: it brings the failure and its **Try again** back. The spec page's own banner
states the failure but carries no button.

A test server runs on the same machine as this dashboard, on one of six ports, 8801 to 8806. You
reach it through this dashboard's own link, on the same address you use for the dashboard itself —
the `127.0.0.1` address the start-up log prints is the serving machine's own, and means nothing on
yours. Reaching those ports from another device is a one-off setup on the host, described in
[tailscale.md](tailscale.md). A host that exposes none of the ports starts test servers as before;
one that exposes some but not all refuses a port it left out and names the command to run there.

With all six ports in use, the start refuses as well: "N of 6 test servers are already running —
open Test servers (⋯ menu) and stop one before starting another".

## What you are looking at

**A spec in aide itself.** The test server is the dashboard, running your branch's own code. What
it holds is not your work: it builds a throwaway project with its own repositories in a temporary
directory, seeds eleven sample specs into it, and shows those. Your real projects and your real
specs are not on it and cannot be reached from it — its own banner says so, "The specs shown are
from the test suite, not the ones on the prod dashboard". Press anything you like there. No model
is used either: a stand-in script answers in place of one, so queueing a step or pressing Run on a
test server costs nothing.

**A spec in any other project.** The test server is that project's own dev server, started from
your spec's branch. What it holds is what that dev server normally holds on this machine: the local
settings and the database it is pointed at, linked into the checkout. Pressing things there does
what pressing them in your own dev server does. Migrations are not run for you: a branch that adds
one is served against the database as it stands.

## What it costs

- A minute or two to start.
- One of six ports, 8801 to 8806, for as long as it runs.
- Nothing in model spend for a test server in aide — the sample specs go through with a stand-in in
  place of the model. Another project's test server runs that project's own command, and costs
  whatever that command costs.
- No time limit: a test server runs until something stops it. Most stop themselves, per
  [Stopping it](#stopping-it) — the one started on a spec that stays held back is the one you have
  to remember.

## Checking on it afterwards

The spec's own page shows the same starting/running/failed state, in the banner above the tabs so it
is there whichever tab is open, for as long as a test server exists for it, with a link to the
running one — useful once you have closed the tab the server opened and want to get back to it, or
check whether one that was still starting has come up.

## Stopping it

Three places to press Stop:

- **The spec's own page**, while its test server is running. A starting or a failed one shows a
  sentence there instead.
- **The Test servers list**, in the "⋯" menu beside Settings. Every test server on the machine is
  listed there, whichever spec started it, with its project, spec, branch and status, and a Stop of
  its own whatever its state. This is where you go to free a port when all six are taken.
- **The test server's own header.** Every page there carries a line naming the machine and the spec
  it runs ("*machine* - Test - *spec number*", with the folder and branch in its tooltip), with a
  **Stop** button beside it. It frees the worktree, the log and the port the same way the other two
  do, without going back to this dashboard.

Two cases need no press at all:

- **Its archive lands.** Once the acceptance criteria are ticked and the `archive` step merges — or
  the spec is closed — the test server stops with it. An archive that stays held back never lands,
  and its test server keeps running.
- **It is gone already.** A crash, or a process killed outside these buttons: the next load of the
  spec page or the Test servers list notices and clears the entry.

On the spec page the link and the Stop button stay after a spec is marked archived, so a test server
still up can be opened and stopped from there. Starting one is the other way round: an archived row
carries no start link, and a start reached directly for an archived spec is refused.

## Running the sample specs again

A test server started from the Deploy tab carries a **Run** button beside Stop: it puts the eleven
sample specs through again on that same server, the server itself left as it is. Whatever the last
run left is cleared first — its jobs cancelled and dropped, the throwaway project and its specs put
back to their first commit — and then the samples go in one by one, exactly as
`dashboard/test/round/run` sends them (that script presses the same endpoint, `POST /api/self-run`).
While they run, the server's checkouts follow origin the way the specs cron does on the serving
host, so a spec that depends on an archived one sees the archive. `GET /api/self-run` says how far
it has come.

A test server started from a spec's row carries no Run button. It previews that spec, and its
sample specs are seeded once, when the server comes up.

## After the dashboard restarts

Deploying new code restarts this dashboard, and what it knows about running test servers lives in
memory. A test server started before the restart is still up — still on its port, still holding its
branch checked out — so on start-up the dashboard asks the ports themselves: what is listening
there, which directory that process was started with, and which branch the project's own worktree
list says is checked out in it. What it finds goes back in the register, and the spec page shows it
again. A test server the dashboard has forgotten still holds its branch checked out, and the next
start on that branch is refused: "it may already be checked out there, or in a leftover worktree".

A test server that did NOT survive the restart leaves the same obstacle behind. Its worktree is
removed by a watcher the test run leaves running beside it — and a restart that takes the server
takes the watcher with it, so the worktree stays registered and refuses that branch's next
checkout. Start-up clears those too: a worktree the test run made, on a branch it made or detached,
that no live server answers for.

A kept test server that dies on its own keeps its log: the watcher copies the server's own log to
`~/.aide/dashboard/round-logs/` (one file per event, named by time and server) before it removes the
rest, so a server that is gone can still say how it went.

## Which commit it serves

Whatever origin has for that branch, at the moment the test run starts. The checkout the run works
from is fetched first and its own copy of the branch moved to origin's tip, so a second test server
for the same branch serves the commit you just pushed. The one exception is a branch already
checked out in a worktree there, which means a test server is running on it: that one is left alone.

## Which projects this works for

Any project that says how to start itself. Aide is its own case: its checkout carries the
dashboard's source and the round script, and a test server there is that round left running. Every
other project names a preview command — the Settings table on its project page writes it, under the
row labelled `AIDE_PREVIEW_CMD`, as `previewCmd:` in the committed `.aide/project.yaml`, and a
machine that starts the project differently overrides it with `AIDE_PREVIEW_CMD` in its own
`.aide/config`, the same precedence the install and test commands have.

The command is expected to serve on `$PORT` and keep running until it is stopped, for example
`pnpm dev --port $PORT --host 127.0.0.1`. It runs in a worktree of the spec's branch, with the
project's `worktreeLinks` paths linked in — a worktree carries tracked files only, so the
dependencies and the local settings a dev server needs get there that way and no other.

Where a project names no command, the spec's row carries no start link, and the Deploy tab's "Test
server with the test specs" section keeps its heading with a sentence saying a test server cannot
start from there.

## Under the hood

For a project with a preview command, `core/scripts/aide-preview` is what starts it: it fetches the
branch, makes the worktree under `~/.aide/dashboard/previews/` (`AIDE_PREVIEW_DIR` moves that),
links the gitignored paths in, starts the command with `PORT` set, and waits until something
answers on that port before printing the one line this dashboard reads — `board up: pid N, <url>`.
A command that exits first, or never answers, is a refusal with that reason on the page. The
worktree is removed by a watcher it leaves behind, when the served process ends. It takes the same
`.git/aide-run-spec-worktree.lock` a run takes, because a `git worktree add` outside that lock
loses a ref lock while a run is in its own section.

For aide itself, this reuses `dashboard/test/round/run` — a script normally used to test the
dashboard end to end: it builds a fresh, throwaway copy of it from a given checkout, feeds it the
sample specs end to end, and checks each one came out as expected. Starting a test server is that
same script, told to leave the result running (`--keep`) instead of finishing and cleaning up,
wrapped in `src/serve/test-servers/lifecycle.ts`. The queue it drives runs against the throwaway
project alone (`--queue-projects aide-test`), with `claude-stub` in place of the model.

Each sample spec is a pair in `dashboard/test/round/specs/`: `<NN-slug>.md` is the description the
spec is created from, and `<NN-slug>.json` says which steps it runs and how it must come out —
`expected` (`archived` or `not-archived`), and optionally `expect`, what its row on the board must
show at the end: the job's `state`, its `stopReason`, and its `message` (the message key when the
board wrote one, `runner.notAnalyzed`, or a piece of the sentence when the runner script's own
English is the text), and `stepReason`, the `terminalReason` a named step's own result must carry.
That last one is what a fixture whose point is a REFUSAL says: a step the archive gates turned away
ends the job `done` with nothing archived, which is the same end state a step that never ran at all
leaves behind, so `state` and `expected` cannot tell the two apart. A fixture can also tighten its
own time limit with `timeoutSec`, which is how there is a row the clock stopped. The script grades
every field and names the one that was off, so a message that changes on the board is caught here
before anyone reads it on the real one.

A sample spec's description is the real thing, not a sketch: where a fixture is about acceptance
criteria, its `.md` carries a `## Acceptance criteria` section with `- **AC-n:**` bullets, and
`claude-stub` derives `4-status.md`'s own table from them — one row per id, the text verbatim,
before `## Notation` — exactly as `requirements-tracing.md` step 8 tells the model to. The stub
stands in for the MODEL; a table written out inside the stub answers to nothing, and its shape can
drift from the rule the real model is given with nothing to notice.

Two process ids are tracked for different reasons: one is this server's own handle on the spawned
process, known immediately and what a stop signal reaches (the whole process group, so a server
mid-build stops as cleanly as a fully running one); the other is read out of the running server's
own log once it exists, and is shown for reference only.

**Kept in memory, not on disk** — and recovered at start-up rather than lost: a restart re-finds the
servers that are still alive and puts them back on the list, which is what
[After the dashboard restarts](#after-the-dashboard-restarts) describes.
