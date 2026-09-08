# Test server

When a spec's `archive` step is held back because its acceptance criteria still need reviewing —
someone has to go through the Checks tab and tick each requirement off before it can be
archived — the specs list offers that reviewer a link to start a test server: a real, running copy
of the dashboard, built from that spec's own branch. Reviewing a requirement by reading the diff
again is one way to check it; opening the actual thing and clicking through it is another, and
often the more convincing one.

## Table of contents

- [Where you find it](#where-you-find-it)
- [What happens when you click it](#what-happens-when-you-click-it)
- [Checking on it afterwards](#checking-on-it-afterwards)
- [Stopping it](#stopping-it)
- [After the dashboard restarts](#after-the-dashboard-restarts)
- [Which projects this works for](#which-projects-this-works-for)
- [Under the hood](#under-the-hood)

---

## Where you find it

On the specs list, a spec waiting only on that requirements review gets a second note on its row,
beside the "archive held back" one: **"Click the link to start a test server running this
branch."**

## What happens when you click it

The link opens in the same tab and holds it: building a test server is a real dashboard starting
from scratch, which takes a minute or two, not seconds, so the page you land on says so and waits —
"leave it open" — rather than sending you off to go find the address yourself later. It checks
again every few seconds on its own; there is nothing to click or refresh by hand.

The moment the server answers, that same tab is carried straight to it — that is well before the
test run has finished: the specs on it are created one by one, and you watch the list fill. If it
failed to start instead, the tab says so and stops there, with the reason it gave.

Clicking the link again for the same spec never starts a second server: whatever is already
running, starting, or has failed for that exact branch and commit is what you get taken to or told
about.

## Checking on it afterwards

The spec's own page (its Overview) shows the same starting/running/failed state for as long as a
test server exists for it, with a link to the running one — useful once you have closed
the tab the server opened and want to get back to it, or check whether one that was still starting
has come up.

## Stopping it

A **Stop test server** button appears on the spec page once its test server is running. It also stops on
its own, with nothing to press, the moment the spec it belongs to is actually archived — merged or
discarded, there is no reason left to keep a preview of it running.

## After the dashboard restarts

Deploying new code restarts this dashboard, and what it knows about running test servers lives in
memory. A test server started before the restart is still up — still on its port, still holding its
branch checked out — so on start-up the dashboard asks the ports themselves: what is listening
there, which directory that process was started with, and which branch the project's own worktree
list says is checked out in it. What it finds goes back in the register, and the spec page shows it
again.

Without that, the next click on the spec's link tried to start a second test server on a branch git
already had checked out, and refused: "it may already be checked out there, or in a leftover
worktree".

A test server that did NOT survive the restart leaves the same obstacle behind. Its worktree is
removed by a watcher the test run leaves running beside it — and a restart that takes the server
takes the watcher with it, so the worktree stays registered and refuses that branch's next
checkout. Start-up clears those too: a worktree the test run made, on a branch it made, that no
live server answers for.

## Which commit it serves

Whatever origin has for that branch, at the moment the test run starts. The checkout the run works
from is fetched first and its own copy of the branch moved to origin's tip — so a second test
server for the same branch never quietly serves the commit before the one you just pushed. The one
exception is a branch already checked out in a worktree there, which means a test server is running
on it: that one is left alone.

## Which projects this works for

Only `aide` itself, today. Starting a test server means running that project's own dashboard code
from a branch, which only makes sense for a project whose checkout — the one this dashboard's own
automation works from — actually contains the dashboard's source. In practice that is aide alone,
self-hosting; the dashboard checks for this rather than naming the project directly, so it would
extend automatically to any other project in the same position. For a spec in a project this
doesn't apply to, or one archived in the meantime, the link falls back to the spec's own Steps tab
instead.

## Under the hood

This reuses `dashboard/test/round/run` — a script normally used to test the dashboard end to end:
it builds a fresh, throwaway copy of it from a given checkout, feeds it a small set of sample specs
end to end, and checks each one came out as expected. Starting a test server is that same script,
told to leave the result running (`--keep`) instead of finishing and cleaning up — the same real
dashboard a test run already proves works, just left up for a person to open instead of graded and
torn down, implemented as a thin wrapper around it in `src/serve/boards/lifecycle.ts`.

Two process ids are tracked for different reasons: one is this server's own handle on the spawned
process, known immediately and what a stop signal reaches (the whole process group, so a server
mid-build stops as cleanly as a fully running one); the other is read out of the running server's
own log once it exists, and is shown for reference only.

**Kept in memory, not on disk.** A restart of this dashboard loses track of every test server
currently running.
