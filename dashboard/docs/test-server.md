# Test server

When a spec's `archive` step is held back because its acceptance criteria still need reviewing —
someone has to go through the Checks tab and tick each requirement off before it can be
archived — the specs list offers that reviewer a link to start a test server: a real, running copy
of the dashboard, built from that spec's own branch. Reviewing a requirement by reading the diff
again is one way to check it; opening the actual thing and clicking through it is another, and
often the more convincing one. Spec 388, extended by spec 393, 405, 411.

The code's own names for this internally (`BoardStore`, `startBoard`, `boardStatus`) call it a
"board" — avoided here on purpose. This project already uses "the board" as everyday shorthand for
the dashboard itself, and a doc titled "Boards" about a per-spec preview server would be read as
being about that instead. The user-facing text mostly agrees — the list row's own link says "test
server" — except the spec page's running banner, which still says "Board:". That one line is a
leftover of the internal name and worth fixing to match, not a second concept.

## Table of contents

- [Where you find it](#where-you-find-it)
- [What starting one does](#what-starting-one-does)
- [starting → running → failed](#starting--running--failed)
- [Stopping it](#stopping-it)
- [Which projects this works for](#which-projects-this-works-for)
- [Under the hood](#under-the-hood)

---

## Where you find it

On the specs list, a spec waiting only on that requirements review gets a second note on its row,
beside the "archive held back" one: **"Click the link to start a test server running this
branch."** Click it, and it takes you to that spec's own Steps tab, where a real running instance
is being built for you.

Nothing else in the dashboard offers this today — there is no button for it on the spec page
itself, and no other row shows the link. It exists specifically for this one moment: a spec whose
code is done and only waiting on that review.

## What starting one does

The Steps tab shows a spinner while the server builds — this takes a couple of minutes, since it is
a real dashboard starting from scratch, not a cached preview. Once it is up, the banner shows a
link to the running server, along with the branch and commit it is running. **It is a real,
separate dashboard instance, not the one you are looking at** — its own address, its own data,
seeded with a small set of sample specs to click through rather than this project's real ones.

Clicking the same link again — or the tab's own automatic reload while a server is still
starting — does not start a second one. It always hands back whichever server is already running or
building for that exact branch and commit.

## starting → running → failed

- **starting** — the server is being built; the page keeps polling until it is either up or has
  died.
- **running** — a link to the address it is serving on, plus the branch and commit.
- **failed** — the last line the process wrote before it stopped, as the reason.

## Stopping it

A **Stop test server** button appears once it is running. It also stops on its own, with nothing to
press, the moment the spec it belongs to is actually archived — merged or discarded, there is no
reason left to keep a preview of it running.

## Which projects this works for

Only `aide` itself, today. Starting a test server means running that project's own dashboard code
from a branch, which only makes sense for a project whose checkout — the one this dashboard's own
automation works from — actually contains the dashboard's source. In practice that is aide alone,
self-hosting; the dashboard checks for this rather than naming the project directly, so it would
extend automatically to any other project in the same position.

## Under the hood

This reuses `dashboard/test/round/run` — a script normally used to test the dashboard end to end:
it builds a fresh, throwaway copy of it from a given checkout, feeds it a small set of sample specs
end to end, and checks each one came out as expected. Starting a test server is that same script,
told to leave the result running (`--keep`) instead of finishing and cleaning up — the same real
dashboard a test run already proves works, just left up for a person to open instead of graded and
torn down. `src/serve/boards/lifecycle.ts` is a thin wrapper around it, not a second
implementation.

Two process ids are tracked for different reasons: one is this server's own handle on the spawned
process, known immediately and what a stop signal reaches (the whole process group, so a server
mid-build stops as cleanly as a fully running one); the other is read out of the running server's
own log once it exists, and is shown for reference only.

**Kept in memory, not on disk.** Nothing currently running survives a restart of this dashboard —
there is no option yet to make it persist across one, though the code that tracks a running server
is written so that could be added without changing how any of the above works.
