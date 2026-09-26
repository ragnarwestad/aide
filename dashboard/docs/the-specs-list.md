# The specs list and the spec page

What a row on `/` says, what its controls do, what a spec's own page shows, and how the page keeps itself current.
The queue behind the rows is on [Running specs](running-specs.md); how a step's branch lands is on
[Branches and landing](landing.md). What a row's own error sentence has to say is the one rule on
[Error sentences](error-sentences.md).

## Table of contents

- [The row, open and shut](#the-row-open-and-shut)
- [The row's controls](#the-rows-controls)
- [What is ticked, and why](#what-is-ticked-and-why)
- [Which phases a spec has had](#which-phases-a-spec-has-had)
- [The State column](#the-state-column)
- [The notice line under the name](#the-notice-line-under-the-name)
- [Judging a held-back archive from the row](#judging-a-held-back-archive-from-the-row)
- [Not verified, and Failed](#not-verified-and-failed)
- [A phase's own transcript](#a-phases-own-transcript)
- [Which tests prove a criterion](#which-tests-prove-a-criterion)
- [Plain forms first](#plain-forms-first)
- [The create line, and the pips](#the-create-line-and-the-pips)
- [A failed create](#a-failed-create)
- [Filtering and searching the list](#filtering-and-searching-the-list)
- [Changing a running job's tail](#changing-a-running-jobs-tail)
- [The spec page](#the-spec-page)
    - [Saving from the page](#saving-from-the-page)
- [What the script adds](#what-the-script-adds)
- [The page changes when something changes](#the-page-changes-when-something-changes)
- [A spec's date does not move, and a phase says how long it took](#a-specs-date-does-not-move-and-a-phase-says-how-long-it-took)

---

## The row, open and shut

One row per spec, not per job, and shut by default. A shut row shows the spec's name and title, one status line,
the phase pips, how long its phases have taken, and what they cost — and carries no control
but the one that opens it: a chevron in front of the name. Under the name sits the row's notice line, and under
that, when the spec has one, the `N not verified` line. Both belong to the shut row, so a reader sees what went
wrong without opening it.

Each spec is a card: its rows share one rounded frame on the page's ground, and an empty `tr.specgap` row after the
group's last row puts the space between two cards. The gap closes a group rather than opening the next, because the
row refresh treats a spec as its head row and every row up to the next head row — a gap in front of a spec would be
swapped away with the spec above it.

Opening is a link, and lives in the query string (`?open=<project>/<folder>,…`). That is what makes it survive
the table's own row refresh, work with JavaScript switched off, and keep a row the reader just acted on open
across the redirect that follows their own submit.

An open row reveals the workflow phases underneath, always in that order, so how far a spec has got is readable
without counting rows. The phase lines sit directly under the row; its message rows — held-back, refusal, info
line — come after them. A phase never run shows a muted "not run yet". A phase run more than once shows its LATEST
attempt with the count beside it, because a re-run is ordinary.

The header carries what belongs to the spec rather than to one run, shut or open: the summed cost, one link per
repo the spec pushed to, and the state that matters most right now — whatever is in flight, else the most recent
outcome. It carries no button: the row's one action is on the caption line inside the fold, once per spec rather
than once per job.

The header is two lines: the title, then the pips, the state and the figures. An open row drops the second line and
the caption line carries the spec's summed Time and Cost instead, over the phases' own figures. Each phase line says
its own state, failed, stopped and held back included, so the badge and the pips would only say it twice. A phone
lays the caption line out the same way: the captions, then the row's button in the state column at the phase badges'
own size, then the total in the Time column.

## The row's controls

An open row adds one line per phase, and a caption line above them. Each phase line carries its own tick box, its
own AI select and its own model select — the AI select only when more than one tool is configured, since one tool
is nothing to choose between. On a narrow screen the two selects collapse into one disclosure labelled with what
they are set to, `Claude/sonnet`.

The caption line carries the row's action, and the row draws one at a time. While nothing of this spec is
running it is the run button, **labelled with the phase it would run** — "Implement", not "Run" — and disabled,
still named, when that phase is unticked. Pressing it queues everything ticked as a single job in the workflow's
order: the browser submits checkboxes in the order they are drawn, so ticking `implement` before `analyze` still
queues analyze first. While something is running it is **Cancel** instead, which the page's script fronts with a
confirmation dialog; with the script off the form posts directly. While `create` is the running step there is no
button at all: cancelling it would throw away the title and the description with no spec left to run again from.

A reader who wants to stop between steps runs one phase at a time.

**A phase the running job has already passed is disabled; one still ahead of it is not.** The queue would refuse a
duplicate of a phase the job already holds, so its box is shut. The phases in the job's tail are a different
question, and their boxes stay live: each posts itself to `POST /api/queue/<id>/steps` as it is ticked, with no
button to press — see [Changing a running job's tail](#changing-a-running-jobs-tail). That one control needs the
script; everything else on the row does not.

## What is ticked, and why

What is ticked is a recorded CHOICE, not a fresh guess on every render. It is the phases posted from New spec at
create time, or the phases ticked on the row itself at whichever Run came after that — whichever happened more
recently. That choice sticks until the reader changes it, by re-ticking the row's boxes and pressing Run again.

A spec with no such choice recorded — no create, no Run — falls back to ticking every phase it has not had. A
phase already done is left unticked either way; ticking it anyway is a rerun, and no rule stands in the way. A
recorded choice that ticks nothing at all is honoured exactly as given, which is what keeps a finished-looking
spec from offering an Archive nobody asked for.

Two kinds of spec are offered a round rather than given one: a spec whose archive is held back on unticked
acceptance criteria, and a spec reopened with its files kept whose implement has already run. For both, Analyze and Implement are offered but
never ticked by default, whatever was recorded, and Archive is ticked — the recorded choice names the round that
has just run, and a press meant for archive must not start another.

## Which phases a spec has had

**One line decides it, and nothing else:** `- **Workflow steps completed:** create, analyze` in the Tracking info
of its `4-status.md`. Each step writes its own name there once it has succeeded, and `core/rules/spec-structure.md`
§ 4-status is where that contract lives.

Nothing is inferred from a file's size, from a heading being present, or from a percentage. Each of those is a
proxy for the question rather than an answer to it, and a proxy that reads a spec as analysed before analyze has
run sends the next step off an empty template. A status file carrying no such line has had nothing as far as the
page is concerned: a spec that reads as unfinished is visible and is fixed by running the step, where a silent
guess is neither.

The percentage keeps its own job. It says how far the TDD phases INSIDE implement have got, which is a different
question from whether implement ran. It is not shown on the row — implement is ONE step, so the figure reads 0
until implement finishes and 90-something after, never anything between, and two specs of entirely different sizes
both read "0% done". The spec's own page shows it in full.

## The State column

The State column carries the spec's own state and nothing else. A job in flight reads **Running**. A job waiting
for a slot reads **Queued 3/11** — third of eleven queued — or, when it names the phase instead, "analyzing
queued". A job the runner is holding back reads **Held back**. Once nothing is running the column is one word:
**Ready**, **Done**, or **Stopped**.

Nothing more goes in the column. Why a spec stopped, and what it is held back on, is the row's notice line
underneath; which phase a press would run is on the button, which is labelled with it.

## The notice line under the name

A push that never reached origin, a landing that did not finish, a pull request the code is waiting on (or one
`gh` could not open), an archived branch left open — these are facts about the work, not a second state the spec
is IN, so none of them draws a badge in the State column. Each is said once in the row's own notice line instead.

The notices are ranked, and joined with " · " when more than one applies, in a sentence written for a user: what
happened and what to do, never git's own stderr. Each keeps its own link where it has one, so a reader never loses
one fact's link by another fact joining it on the same line. Two stand in a box of their own and are never joined:
the held-back message, and the test server's.

## Judging a held-back archive from the row

**A held-back archive can be judged without leaving the list.** The held-back message carries a › to its left. It
adds or removes the spec's key in `?checks=<project>/<folder>,…`, kept by every sort and filter link the way
`?open=` is, and unfolds the spec's acceptance criteria under the message: every criterion with its Notes cell and
a checkbox for its state, and nothing from the phase tables.

The one Save posts to the Status tab's own tick route with `?fromList=1`, so the ticks are stored the same way,
and the message goes once every criterion is settled — ticked, or marked Not
verified. Saving does not start the archive. Ticks not yet saved
survive the list's live redraw. A spec whose rows cannot be read draws one line saying so, with a link to its
Status tab, in place of the list.

## Not verified, and Failed

**Each acceptance row has two boxes, side by side at the right of its text.** They are offered under the › and on
the Status tab, in two columns under one heading: "Verified" on the first line, and "Yes" and "Not yet" on the
second (the heading is drawn once, where the list has a box, and each box's accessible name repeats it). "Not yet"
is the "Not verified" box. A read-only mark (✅, ☐, "Not verified", "Failed") sits in the same two columns, so the
text stays at the left of every row. A row marked Not verified counts as done, so archive is not held back by it, but the spec keeps a
small line `N not verified` below the project and name on its list row — live and archived, not closed — linking
to its Status tab. An archived row that draws the info line under its phase lines says the count there instead, and
only there. The State filter has a "Not verified" entry that shows only specs with such a row, archived
ones included.

On an archived spec a Not verified row stays open to change, on the Status tab and under the › of the archived
row's own line, under the columns "Yes" and "Failed". It can be ticked, or marked Failed with a note saying what did
not hold; the note field appears under the criterion while Failed is ticked. Those two are the only changes an
archived spec accepts. Ticking the last Not verified row removes the line and the spec leaves the
filter.

**A Failed row keeps the spec in the Not verified filter and carries a Reopen button.** The line under the name
reads `N not verified · M failed`, each number only when above zero, and the filter matches a spec with at least
one row of either kind. A Failed row is open for archive and is drawn read-only with its `Failed:` note. The only
way out of that state is the Reopen button on the row, which opens the same confirmation page as the row's own
Reopen. Reopen puts the Failed rows back to open and keeps their notes; such a note counts as a changed criterion
for the rule that a new round needs at least one.

## A phase's own transcript

**A phase that has run unfolds to its own transcript.** Every phase line of an open row that has run or is running
starts with a ›. It adds or removes the phase's key, `<project>/<folder>:<step>`, in `?phases=<key>,…`, kept by
every sort and filter link and every redirect after a press the way `?open=` is, and it is a plain link, so it
works with script off.

The unfolded row lists what the newest attempt that ran the step said AND what it did — its own messages, the
commands it ran and the files it wrote — at most the last 200, oldest first, each one line clipped at 160
characters, and a link to that step on the Logs tab. The commands and files are listed because a session that works
through commands writes a sentence only every few minutes, and messages alone would leave the row looking frozen
while the step is busy. Once the phase has finished, the last message is the phase's final message, whole up to 2,000
characters. A phase whose job the queue has forgotten says no messages are kept and links to the Logs tab itself.
A phase that is only queued, or that nothing touched, has no ›.

## Which tests prove a criterion

**Each criterion names the tests that prove it**, here and on the Status tab: the tests whose names carry its
AC-id, from `ac-coverage.json`, which the runner writes into the spec's folder after a completed implement
(`core/scripts/lib/run-spec-ac-coverage.sh`). Only lines the branch added count, since `AC-1` is in the tests of
many specs. A criterion
no test names gets an amber line saying so, unless analyze's Notes cell already says `Not tested:` and why.

## Plain forms first

Every control here is a plain form first. Ticking phases and pressing Run works with JavaScript switched off, and
so do Cancel and expanding a row — each posts its form and follows a 303 back to the list. `specs-client/` is a
layer ABOVE that floor, never the mechanism (see [what the script adds](#what-the-script-adds)).

**New** is a link to `/new`, a page of its own; the list itself carries no form for making a spec. Such a form
would need a spec dropdown, and a dropdown could not stay current — the row refresh deliberately replaces the ROWS
alone, so a half-set control is never wiped, and a spec created since the page loaded would be in the list and not
in the dropdown. The notice that says the runner is unavailable stands outside every fold, so that a reader is
never a click away from learning that nothing here can spend money.

The page is called Specs, not Queue. That a queue orders the runs is an implementation detail — `QueueStore`,
`/api/queue`, `QUEUE_PROJECTS` and the rest keep the name; what a reader reads does not.

## The create line, and the pips

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
drawn, so several at once move together instead of shimmering at random. `phaseChip` has no `busy` option and
`css/index.ts` no `.phase.busy` — `SPINNER` is used by `btn()`'s busy variant and by `specs-client/index.ts`'s
in-flight-press spinner, a different fact with a different lifetime (see [what the script adds](#what-the-script-adds)).

`prefers-reduced-motion` is honoured here: `.pip.now` drops the animation and holds
`--accent` still, so a machine set to reduce motion still tells a running phase from a waiting one, just without the
movement.

Filtering and sorting work on the spec's grouped jobs. "Active" means the spec has something in flight; sorting by
cost sorts on the sum. A wiki build is a job and not a spec: it has a row named `<project>:wiki`, in every project, whose name links to the
job's own page. It shows the job's state, time and cost, offers Cancel while the job is unfinished, and has no fold, no
phase lines and no run button. A spec's phase lines are the four and nothing else: a step outside them (`reopen`, `close`,
`explore`, `manifest`, `schedule`) draws no line, and the Logs tab on the spec page lists it. The spec's total time is
the sum over the four phases, so a step outside them adds nothing to it.

## A failed create

A create that ended without a spec (`failed`, `stopped`, `interrupted`, or its own merge failed, still under its
provisional key, with no merge under way) is not a row in any project: it has no number and nothing to open. The top of
the list shows one message for it instead: the project, the title and the reason in the reader's language, with **Try
again** and **Dismiss**. Each failed create has its own message, newest first, and dismissing one leaves the others.

**Try again** opens New spec (`/new?retry=<job id>`) with the project, title and description filled in; the phases,
models and "Depends on" come up at the form's defaults. A project that is no longer offered is left unselected.
**Dismiss** hides the message; the record stays for the newest 50 dismissed, so an older notification still opens the
form. A message stays until dismissed, across page loads and restarts, because it is kept in `failed-creates.json` and not
on the queue job, which the queue drops after 200 jobs.

---

## Filtering and searching the list

The state filter is one axis, and `?state=` is where it lives. It is a dropdown: a trigger showing the chosen
entry and its count, over a panel of radio links. The nine entries are "All" (the default), "Active" (everything
not archived and not closed), "Running" (only `running`, or a job whose branch is still landing), "Waiting"
(`queued` — in queue or held back — or `done` with no landing in progress), "Stopped", "Failed" (`failed`,
`interrupted`, `cancelled`, or an archived spec whose branch still exists on origin), "Archived", "Closed" and
"Not verified". The default is `STATE_FILTERS[0]` and nothing else — moving an entry to the front changes the
default for every reader. Every entry, including "All", carries its own `state=` value explicitly, so choosing one
always overrides whatever is remembered (see below).

**The chosen entry is remembered across visits, the same way the sort column is.** Choosing one sets the
`aide_state_<port>` cookie (`HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`), port-suffixed so a test board and
the real one do not overwrite each other's memory; a request with no `state=` in the query string — the Specs tab's own
link, a bookmark, the back button — falls back to that cookie instead of always landing on "All". An explicit
`?state=` always wins and becomes the new memory. The search term (`?q=`) is never remembered this way.

**An archived spec is a row on this list**, and nowhere else — there is no separate archive page. Its row is a READER
row: its name as two links — the project to its page and the rest to its own `/specs/<project>/<spec>` page — under a two-line clamp, what its phases came to in
time, and Reopen. It draws no description — a locked row's description stays searchable but is not shown — and no
archive date: the Time column holds a duration and never a date. Reopen is a link to a confirmation page
(`/specs/<project>/<spec>/reopen`) that asks whether to reset the analysis, the plan and the status as well; the
answer comes back to the list, filter and all. No model select, no tick box and no Run — the server
refuses every step but `reopen` for an archived spec (`ARCHIVE_ONLY_STEP`), and a control that would be refused is a
control that should not be drawn. The list shows no creation date on any row; the spec's page does, as the
Created line of its description's Tracking info.

**What that row says a spec cost, in time,** is computed the same way whether the row is live or archived
(`totalDuration()`, `data-model/phases.ts`): a queue-measured span per phase — the worktree, the AI session, the commit
and the push, all of it — is preferred where the queue still remembers the job, and only where it does not (an archived
spec older than the queue's 200-job memory, or a phase no job ever ran) does the phase's own file stamp stand in, which
is the AI session's own duration alone. A total of `0` across every phase reads `0s`, the same as a live row's.

**Building archived rows is gated on the chosen filter** (`filterShowsArchived` in
`data-model/filter-sort.ts`, beside the filter table, so the gate and the entries cannot disagree). A row costs two
small file reads, Aide alone has archived well over a hundred specs, and this page rebuilds itself on every change
event on every open tab — so a view that cannot show an archived row builds nothing for one (a closed spec's folder
is under `archive/` too, so Closed opens the same walk). ONE exception: an archived spec whose own branch is still
on origin is built whatever the filter says, because it has NOT finished and the reading view is where that has to
be seen. That is also why there are two archived pseudo-states, `archived` and `archived-unlanded`: the second is
archived to the Archived entry, failed to the Failed entry, and not-archived to the entry defined by excluding
archived specs, and all three fall out of the filter tables rather than out of an exception inside the filter.

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
same criteria without boxes. An old `?tab=checks` link opens the Status tab. Update, which pulls the specs
checkout (`POST /api/queue/specs/<project>/<spec>/update`), sits at the end of the tab row. The banner above the
tabs holds what belongs to the spec rather than to one document: whether it is archived or closed, the test
server's state, any error, and two facts editable in one form — what the spec depends on, and whether it requires
acceptance ticking (`POST /api/queue/specs/<project>/<spec>/tracking`).

**The Logs tab lists every step from every attempt in one flat list, no picker.** A spec with more than one job for
the same work round tags each row `Attempt N` (oldest = 1); a single-attempt spec shows no marker at all. There is no
`?job=`: the tab's own count is the true total across every attempt, not just the latest one's. **Only the Logs tab
reloads itself**, every ten seconds — by `<meta refresh>` without script, and with script by a timer that skips a
tick while a dialog is open: it is the one that moves while a step runs, and every other tab
carries a form a timer would wipe. The price is a page only as fresh as the last time it was asked for,
which is what Update is for. Each step's raw log now sits behind a summary, drawn above it, never
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
runs. The `Depends on` picker sits in the banner above the tab row, not on this tab, since a dependency is a fact
about the SPEC rather than about this one document.

**The checks on the Status tab** are `4-status.md`'s Tasks rows, every one of them — a list that only ever shrinks says
nothing about how far the spec got. The ones that are BOXES are the open rows of the CURRENT phase alone (the first
phase section still carrying an open mark, the same one the spec list's column shows): a row already ticked is a check
already made, and a row in a phase the workflow has not reached is a check nothing is waiting on. Both are shown,
neither presses. `4-status.md` is otherwise the runner's, and this is the narrow exception — one existing row's Status
mark, never its prose.

### Saving from the page

`POST /api/queue/specs/<project>/<spec>/save` writes, commits and pushes what the open document tab's own form
carried, then returns to that tab. ONE commit, ONE file. It writes to the spec's own `aide/<folder>` branch where
one is open, and to the specs repo's default branch where none is — the same branch-aware choice `/tick` makes.

`POST /api/queue/specs/<project>/<spec>/tracking` is the banner's own route: what the spec depends on and whether it
requires acceptance ticking, both merged into `1-description.md`'s Tracking info in one commit, refused once
`analyze` has already decided the acceptance half of the question.

`POST /api/queue/specs/<project>/<spec>/tick` is the same for the checks form: `4-status.md` alone, its own
commit, back to the Status tab. It is a route of its own so that ticking a box does not mean opening the description's editor. A
tick's new text is computed on the server from the row it verified against the file on disk and never taken from the
body, so no byte of `4-status.md` outside a Status cell can move. Two guards, not one: the file's `baseSha` as it was
read at, and each ticked row's own exact text posted back — a row that no longer reads as it did is refused even when
the sha still matches, which is what tells a second press apart from a first. One bad row refuses every box in the
same press; a `text` field posted to `/tick` is read by nothing, and `tick` fields posted to `/save` are read by
nothing.

Both routes refuse, with nothing written, when the checkout is dirty, on another branch, diverged or unreachable; a
commit whose push fails is reset away, because an unpushed commit in the one shared specs checkout breaks the next
fast-forward for every project in it. `/save` refuses an ARCHIVED spec, whose files are history — server-side, not by
hiding a control. `/tick` refuses a CLOSED spec whole, and an archived one row by row: the one move it allows
there is settling a row that was marked Not verified. `/save` is the only route that accepts a body over 4096 bytes — a description is not an action post
— and its own cap is 64 KiB.

The two routes these replaced, `GET /specs/<project>/<spec>/edit` and `POST .../status/tick`, answer 404: a retired
route is removed, not redirected.

## What the script adds

The page's own browser code does one thing to the controls: it keeps the reader where they are. Both of them —
Run and Cancel — are real `<form>`s that work on their own, and the script only intercepts. Cancel is intercepted
twice over: once to open its confirmation dialog, and once for the press that follows.

- **Close on the spec page asks in a dialog, with no fallback page behind it.** The Close button carries
  `data-close-ask` and a `dialog.confirmdialog` sits beside it, holding the question, a required Reason field (bounded
  and counted), a refusal line, and OK (danger) and Cancel. With script the click opens it; without script, or a
  browser without `<dialog>`, the button does nothing — Close needs script to do anything at all. OK posts the same route and stands as "Closing…" the way Reopen's own
  confirmation does; a refused post is written in the dialog's own line, which stays open with the reason still typed.
- **Reopen and Close stand behind a dialog.** Their confirmation forms carry `data-progress` (the spec page) and a
  `dialog.confirmdialog` titled "Reopening…" or "Closing…". On submit the script opens it as a modal with no buttons
  (Escape does not dismiss it, and a back/forward-cache restore closes it), posts the form, and polls
  `GET /api/queue/<id>` once a second, at most 120 times, until the job has settled and, for a `done` job, its landing
  is over. A job that is `done` takes the reader to the list; any other end, a job the queue has forgotten and a wait
  that runs out take them to the spec page, whose error line says why a `failed`, `stopped` or `interrupted` reopen or
  close ended (`failedRoundSentence`). A refused post closes the dialog and goes to the spec page with the reason.
  With no script, or a browser without `<dialog>`, Reopen's form posts natively and follows its redirect — Close has
  no such fallback: nothing without script ever opens its dialog to post from.
- **A press changes the button at once, without changing its width.**
  It disables, gains the `busy` look and a spinner ahead of its own label — the label itself stays put, only
  the `title` carries the pending word ("starting…", "cancelling…", "queueing…",
  "merging…", "creating…"), read from `data-pending` beside the label. On a row control the same
  press swaps that row's own `.phases` chips for the same spinner, holding their width with
  `style.minWidth` so the buttons beside them do not shift — freed again once the boxes come back. The `finally` block
  that undoes all of this runs under the same `isConnected` guard the button itself uses, which matters because
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
- **The New-spec form is the one exception, and it is not on this page.** It is the whole of `/new`, so it is bound
  directly rather than by delegation, and there is nothing on that page to keep. A refused create has no row to land
  on — the spec it named was never made — so its reason is written beside the form; a successful one sends the
  browser to the list, where the new job is a row.

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
once, before that connection is up, so an installed app returning from a phone's lock screen shows the current list
without waiting for the stream. Only a tab that has been
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

The **Created** heading, first in the heading row over the chevron and Spec columns, sorts the list by when the spec was
made, and a run does not move that date. The list shows no created date itself. Holding the most recently active job's
own start instead would throw a row to the top of a list sorted by it every time a phase started, so a spec made months
ago and re-run an hour ago would outrank one made this morning. The list opens sorted by this column, newest first.

The date comes from **git, never from the queue**. `QueueStore` is an LRU of 200 jobs, so a spec older than that has no
`Job` record of its own beginning left; the specs repo still has the first commit that touched the folder, years on.
`firstCommitAt` in
`src/git/description-freshness.ts` asks for it and
`SpecCreatedAtChecker` caches the answer, shaped like
`DescriptionFreshnessChecker` beside it — same key, same fail-to-nothing. The archived question keeps a cache of
its own, with its own TTL, since the two questions go stale at different rates. `withFreshness` attaches it to
each `SpecTarget`.

Two traps worth knowing before touching this:

- **The oldest commit is not `git log -1 --reverse`.** `-1` limits the commit SELECTION, which runs newest-first, and
  `--reverse` only turns the already-limited output round — the two together still answer with the newest. The oldest is
  the last line of the unlimited log.
- **A spec git cannot date sorts as the newest while it is live and as the oldest once it is finished, and deliberately
  has no fallback to a job's own time.** A `Job`-backed fallback
  would put the jumping straight back for exactly the specs that cannot be dated. The never-run tie-break in
  `sortGroups` therefore asks two things, not one: neither spec has a job AND neither has a date.
- **An archived spec's folder has moved, and a plain path-filtered log only sees the move.** Once `aide-archive-spec`
  has `git mv`'d a spec's folder into `archive/<folder>`, `git log -- .` on the new path only shows the move commit and
  anything after it — every earlier commit touched the old path and is invisible to that query. `--follow` crosses
  exactly this kind of rename, but only for a single-file pathspec, not a directory — so an archived row's creation date
  is read with `firstCommitAtFollowingRenames()` against `1-description.md`, not the plain directory lookup live
  rows use. The file has to be one whose CONTENT is unique per spec: `--follow` matches renames on content
  similarity, so `0-README.md` — the same fixed template in every spec — can be paired with an unrelated spec's
  deleted copy and answer with a stranger's date.

The other half is duration. A job carries a single `startedAt` however many steps it ran, so `finishedAt - startedAt`
is the whole job's span and belongs to no one step of it — reaching for that is the mistake `phaseDuration` exists to
prevent. Instead, **the queue stamps each step's own start** (`Job.stepStartedAt`, set fresh the instant the runner
actually spawns it) and carries it onto that step's own result once it ends (`StepResult.startedAt`) — a step's
duration is that result's own end minus its own recorded start. A job merely `queued` between two steps — held back
for a landing, a dependency, an open acceptance row, or a full concurrency slot — has not started its
next step yet and shows no duration for it at all, however long the previous step's own end sits in the past: none of
that waiting is ever inside the figure. A result that carries no `startedAt` falls back to the step before it
ending, or the job's own start for the first one.

Three things the column then says, by row type:

- A finished phase: its own settled duration, in the phase line's own time cell.
- A running phase: the same cell, carrying `data-elapsed` — the instant to count up from. The server writes a readable
  figure into it too, so the cell says something with script switched off.
- A spec with nothing left to run: its phases' durations **added together**, on the header row.
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
