# The specs list and the spec page

What a row on `/` says, what its controls do, what a spec's own page shows, and how the page keeps itself current.
The queue behind the rows is on [Running specs](running-specs.md); how a step's branch lands is on
[Branches and landing](landing.md). What a row's own error sentence has to say is the one rule on
[Error sentences](error-sentences.md).

## Table of contents

- [How the list reads](#how-the-list-reads)
- [Filtering and searching the list](#filtering-and-searching-the-list)
- [Changing a running job's tail](#changing-a-running-jobs-tail)
- [The spec page](#the-spec-page)
    - [Saving from the page](#saving-from-the-page)
- [What the script adds](#what-the-script-adds)
- [The page changes when something changes](#the-page-changes-when-something-changes)
- [A spec's date does not move, and a phase says how long it took](#a-specs-date-does-not-move-and-a-phase-says-how-long-it-took)

---

One way in: the spec's own row, expanded — collapsed is the default;
see [How the list reads](#how-the-list-reads). It carries a checkbox per phase, a model dropdown, and one Run button
that queues everything ticked as a single job in the workflow's order — the browser submits checkboxes in the order they
are drawn, so ticking `implement`
before `analyze` still queues analyze first. After the model, quiet and small-text on that same controls line — no
disclosure to open — sits the one thing nobody sets every time: which other repos the job will touch. There is no "stop
for approval between steps" box: a reader who wants to stop between steps runs one phase at a time.

**Every phase the job in flight was queued with shows its box disabled**, not merely the step it has reached, because
the queue would refuse any of them anyway (see
[the duplicate guard](running-specs.md#notifications)). A box left tickable for a step the job already holds is a box whose press
answers "already running on this spec". The box says why on hover ("analyze is running"), in the same words the state
chip uses.

What is pre-ticked is every phase the spec has not had: a press takes the spec as far as it can go, and
unticking a box is how a reader says to stop somewhere. The button names the FIRST of the ticked phases and not the
whole list — a label is a name, not a summary, and the boxes are on the row that the press acts on. A phase already done
is left unticked; ticking it anyway is a rerun, and no rule stands in the way. `archive` is the exception the rule
needs: a spec still on this list is by definition not archived, so it counts as outstanding however the history reads,
and the pre-ticked set is therefore never empty.

**Which phases a spec has HAD is read off one line, and nothing else:**
`- **Workflow steps completed:** create, analyze` in the Tracking info of its `4-status.md`. Each step
writes its own name there once it has succeeded, and `core/rules/spec-structure.md` § 4-status is where that contract
lives. Nothing is inferred from a file's size, from a heading being present, or from a percentage — each of those is a
proxy for the question rather than an answer to it, and a proxy that reads a spec as analysed before analyze has run
sends the next step off an empty template.

The percentage keeps its own job: it says how far the TDD phases
INSIDE implement have got, which is a different question from whether implement ran. It is not shown on the row —
implement is ONE step, so the figure reads 0 until implement finishes and 90-something after, never
anything between, and two specs of entirely different sizes both read "0% done".
The spec's own page shows it in full.

A status file carrying no such line has had nothing as far as the page is concerned. That is deliberate: a spec
that reads as unfinished is visible and is fixed by running the step, where a silent guess is neither.

The State column answers what a reader came to find out, and its FIRST line is one of two things, always: the
verb for what is happening — "analyzing", "implementing", "implementing 7/11" — or, once nothing is running, the
resting state and what can happen next —
"ready for implement", "archive held back — the Slack webhook", "done — nothing waiting on you". The bare words
"done" and "queued" are neither, and neither appears alone: "done" says nothing about WHAT was done, and "queued"
nothing about which step is waiting, while both facts are known.

There is no second line telling a reader to press the button beside it. The row's
button stands next to the badge and NAMES the phase it would run. The page says what IS; the controls say what can be
done.
The pips answer their own narrower question beside it.

Every status the list reports lives in the State column, and nowhere else on the row — the spec's name carries only
its name, its project, the pips and the fold control. A push that never reached origin, a landing that did not finish,
a pull request the code is waiting on, or an archived branch left open (whether because a landing's own delete failed,
or because nothing has landed it at all) each draw a second, small badge beside the running/resting word — one badge,
the one that needs a person first, when more than one applies. Its title carries a sentence written for a person, what
happened and what to do, never git's own stderr; and when more than one condition applies, every one of their
sentences rides on that SAME title, so hovering the one badge reaches all of them rather than only the winner.

The four sentences about how runs work on this machine sit behind a shut "How runs work here" disclosure, like the
New-spec panel and for the same reason: the list is what people come here for. The runner-unavailable notice is NOT
folded in with them — "nothing here spends money" must not need a click.

There is no form above the table with a spec dropdown of its own. The row does everything such a form could, and a
dropdown could not stay current: the row refresh deliberately replaces the ROWS alone, so a half-set control is never
wiped — and a spec created since the page loaded would be in the list and not in the dropdown.

Every control here is a plain form first: ticking phases and pressing Run works with JavaScript switched off, and so do
Cancel, Create and expanding a row — each posts its form and follows a 303 back to the list. `queue-client.ts` is a
layer ABOVE that floor, never the mechanism (see
[what the script adds](#what-the-script-adds)). It cannot `import` anything: `queueClientScript()` runs
`Bun.Transpiler.transformSync` over it and inlines the result into a plain `<script>` tag — that transpiles, it does not
bundle. An
`import` survives as an ESM import inside a classic inline script (a 404, since this server does not serve that path),
and an `export` is a syntax error. Any shared, unit-testable browser module needs a bundle step or a `type="module"` tag
first; the expand/collapse link was built to need neither.

The page is called Specs, not Queue. That a queue orders the runs is an implementation detail — `QueueStore`,
`/api/queue`, `QUEUE_PROJECTS`
and the rest keep the name; what a reader reads does not.

## How the list reads

One row per spec, not per job, and collapsed by default:
name, title, one status line, the phase pips, and at most one action button. Expanding it (the chevron in front of the
name, `?open=…`)
reveals the workflow phases underneath, always in that order, so how far a spec has got is readable without counting
rows, plus the run controls (phase checkboxes, model, the also-touches field after it, Run, Cancel). A phase never run
shows a muted "not run yet". A phase run more than once shows its LATEST attempt with the count beside it, because a
re-run is ordinary. Expanding is a link and lives in the query string (`?open=<project>/<folder>,…`), which is what
makes it survive the table's own row refresh, work with JavaScript switched off, and keep the row a person just acted
on open across the redirect that follows their own submit.

The first line is `create` — history, not a control. It reads done once `4-status.md` records it, which is
what `/aide-create`
writes into a new spec; a spec with a create job in the queue's history additionally shows that run (state, model, time,
cost, link), and a spec made by hand shows the line inert, the same way any phase run outside the
queue does. It has no checkbox. It has a pip like the other four, but not on their rule: `done` comes from the git
history, which counts only the runner's
own commits, so a spec written by hand has no create commit and would show grey. Create gets the LINE's rule instead,
and it has only two states — a spec that exists was created, so the pip is past unless a create job is running right
now.

**The running phase's own pip carries the motion.** The closed row is the whole interface for
the ordinary case, so "this is running" cannot live on a phase line that only exists once a row is expanded — a reader
watching the collapsed list would see no
motion at all. The signal is `.pip.now`, the running phase's marker: it already says WHICH phase without a word
(drawn in
`--accent`), so a lighter band skimming across it left to right, in the direction the four pips already run, adds "and
it is alive" in the same mark instead of a second element. A pulse was rejected — on a 14×4 bar it reads as an alert,
not as work in progress. Every running row animates on one shared timing rather than each starting when its row was
drawn, so several at once move together instead of shimmering at random. `phaseChip`'s `busy` option is gone along with
`.phase.busy` in
`css.ts` — `SPINNER` itself is used by `btn()`'s busy variant and by `queue-client.ts`'s in-flight-press
spinner, a different fact with a different lifetime (see [what the script adds](#what-the-script-adds)).

`prefers-reduced-motion` is honoured here: `.pip.now` drops the animation and holds
`--accent` still, so a machine set to reduce motion still tells a running phase from a waiting one, just without the
movement.

The header carries what belongs to the spec rather than to one run, unconditionally (collapsed or expanded): the summed
cost, one link per repo the spec pushed to, and the state that matters most right now — whatever is in flight, else the
most recent outcome. A collapsed row's single action button — the way out of a conflict, where the refusal is — sits
there too, once per spec instead of once per job; Cancel is only offered once the row is expanded.

Filtering and sorting work on the spec's grouped jobs. "Active" means the spec has something in flight; sorting by
cost sorts on the sum. A step outside the four (`explore`, `create`, `manifest` — valid steps the form does not offer)
is appended after them rather than dropped, so a run is never invisible.

## Filtering and searching the list

The chips are one axis, and `?state=` is where it lives: "All" (the default), "Active" (everything not archived),
"Running", "Done", "Problems" and "Archived". The default is `STATE_FILTERS[0]` and nothing else — moving an entry to
the front changes the default for every reader. Every chip, including "All", carries its own `state=` value
explicitly, so choosing one always overrides whatever is remembered (see below).

**The chosen chip is remembered across visits, the same way the sort column is.** Choosing a chip sets the
`aide_state` cookie (`HttpOnly; SameSite=Lax`); a request with no `state=` in the query string — the Specs tab's own
link, a bookmark, the back button — falls back to that cookie instead of always landing on "All". An explicit
`?state=` always wins and becomes the new memory. The search term (`?q=`) is never remembered this way.

**An archived spec is a row on this list**, and nowhere else — there is no separate archive page. Its row is a READER
row: the link to its own `/specs/<project>/<spec>` page, its whole description behind a two-line clamp, the date it was
archived, what it cost in time, the "not landed" mark, and Reopen. No model select, no tick box and no Run — the server
refuses every step but `reopen` for an archived spec (`ARCHIVE_ONLY_STEP`), and a control that would be refused is a
control that should not be drawn. The date is the `**Archived:**` stamp in `4-status.md`, or, where a folder carries no
stamp, the commit that last touched it; a spec neither can date reads "date unknown" rather than leaving the column
blank, and one with no `## Description` section reads as a dash.

**What that row says a spec cost, in time,** is read the way Cost is: a live `reduce` in `readerGroup()`
(`data-model/group-builders.ts`) over each phase's own `timeSpentMs`, off the per-phase Tracking info — never a figure
worked out once, at archive-landing time, off the queue's own job records. The queue keeps 200 jobs while the archive
holds more and grows, so a figure stamped at landing time is unwritable for any spec whose jobs the queue has already
forgotten. A total of `0` across every phase draws a bare date with no duration span, the same "nothing recorded" rule
the Cost cell gives an all-zero `spentUsd`.

**Building archived rows is gated on the chip** (`filterShowsArchived` in `data-model/filter-sort.ts`, beside the
chips, so the gate and the chips cannot disagree). A row costs two small file reads, aide alone has archived well over
a hundred specs, and this page rebuilds itself on every change event on every open tab — so a view whose chip cannot
show an archived row builds nothing for one. ONE exception: an archived spec whose own branch is still on origin is
built whatever the chip, because it has NOT finished and the reading view is where that has to be seen. That is also
why there are two archived pseudo-states, `archived` and `archived-unlanded`: the second is archived to the Archived
chip, a problem to the Problems chip, and not-archived to the chip defined by excluding archived specs, and all three
fall out of the chip tables rather than out of an exception inside the filter.

**`?q=` is a plain search**, a GET form carrying the rest of the view as hidden fields, matching the folder, the title
and the WHOLE description — including the part the clamp does not show, which the note under the field says out loud.
It reads live and archived rows alike, because they are rows on one list.

## Changing a running job's tail

`POST /api/queue/<id>/steps` edits a RUNNING job's tail: `step` plus a `checked` flag adds a phase the run has not
reached yet, or removes one it has not started. The running step and everything behind it are refused by name, as is
any job that is not running — the decision is made against the job as it stands when the request arrives, never
against what the page believed. This is deliberately NOT `POST /api/queue`: that route creates a job, and for a spec
with one in flight it answers with the clash refusal.

## The spec page

`/specs/<project>/<spec>` is the whole SPEC, as it stands now, in seven tabs: Overview, one tab per document
(Description, Analysis, Solution, Status — each stamped with the commit that last changed it), and Activity and Steps
for one of its runs. Overview carries no file text at all — stacking four files in full there put thousands of lines
of preformatted text between the reader and what they came for. It is where the spec STANDS: the state chip, the
Update button that pulls the specs checkout (`POST /api/queue/specs/<project>/<spec>/update`), the title, what the
spec depends on (read-only — the picker that CHANGES it is on the Description tab, with the file the line is stored
in), and the checks, as real boxes with a Save of their own.

**A phase line on the spec list opens the tab that shows what that phase MADE**: create → Description, analyze →
Solution, implement → Status, archive → Overview, since archive writes no file of its own. `PHASE_TAB` in
`render/pages/spec-page/tabs.ts` is the one place that mapping is written; the list imports it. A step outside those
four — `explore`, or anything not in the fixed workflow — has no tab that speaks for it and keeps linking to its own
job page, `/specs/<id>`. Such a link is live whether or not the phase has ever run: the tab belongs to the spec, not
to the run.

**The Logs tab lists every step from every attempt in one flat list, no picker.** A spec with more than one job for
the same work round tags each row `Attempt N` (oldest = 1); a single-attempt spec shows no marker at all. There is no
`?job=`: the tab's own count is the true total across every attempt, not just the latest one's. **Only the Logs tab
reloads itself** (`<meta refresh>`, ten seconds): it is the one that moves while a step runs, and every other tab
carries a form a timer would wipe. The price is a state chip only as fresh as the last time the page was asked for,
with Update beside it.

**An archived spec has this page too** — the scan records every spec's directory before it drops the archived ones
from the list. It says it is archived, and its Description tab is read-only with no box to tick anywhere: the spec is
a record.

**The Description tab** is `1-description.md` in a textarea with its own Save, plus the `Depends on` picker (also the
New-spec page's own control — the line it writes is a line of this very file, and leaving it in the textarea too would
mean two writers for one fact). It is the one of the four files a person owns: the other three are written by a step,
and a hand edit there is overwritten the next time that step runs.

**The checks on Overview** are `4-status.md`'s Tasks rows, every one of them — a list that only ever shrinks says
nothing about how far the spec got. The ones that are BOXES are the open rows of the CURRENT phase alone (the first
phase section still carrying an open mark, the same one the spec list's column shows): a row already ticked is a check
already made, and a row in a phase the workflow has not reached is a check nothing is waiting on. Both are shown,
neither presses. `4-status.md` is otherwise the runner's, and this is the narrow exception — one existing row's Status
mark, never its prose.

### Saving from the page

`POST /api/queue/specs/<project>/<spec>/save` writes, commits and pushes what the Description tab's form carried
(`1-description.md`, the `Depends on` line included), on the specs repo's default branch, then returns to that tab.
ONE commit, ONE file.

`POST /api/queue/specs/<project>/<spec>/tick` is the same for the checks form: `4-status.md` alone, its own commit,
back to Overview. It is a route of its own so that ticking a box does not mean opening the description's editor. A
tick's new text is computed on the server from the row it verified against the file on disk and never taken from the
body, so no byte of `4-status.md` outside a Status cell can move. Two guards, not one: the file's `baseSha` as it was
read at, and each ticked row's own exact text posted back — a row that no longer reads as it did is refused even when
the sha still matches, which is what tells a second press apart from a first. One bad row refuses every box in the
same press; a `text` field posted to `/tick` is read by nothing, and `tick` fields posted to `/save` are read by
nothing.

Both routes refuse, with nothing written, when the checkout is dirty, on another branch, diverged or unreachable; a
commit whose push fails is reset away, because an unpushed commit in the one shared specs checkout breaks the next
fast-forward for every project in it. Both refuse an ARCHIVED spec, whose files are history — server-side, not by
hiding a control. `/save` is the only route that accepts a body over 4096 bytes — a description is not an action post
— and its own cap is 64 KiB.

The two routes these replaced, `GET /specs/<project>/<spec>/edit` and `POST .../status/tick`, answer 404: a retired
route is removed, not redirected.

## What the script adds

The page's own browser code does one thing to the controls: it keeps the reader where they are. Every one of them — Run,
Cancel, Create — is a real `<form>` that works on its own, and the script only intercepts.

- **A press changes the button at once, without changing its width.**
  It disables, gains the `busy` look and a spinner ahead of its own label — the label itself stays put, only
  the `title` carries the pending word ("starting…", "cancelling…", "queueing…",
  "merging…", "creating…"), read from `data-pending` beside the label. On a row control the same
  press swaps that row's own `.phases` chips for the same spinner, holding their width with
  `style.minWidth` so the buttons beside them do not shift — freed again once the boxes come back. The `finally` block
  that undoes all of this runs under the same `isConnected` guard the button already had, which matters because
  `swapRows()` returns without touching
  `#jobrows` when the rows re-fetch itself fails: without that guard a row can get stuck holding a spinner for a request
  that is already over. The `.phases` boxes are Run's own form fields — the ticked checkboxes live there — so the swap
  only happens after `new
  FormData(form)` has already read them; writing the spinner in first would silently queue a job with no phases at all.
- **The answer lands in place.** `#jobrows` is re-fetched and swapped; the page does not reload, does not scroll to the
  top, and does not wipe a control someone is half-way through setting.
- **A refusal does not navigate either.** The reason and the spec it belongs to are written into the address bar with
  `history.replaceState` — the same `?error=&errorSpec=` query the server's own 303 would have built — and the rows are
  re-asked with it, so the message comes back rendered on the spec's own row. The filter, the sort and the fold ride
  along in that query, which is why a refusal cannot throw the reader back to the default list.
- **The New-spec form answers for itself.** It sits outside `#jobrows`
  on purpose (a half-typed description must survive the row swap), so it is bound directly rather than by delegation,
  and a refused create has no row to land on — the spec it named was never made. Its reason is written beside the form;
  on success the form empties and shuts, and the new row arrives with the swap.

Without the script every one of those falls back to a form post and a 303 to the list: slower, and one full page load,
but functionally complete.

## The page changes when something changes

The list does not re-ask the server on a timer. Polling every five seconds and redrawing whether anything had happened
or not costs twice: a reader with the browser's own tools open has the ground move under them twelve times a minute,
and a step that finished waits up to five seconds to show. The server says when instead.

`GET /api/queue/events` is held open and answers `text/event-stream`. It is behind the queue token like every other
route on this surface, and `EventSource` reaches it with the cookie the page was given on load — it cannot set a header,
so the cookie is the whole of its auth. The event it writes is a bare `changed` signal with no payload: the browser
already knows how to fetch a fresh `#jobrows`, so
`renderQueueRows` stays the one place a row is described and there is no second format to keep in step with it.

Two things broadcast, because two independent stores feed a row.
`QueueStore`'s `onChange` hook covers every write to a job — the runner's step transitions, the page's presses, the
API's enqueues — because `insert`, `editTailStep` and `update` are the only three ways in. `POST /api/aide-run`
broadcasts separately: cost, subagent count and live state arrive there and are invisible to the queue's store, so a
push driven by the store alone would let those numbers sit still for the whole of a long step. A write that was REFUSED
broadcasts nothing.

On the browser's side there is no polling timer that fetches. The one timer there is — a one-second tick that
rewrites the TEXT of the running-phase elapsed marks, see "A spec's date does not move"
below — fetches nothing, swaps no rows and touches nothing that could move the page, so the rule this section states
holds: the rows redraw when the server says something moved, and at no other time. A `changed` event redraws the
rows unless a press is in flight — the same `inFlight`
guard a press already uses, for the same reason: the server still shows the pre-press state until the press answers. The `open`
event redraws too, and that is what makes a reconnect heal itself either way it happened. A dropped
network is the browser's own problem: `EventSource` reconnects on its own, `open` fires again, and the
resync picks up whatever was missed. A restarted server behind a proxy is not — the proxy answers a
reconnect with a non-200 status while nothing is listening yet, and that closes `EventSource` for good,
with no retry of its own. The client notices instead: on `error`, a source left `CLOSED` is dropped and
reopened after a wait that grows on each further failure up to a ceiling and resets once a connection
opens, and the same `open`-redraws-the-rows resync above is what a proxied restart heals through too.
A hidden tab closes its connection and
opens a fresh one when it comes back, which is the
"the timer already stops for a hidden tab" behaviour applied to a socket.

Two things this deliberately does NOT do. There is no periodic server-side broadcast to reconcile drift — an idle page
must issue no requests and redraw not at all, which is the whole point — so a spec file hand-edited outside the
dashboard leaves its staleness badge behind until some real change happens nearby. And the runner's own two-second poll
is untouched: "about a second" means about a second after the SERVER notices, not after the step really moved.

The one server-side timer here is a `: ping\n\n` comment every 45 seconds. `Bun.serve` cuts a connection quiet for
`idleTimeout` (120 seconds here, set for slow git work), and a page watching a quiet queue is exactly that. It is
`.unref()`'d like the runner's timer and cleared in `stop()` besides — `bun test` runs many suites in one process, and a
timer from a stopped test's server would fire into the next one.

## A spec's date does not move, and a phase says how long it took

The **Created** column holds when the spec was made, and a run does not move it. Holding the most recently active job's
own start instead would throw a row to the top of a list sorted by it every time a phase started, so a spec made months
ago and re-run an hour ago would outrank one made this morning. The list opens sorted by this column, newest first.

The date comes from **git, never from the queue**. `QueueStore` is an LRU of 200 jobs, so a spec older than that has no
`Job` record of its own beginning left; the specs repo still has the first commit that touched the folder, years on.
`firstCommitAt` in
`src/git/description-freshness.ts` asks for it and
`SpecCreatedAtChecker` caches the answer, both shaped exactly like
`DescriptionFreshnessChecker` beside them — same TTL, same key, same fail-to-nothing. `withFreshness` attaches it to
each `QueueTarget`.

Two traps worth knowing before touching this:

- **The oldest commit is not `git log -1 --reverse`.** `-1` limits the commit SELECTION, which runs newest-first, and
  `--reverse` only turns the already-limited output round — the two together still answer with the newest. The oldest is
  the last line of the unlimited log.
- **A spec git cannot date shows a dash, and deliberately no fallback to a job's own time.** A `Job`-backed fallback
  would put the jumping straight back for exactly the specs that cannot be dated. The never-run tie-break in
  `sortGroups` therefore asks two things, not one: neither spec has a job AND neither has a date.
- **An archived spec's folder has moved, and a plain path-filtered log only sees the move.** Once `aide-archive-spec`
  has `git mv`'d a spec's folder into `archive/<folder>`, `git log -- .` on the new path only shows the move commit and
  anything after it — every earlier commit touched the old path and is invisible to that query. `--follow` crosses
  exactly this kind of rename, but only for a single-file pathspec, not a directory — so an archived row's Created date
  is read with `firstCommitAtFollowingRenames()` against `0-README.md` (written once by `/aide-create`, never
  independently edited or renamed), not the plain directory lookup live rows use.

The other half is duration. A job carries a single `startedAt` however many steps it ran, so `finishedAt - startedAt`
is the whole job's span and belongs to no one step of it — reaching for that is the mistake `phaseDuration` exists to
prevent. Instead, **the queue stamps each step's own start** (`Job.stepStartedAt`, set fresh the instant the runner
actually spawns it) and carries it onto that step's own result once it ends (`StepResult.startedAt`) — a step's
duration is that result's own end minus its own recorded start. A job merely `queued` between two steps — held back
for a landing, a dependency, an open acceptance row, a full concurrency slot, or the daily cap — has not started its
next step yet and shows no duration for it at all, however long the previous step's own end sits in the past: none of
that waiting is ever inside the figure. A result written before this stamp existed falls back to the boundary the
page always used — the step before it ending, or the job's own start for the first one.

Three things the column then says, by row type:

- A finished phase: its own settled duration, in the phase line's own time cell.
- A running phase: the same cell, carrying `data-elapsed` — the instant to count up from. The server writes a readable
  figure into it too, so the cell says something with script switched off.
- A spec with nothing left to run: its phases' durations **added together**, beside the creation date on the header row.
  A sum, never a span — a spec that waited three days between two phases did not take three days.

The live count is the one timer on this page, and it is deliberately the narrowest one there can be: a one-second
`setInterval` in
`src/queue-client.ts` that re-queries `[data-elapsed]` fresh each tick and rewrites `textContent`. Re-querying is what
lets it survive
`swapRows()` replacing `#jobrows` with no rebinding. It fetches nothing and touches no layout-affecting attribute, so
the redraw rule above holds.

**`formatElapsed` there is HAND-PAIRED with `durationLabel` in
`src/render/ui/job-state.ts`** — the client file is transpiled into an inline `<script>` and can neither import nor export,
so the wording rule exists twice. `test/queue-client/live-redraw.test.ts`'s "the page words a duration exactly as the server does"
runs a tick against the imported
`durationLabel` over a table of spans and pins them; change one and change the other, or a phase changes its wording the
first time the clock ticks over the figure the server drew.
