# The specs list and the spec page

What a row on `/` says, what its controls do, what a spec's own page shows, and how the page keeps itself current.
The queue behind the rows is on [Running specs](running-specs.md); how a step's branch lands is on
[Branches and landing](landing.md). What a row's own error sentence has to say is the one rule on
[Error sentences](error-sentences.md).

## Table of contents

- [How the list reads](#how-the-list-reads)
- [A failed create](#a-failed-create)
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

What is ticked is a recorded CHOICE, not a fresh guess on every render: the phases posted from New spec at create
time, or the phases ticked on the row itself at whichever Run came after that — whichever happened more recently. That
choice sticks until the reader changes it themselves, by re-ticking the row's own boxes and pressing the row's button again. A spec
that has never had either — a create or a Run — recorded under it falls back to ticking every phase it has not had, the
same default it always had; a fresh spec, or one whose only recorded choice is empty, starts from there. A phase
already done is left unticked either way; ticking it anyway is a rerun, and no rule stands in the way. A spec whose
archive is held back on unticked acceptance criteria is the one exception: its Analyze and Implement boxes are offered
for another round but never ticked by default, whatever was recorded, and Archive is — the recorded choice names the
round that has just run, and a press meant for archive must not start another.

The button names the FIRST of the ticked phases and not the whole list — a label is a name, not a summary, and the
boxes are on the row that the press acts on. When that phase is not ticked — and no later phase is either — the button
still names it, but sits disabled: a press that could not do anything is named rather than hidden, so the row still
says what it is waiting on. `archive` is the exception the FALLBACK'S rule needs, not the recorded choice's: a spec
still on this list is by definition not archived, so the fallback counts it as outstanding however the history reads —
but a recorded choice that ticks nothing at all is honoured exactly as given, which is what keeps a finished-looking
spec from offering an active Archive nobody asked for.

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
verb for what is happening — "analyzing", "implementing" — or its place in the queue, "queued 7/11", with the pips
saying which phase it waits for — or, once nothing is running, the
resting state and what can happen next —
"ready for implement", "implementing held back", "archive held back — the Slack webhook", "done — nothing
waiting on you". The bare words
"done" and "queued" are neither, and neither appears alone: "done" says nothing about WHAT was done, and "queued"
nothing about which step is waiting, while both facts are known.

There is no second line telling a reader to press the button beside it. The row's
button stands next to the badge and NAMES the phase it would run — active when that phase is ticked, disabled and
still named when it is not. The page says what IS; the controls say what can be done.
The pips answer their own narrower question beside it.

The State column carries only the spec's own state — the running/resting word, and nothing beside it. A push that
never reached origin, a landing that did not finish, a pull request the code is waiting on (or one `gh` could not
open), or an archived branch left open (whether because a landing's own delete failed, or because nothing has
landed it at all) are facts about the work, not a second state the spec is IN, so none of them draw a badge in that
column. Each is said once in the row's own notice line instead, ranked, joined with " · " when more than one
applies, in a sentence written for a user — what happened and what to do, never git's own stderr — and each
keeping its own link where it has one, so a reader never loses one fact's link by another fact joining it on the
same line. The exception is the held-back message and the test server's: each stands in a box of its own, never joined
on one line.

**A held-back archive can be judged from the row.** The held-back message carries a › to its left. It adds or removes
the spec's key in `?checks=<project>/<folder>,…`, kept by every sort and filter link like `?open=`, and unfolds the
spec's acceptance criteria under the message: every criterion with its Notes cell and a checkbox for its state, and
nothing from the phase tables. The one Save posts to the Status tab's own tick route with `?fromList=1`, so the
ticks are stored the same way, and the message goes once every criterion is ticked. Saving does not start the archive.
Ticks not yet saved survive the list's live redraw. A spec whose rows cannot be read draws one line saying so, with a
link to its Status tab, in place of the list.

**Each acceptance row has a second box, "Not verified".** It is offered beside the tick box under the › and on the Status
tab. A row marked Not verified counts as done, so archive is not held back by it, but the spec keeps a small line
`N not verified` below the project and name on its list row (live and archived, not closed), linking to its Status tab.
The State filter has a "Not verified" entry that shows only specs with such a row, archived ones included. On an
archived spec a Not verified row stays open to change, on the Status tab and under the › of the archived row's own
line on the list: it can be ticked, or marked Failed with a note saying what did not hold. Those two are the only
changes the archive accepts. Ticking the last Not verified row removes the line and the spec leaves the filter.

**A Failed row keeps the spec in the Not verified filter and carries a Reopen button.** The line under the name reads
`N not verified · M failed`, each number only when above zero, and the filter matches a spec with at least one row of
either kind. A Failed row is open for archive and is drawn read-only with its `Failed:` note; the only way out of that
state is the Reopen button on the row, which opens the same confirmation page as the row's own Reopen. Reopen puts the
Failed rows back to open and keeps their notes; such a note counts as a changed criterion for the rule that a new round
needs at least one.

**A phase that has run unfolds to its own transcript.** Every phase line of an open row that has run or is
running starts with a ›. It adds or removes the phase's key, `<project>/<folder>:<step>`, in
`?phases=<key>,…`, kept by every sort and filter link and every redirect after a press like `?open=`, and it is a plain
link, so it works with script off. The unfolded row lists what the newest attempt that ran the step said AND what it
did — its own messages, the commands it ran and the files it wrote — at most the last 200, oldest first, each one line
clipped at 160 characters, and a link to that step on the Logs tab. The messages alone were too little to follow a run
by: a session that works through commands writes a sentence every few minutes, and the row read as frozen while the
step was busy. Once the phase has finished the last message is the phase's final message, whole up to 2,000
characters. A phase whose job the queue has forgotten says no messages are kept and links to the Logs tab itself. A
phase that is only queued, or that nothing touched, has no ›.

**Each criterion names the tests that prove it**, here and on the Status tab: the tests whose names carry its AC-id,
from `ac-coverage.json`, which the runner writes into the spec's folder after a completed implement
(`core/scripts/lib/run-spec-ac-coverage.sh`). Only lines the branch added count, since `AC-1` is in the tests of many
specs. A browser test is marked as run in implement, since the merge's test suite leaves it out. A criterion no test
names gets an amber line saying so, unless analyze's Notes cell already says `Not tested:` and why.

The four sentences about how runs work on this machine sit behind a shut "How runs work here" disclosure, like the
New-spec panel and for the same reason: the list is what people come here for. The runner-unavailable notice is NOT
folded in with them — "nothing here spends money" must not need a click.

There is no form above the table with a spec dropdown of its own. The row does everything such a form could, and a
dropdown could not stay current: the row refresh deliberately replaces the ROWS alone, so a half-set control is never
wiped — and a spec created since the page loaded would be in the list and not in the dropdown.

Every control here is a plain form first: ticking phases and pressing Run works with JavaScript switched off, and so do
Cancel, Create and expanding a row — each posts its form and follows a 303 back to the list. `specs-client/index.ts` is a
layer ABOVE that floor, never the mechanism (see
[what the script adds](#what-the-script-adds)). It cannot `import` anything: `specsClientScript()` runs
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
makes it survive the table's own row refresh, work with JavaScript switched off, and keep the row a user just acted
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
`css/index.ts` — `SPINNER` itself is used by `btn()`'s busy variant and by `specs-client/index.ts`'s in-flight-press
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

## A failed create

A create that ended without a spec (`failed`, `stopped`, `interrupted`, or its own merge failed, still under its
provisional key, with no merge under way) is not a row in any project: it has no number and nothing to open. The top of
the list shows one message for it instead: the project, the title and the reason in the reader's language, with **Try
again** and **Dismiss**. Each failed create has its own message, newest first, and dismissing one leaves the others.

**Try again** opens New spec (`/new?retry=<job id>`) with the project, title and description filled in; the phases,
models and "Depends on" come up at the form's defaults. A project that is no longer offered is left unselected.
**Dismiss** hides the message; the record stays for the newest 50 dismissed, so an older notification still opens the
form. A message stays until dismissed, across page loads and restarts, because it is kept in `failed-creates.json` and not
on the queue job, which the queue drops after 200 jobs. A create that failed before this existed has no message.

---

## Filtering and searching the list

The chips are one axis, and `?state=` is where it lives: "All" (the default), "Active" (everything not archived and
not closed), "Running" (only `running`, or a job whose branch is still landing), "Waiting" (`queued` — in queue or
held back — or `done` with no landing in progress), "Stopped", "Failed" (`failed`, `interrupted`, `cancelled`, or an
archived spec whose branch still exists on origin), "Archived" and "Closed". The default is `STATE_FILTERS[0]` and
nothing else — moving an entry to the front changes the default for every reader. Every chip, including "All",
carries its own `state=` value explicitly, so choosing one always overrides whatever is remembered (see below).

**The chosen chip is remembered across visits, the same way the sort column is.** Choosing a chip sets the
`aide_state` cookie (`HttpOnly; SameSite=Lax`); a request with no `state=` in the query string — the Specs tab's own
link, a bookmark, the back button — falls back to that cookie instead of always landing on "All". An explicit
`?state=` always wins and becomes the new memory. The search term (`?q=`) is never remembered this way.

**An archived spec is a row on this list**, and nowhere else — there is no separate archive page. Its row is a READER
row: the link to its own `/specs/<project>/<spec>` page, its whole description behind a two-line clamp, the date it was
archived, what it cost in time, the "not landed" mark, and Reopen. Reopen is a link to a confirmation page
(`/specs/<project>/<spec>/reopen`) that asks whether to reset the analysis, the plan and the status as well; the
answer comes back to the list, filter and all. No model select, no tick box and no Run — the server
refuses every step but `reopen` for an archived spec (`ARCHIVE_ONLY_STEP`), and a control that would be refused is a
control that should not be drawn. The date is the `**Archived:**` stamp in `4-status.md`, or, where a folder carries no
stamp, the commit that last touched it; a spec neither can date reads "date unknown" rather than leaving the column
blank, and one with no `## Description` section reads as a dash.

**What that row says a spec cost, in time,** is computed the same way whether the row is live or archived
(`totalDuration()`, `data-model/phases.ts`): a queue-measured span per phase — the worktree, the AI session, the commit
and the push, all of it — is preferred where the queue still remembers the job, and only where it does not (an archived
spec older than the queue's 200-job memory, or a phase no job ever ran) does the phase's own file stamp stand in, which
is the AI session's own duration alone. An archived row whose total leaned on that fallback for any phase carries a
"part." mark beside the figure, so a reader is never shown a session-only duration as though it were the whole phase's
time; a live row's own rare version of the same fallback stays unmarked. A total of `0` across every phase draws a bare
date with no duration span, the same "nothing recorded" rule the Cost cell gives an all-zero `spentUsd`.

**Building archived rows is gated on the chip** (`filterShowsArchived` in `data-model/filter-sort.ts`, beside the
chips, so the gate and the chips cannot disagree). A row costs two small file reads, Aide alone has archived well over
a hundred specs, and this page rebuilds itself on every change event on every open tab — so a view whose chip cannot
show an archived row builds nothing for one (a closed spec's folder is under `archive/` too, so the Closed chip
opens the same walk). ONE exception: an archived spec whose own branch is still on origin is
built whatever the chip, because it has NOT finished and the reading view is where that has to be seen. That is also
why there are two archived pseudo-states, `archived` and `archived-unlanded`: the second is archived to the Archived
chip, failed to the Failed chip, and not-archived to the chip defined by excluding archived specs, and all three
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

`/specs/<project>/<spec>` is the whole SPEC, as it stands now, in five tabs: one per document (Description,
Analysis, Solution, Status — each stamped with the commit that last changed it) and Logs for its runs. The Status tab
draws the acceptance criteria first, as real boxes with a Save of their own (each with its note and the tests that
name it), then the rest of `4-status.md` rendered read-only; an archived spec, or one with a job in flight, shows the
same criteria without boxes. An old `?tab=checks` link opens the Status tab. The banner above the tab row holds the
state chip, the Update button that pulls the specs checkout (`POST /api/queue/specs/<project>/<spec>/update`) and two
facts that belong to no single document: what the spec depends on, and whether it requires acceptance ticking — both
editable in one form (`POST /api/queue/specs/<project>/<spec>/tracking`).

**The Logs tab lists every step from every attempt in one flat list, no picker.** A spec with more than one job for
the same work round tags each row `Attempt N` (oldest = 1); a single-attempt spec shows no marker at all. There is no
`?job=`: the tab's own count is the true total across every attempt, not just the latest one's. **Only the Logs tab
reloads itself** (`<meta refresh>`, ten seconds): it is the one that moves while a step runs, and every other tab
carries a form a timer would wipe. The price is a state chip only as fresh as the last time the page was asked for,
with Update beside it. Each step's raw log now sits behind a summary, drawn above it, never
behind its own fold: the files that step's own commit changed (with lines added/removed), the
commands it ran with their outcome, its full final message, and the same time/cost/token/result
numbers shown elsewhere on the row. A step with no log file says so instead of showing an empty
summary.

**Four links above an open step's raw log filter it: All, Commands, Files, Errors** (`?only=`). Commands are what the
step ran, Files what it wrote, Errors the calls the tool itself reported as failures — one word for what each CLI
names differently, decided where the transcript is read (`src/queue/parse-stream/`). The filter is applied BEFORE the
log's own 40-line bound, so "Commands" is the last forty commands rather than the commands among the last forty
lines, and the summary above the log — changed files, commands, final message — is unfiltered whatever the links say.
A filter matching nothing says so and leaves the links up; a link rather than a widget, because the tab reloads itself
every ten seconds.

**An archived spec has this page too** — the scan records every spec's directory before it drops the archived ones
from the list. It says it is archived, and its Description tab is read-only with no box to tick anywhere: the spec is
a record.

**The Description tab** is `1-description.md` in a textarea with its own Save. It is the one of the four files a
user owns: the other three are written by a step, and a hand edit there is overwritten the next time that step
runs. The `Depends on` picker used to sit on this tab; it moved into the banner above the tab row, since a dependency
is a fact about the SPEC rather than about this one document.

**The checks on Overview** are `4-status.md`'s Tasks rows, every one of them — a list that only ever shrinks says
nothing about how far the spec got. The ones that are BOXES are the open rows of the CURRENT phase alone (the first
phase section still carrying an open mark, the same one the spec list's column shows): a row already ticked is a check
already made, and a row in a phase the workflow has not reached is a check nothing is waiting on. Both are shown,
neither presses. `4-status.md` is otherwise the runner's, and this is the narrow exception — one existing row's Status
mark, never its prose.

### Saving from the page

`POST /api/queue/specs/<project>/<spec>/save` writes, commits and pushes what the open document tab's own form
carried, on the specs repo's default branch, then returns to that tab. ONE commit, ONE file.

`POST /api/queue/specs/<project>/<spec>/tracking` is the banner's own route: what the spec depends on and whether it
requires acceptance ticking, both merged into `1-description.md`'s Tracking info in one commit, refused once
`analyze` has already decided the acceptance half of the question.

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

`GET /api/queue/events` is held open and answers `text/event-stream`. It answers any request with a `Host` of the
dashboard's own, like every other route, and `EventSource` needs no cookie for it. The event it writes is a bare `changed` signal with no payload: the browser
already knows how to fetch a fresh `#jobrows`, so
`renderSpecsRows` stays the one place a row is described and there is no second format to keep in step with it.

Two things broadcast, because two independent stores feed a row.
`QueueStore`'s `onChange` hook covers every write to a job — the runner's step transitions, the page's presses, the
API's enqueues — because `insert`, `editTailStep` and `update` are the only three ways in. `POST /api/aide-run`
broadcasts separately: cost, subagent count and live state arrive there and are invisible to the queue's store, so a
push driven by the store alone would let those numbers sit still for the whole of a long step. A write that was REFUSED
broadcasts nothing.

A step writes its transcript straight to a file, so nothing above fires while it runs. A tab that unfolded a phase
(`?phases=`) opens the stream with the same query, and on the runner's two-second tick the server compares the size of
each running step's transcript with the last tick and sends `changed` only to the tabs whose keys name that step. A
tab with nothing unfolded, or only other phases, is never told, and while no tab has keys no file is measured. Pressing
a › reopens the stream with the new `phases`.

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
"the timer already stops for a hidden tab" behaviour applied to a socket. A tab that comes BACK fetches the rows at
once, before that connection is up: an installed app returning from a phone's lock screen took ten to fifteen seconds
to show a list that had moved on, because the redraw waited for the stream (2026-09-20). Only a tab that has been
hidden does it — the first paint is the server's own — and a restore from the browser's back/forward cache
(`pageshow`) counts as coming back, since Android can bring the app forward that way without the page ever being told
it was hidden.

Two things this deliberately does NOT do. There is no periodic server-side broadcast to reconcile drift — an idle page
must issue no requests and redraw not at all, which is the whole point; the transcript check above is the one exception,
and only for a tab that unfolded the running phase — so a spec file hand-edited outside the
dashboard leaves its staleness badge behind until some real change happens nearby. And the runner's own two-second poll
is not made faster: "about a second" means about a second after the SERVER notices, not after the step really moved.

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
each `SpecTarget`.

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
for a landing, a dependency, an open acceptance row, or a full concurrency slot — has not started its
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
`src/specs-client/index.ts` that re-queries `[data-elapsed]` fresh each tick and rewrites `textContent`. Re-querying is what
lets it survive
`swapRows()` replacing `#jobrows` with no rebinding. It fetches nothing and touches no layout-affecting attribute, so
the redraw rule above holds.

**`formatElapsed` there is HAND-PAIRED with `durationLabel` in
`src/render/ui/job-state/index.ts`** — the client file is transpiled into an inline `<script>` and can neither import nor export,
so the wording rule exists twice. The test `test/specs-client/live/live-redraw.test.ts`
holds them together: "the page words a duration exactly as the server does"
runs a tick against the imported
`durationLabel` over a table of spans and pins them; change one and change the other, or a phase changes its wording the
first time the clock ticks over the figure the server drew.
