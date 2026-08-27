# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs (spec 80)](#live-runs-spec-80)
- [Running specs (spec 81)](#running-specs-spec-81)
    - [Making a spec from the page (spec 93)](#making-a-spec-from-the-page-spec-93)
    - [The token](#the-token)
    - [Caps](#caps)
    - [Which AI runs a step (spec 125)](#which-ai-runs-a-step-spec-125)
    - [Running a job on a schedule (spec 259)](#running-a-job-on-a-schedule-spec-259)
    - [Adding and removing a project](#adding-and-removing-a-project)
        - [Whether a run can start there (spec 138)](#whether-a-run-can-start-there-spec-138)
        - [What Add finishes itself (spec 140)](#what-add-finishes-itself-spec-140)
    - [How many run at once](#how-many-run-at-once)
    - [Notifications](#notifications)
    - [Telling claude-usage a branch landed](#telling-claude-usage-a-branch-landed)
    - [What a finished step publishes](#what-a-finished-step-publishes)
    - [How the list reads](#how-the-list-reads)
    - [What the script adds (specs 96 and 101)](#what-the-script-adds-specs-96-and-101)
    - [The page changes when something changes (spec 189)](#the-page-changes-when-something-changes-spec-189)
    - [A spec's date does not move, and a phase says how long it took (spec 199)](#a-specs-date-does-not-move-and-a-phase-says-how-long-it-took-spec-199)
    - [Branches, and merging them](#branches-and-merging-them)
        - [Archive resolves the conflict itself (spec 171)](#archive-resolves-the-conflict-itself-spec-171)
        - [Origin decides whether a landing finished (spec 193)](#origin-decides-whether-a-landing-finished-spec-193)
- [How it looks (spec 102)](#how-it-looks-spec-102)
    - [Tokens](#tokens)
    - [Components](#components)
    - [The guard](#the-guard)
    - [Spacing lives in the container, not the component (spec 120)](#spacing-lives-in-the-container-not-the-component-spec-120)
    - [One busy flag, not a per-step lookup (spec 105)](#one-busy-flag-not-a-per-step-lookup-spec-105)
    - [A structural marker with no CSS rule uses data-*, not a class (spec 123)](#a-structural-marker-with-no-css-rule-uses-data--not-a-class-spec-123)
    - [Theme choice (spec 107)](#theme-choice-spec-107)
    - [Header and tab bar, not a sidebar (spec 119)](#header-and-tab-bar-not-a-sidebar-spec-119)
- [Deploying](#deploying)
    - [Installing it as an app (spec 173)](#installing-it-as-an-app-spec-173)
    - [On a second host](#on-a-second-host)
    - [Saying it once instead of every time](#saying-it-once-instead-of-every-time)
    - [On one machine](#on-one-machine)

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root, parses spec progress/phase from `4-status.md` files,
and renders a small static site — an overview page plus one page per project, all sharing a left-column nav. Generated
where the repos live and served by a small Bun server that also receives live aide-run events; that server listens on
localhost, and a `tailscale serve` proxy puts HTTPS in front of it
(see [HTTPS, and the one address](#https-and-the-one-address)). Generator and server can run on the same machine or on
two — no host is named anywhere in this repo.

## URL scheme

- `/` — one row per spec — every spec of every allowlisted project, whether or not it has ever run — with its workflow
  phases beneath, foldable away; run any phase from its own line, watch one, cancel one (token required). The front
  page: it is what the dashboard is used for, so it is what the dashboard opens on.
    - **The chips are one axis, and `?state=` is where it lives.** Six of them: "Not archived" (the DEFAULT, and today's
      reading view),
      "All", "Not started", "Active", "Done", "Problems" and "Archived". The default is `STATE_FILTERS[0]` and nothing
      else — moving an entry to the front changes the default for every reader — and it travels as no `state=` value at
      all, so `/` stays a clean link.
    - **An archived spec is a row here since spec 221**, which retired
      `/archive` (specs 163, 170) by folding it in. Its row is a READER row: the link to its own
      `/specs/<project>/<spec>` page, its whole description behind the same two-line clamp the archive's cell had, the
      date it was archived, what it cost in time, spec 193's "not landed" mark, and Reopen. No model select, no tick box
      and no Run — the server refuses every step but `reopen` for an archived spec (`ARCHIVE_ONLY_STEP`), and a control
      that would be refused is a control that should not be drawn. The date is the `**Archived:**`
      stamp in `4-status.md`, or, for the older half of the archive that predates the stamp, the commit that last
      touched the folder; a spec neither can date reads "date unknown" rather than leaving the column blank, and one
      with no `## Description` section reads as a dash.
    - **What the archived row says a spec COST** is its phases added together (spec 207) — the same figure the list
      shows for a spec still in flight. It is READ off a `- **Time spent (ms):** \`<n>\``
    bullet in `4-status.md` and never worked out here: the figure comes
    from the queue's job records, the queue keeps 200 jobs, and the
    archive holds 150 and grows — so a figure not written down is one
    almost every archived row would be missing. What writes it is
    `stampTotalDuration` in `serve.ts`, on the `Landing.onLanded` hook,
    the moment an `archive` step's branch has actually MERGED; it calls
    `computeSpecTotalDurationMs` — the spec list's OWN summing function,
    exported from `render/queue-list.ts` for this — with a `done` set
    from the same `withFreshness` the list uses, so the stored figure
    and the one the list showed cannot drift apart. It writes once (a
    second archive finds the bullet and leaves it), writes through
    `saveSpecFile` under the same `mergeLock` the merge just used, writes in the dashboard's OWN checkout (spec 205),
      and never fails anything: a refused write is logged and leaves that row's cell blank, exactly as for a spec
      archived before this existed. A blank cell is the honest answer there — not "date unknown", not a dash.
    - **Building those rows is gated on the chip** (`filterShowsArchived`, exported from `render/queue-list.ts` so the
      gate and the chips cannot disagree). A row costs two small file reads, aide alone archives about 150 specs, and
      this page rebuilds itself on every change event on every open tab — so a view whose chip cannot show an archived
      row builds nothing for one. ONE exception: an archived spec whose own branch is still on origin (spec 193) is
      built whatever the chip, because it has NOT finished and the reading view has always shown it. That is also why
      there are two archived pseudo-states — `archived` and `archived-unlanded`: the second is archived to the Archived
      chip, a problem to the Problems chip, and not-archived to the chip defined by excluding archived specs, and all
      three fall out of the chip tables rather than out of an exception inside the filter.
    - **`?q=` is a plain search**, a GET form carrying the rest of the view as hidden fields, matching the folder, the
      title and the WHOLE description — including the part the clamp does not show, which the note under the field says
      out loud. It came off the archive page and reads live and archived rows alike, because they are rows on one list.
- `/new` — the form that makes a spec: a project, what it builds on, a title and a description, with Create (queues the
  job and returns to the list, where the new spec's row shows its progress) and Cancel (returns having done nothing).
  Reached from the "New spec" button on
  `/`, which is a plain link. Token required, like `/`: it carries a real form.
- `/projects` — every project with description and active/archived spec counts, plus the panel that adds and removes
  them. Reached from the nav, labelled "Projects". Token required, like `/`: the panel is a mutating control, and a page
  carrying one needs a server to check the token per request.
- `/projects/<name>` — one project's own page, served (spec 185): the two things a generated file could not answer —
  what its `.aide/config`
  says, and whether a run could start here at all. The manifest is not repeated here any more (spec 238): the page
  showed a frozen copy of a file nothing on it could act on, and a manifest that fails to parse already says so on the
  project's `/projects` row, which is the live view of the same thing. Each of the seven recognized config keys is
  marked configured, worked out (naming the lockfile that decided it, hedged as a default rather than a verified
  command) or not set; a checkout with no `.aide/config` says so in as many words, because "no file" and "a file setting
  nothing" are different states and the first is what a project cloned onto a second machine is in. Below that, the same
  checks `assessProjectReadiness` runs at Add time — now on every load rather than once, in a notice gone by the next
  page. Nothing is executed and nothing is moved: a git that cannot answer leaves the settings standing, with no
  readiness section. Specs root, Worktree links and Code landing can be edited inline on this page; Save and Cancel both
  return here. The old `/projects/<name>/settings` URL redirects here. Token required, like every other `/projects`
  path.
- `/projects.html` — where that overview was generated until it was served. Now a redirect to `/projects`, keeping
  whatever the address carried; no token needed, like every other generated page. The file stays: bookmarks point at it,
  and `deploy/rsync-publish.sh` refuses to publish a site without it.
- `/<slug>.html` — one page per project (slug = lowercased name, non-alphanumerics → hyphens; collisions get `-2`,
  `-3`, …; `index`,
  `about` and `projects` are reserved). The manifest and the specs only: it is generated after a merge lands somewhere
  in the queue, and a config file an operator edits between merges would be described as it stood days ago. A live
  server's nav links `/projects/<name>`
  instead; this file is what a site published by `rsync-publish.sh`, with no server behind it, still shows.
- `/api/aide-runs` — aide runs in flight, as JSON; `POST /api/aide-run`
  receives one event. (The `/live` page that rendered them was dropped on 2026-08-18: the spec list shows every queued
  run per row, and interactive sessions are claude-usage's own page.)
- `/specs/<id>` — one job, in full. It did NOT move with the list: every job link already sent out points here. Since
  spec 237 the LIST no longer sends anyone here — a phase line opens a tab of the spec page instead — but the route, its
  renderer and its tests are untouched, for the reason above: an old link is a promise.
- `/specs/<project>/<spec>` — the whole SPEC, as it stands now, in SEVEN tabs (spec 212): Overview, one tab per document
  (Description, Analysis, Solution, Status — each stamped with the commit that last changed it), and Activity and Steps
  for one of its runs. All four files used to be stacked in full on Overview, which for a spec of any size was thousands
  of lines of preformatted text before the reader reached what they came for; Overview carries no file text at all now.
  It is where the spec STANDS: the state chip, the Update button that pulls the specs checkout
  (`POST /api/queue/specs/<project>/<spec>/update`), the title, what the spec depends on (read-only — the picker that
  CHANGES it is on the Description tab, with the file the line is stored in), and the checks, as real boxes with a Save
  of their own. **A phase line on the spec list opens the tab that shows what that phase MADE** (spec 237): create →
  Description, analyze → Solution, implement → Status, archive → Overview, since archive writes no file of its own.
  `PHASE_TAB` in `render/spec-page.ts` is the one place that mapping is written; `queue-list.ts` imports it. A step
  outside those four — `explore`, or anything not in the fixed workflow — has no tab that speaks for it and keeps
  linking to its own job page. Such a link is live whether or not the phase has ever run: the tab belongs to the spec,
  not to the run. **The Logs tab lists every step from every attempt in one flat list, no picker** (spec 240 merged the
  former Activity/Steps split into this one tab; spec 242 removed the attempt-picker chip row that used to sit above
  it). A spec with more than one job for the same work round tags each row `Attempt N` (oldest = 1); a single-attempt
  spec shows no marker at all. There is no `?job=` any more — the tab's own count is the true total across every
  attempt, not just the latest one's. **Only the Logs tab reloads itself** (`<meta refresh>`, ten seconds): it is the
  one that moves while a step runs, and every other tab carries a form a timer would wipe. The price is a state chip
  only as fresh as the last time the page was asked for, with Update beside it. An ARCHIVED spec has this page too, and
  always did — the scan records every spec's directory before it drops the archived ones from the list. Since spec 163
  it says it is archived, and its Description tab is read-only with no box to tick anywhere: the spec is a record.
  `GET /specs/<project>/<spec>/edit`, the page the textarea lived on from spec 162 until spec 212, answers 404 — removed
  rather than redirected, like every other retired route here.
- The **Description tab** is `1-description.md` in a textarea with its own Save, plus the `Depends on` picker (spec 166,
  the New-spec page's own control since spec 174 — the line it writes is a line of this very file, and leaving it in the
  textarea too would mean two writers for one fact). It is the one of the four files a person owns: the other three are
  written by a step and a hand edit there is overwritten the next time that step runs.
- The **checks on Overview** are `4-status.md`'s Tasks rows, every one of them — a list that only ever shrinks says
  nothing about how far the spec got. The ones that are BOXES are the open rows of the CURRENT phase alone (the first
  phase section still carrying an open mark, the same one the spec list's column shows): a row already ticked is a check
  already made, and a row in a phase the workflow has not reached is a check nothing is waiting on. Both are shown,
  neither presses.
  `4-status.md` is otherwise the runner's, and this is the narrow exception — one existing row's Status mark, never its
  prose.
- `POST /api/queue/specs/<project>/<spec>/save` — writes, commits and pushes what the Description tab's form carried
  (`1-description.md`, the `Depends on` line included), on the specs repo's default branch, then returns to that tab.
  ONE commit, ONE file.
- `POST /api/queue/specs/<project>/<spec>/tick` — the same, for the checks form: `4-status.md` alone, its own commit,
  back to Overview (spec 212). Until it existed, `/save` wrote both files in one commit (spec 188), which meant a person
  had to open the description's editor in order to tick a box. A tick's new text is computed HERE from the row the
  server verified against the file on disk and never taken from the body, so no byte of `4-status.md` outside a Status
  cell can move. Two guards, not one: the file's `baseSha` as it was read at, and each ticked row's own exact text
  posted back — a row that no longer reads as it did is refused even when the sha still matches, which is what tells a
  second press apart from a first. One bad row refuses every box in the same press; a `text` field posted here is read
  by nothing, and
  `tick` fields posted at `/save` are read by nothing. Both routes refuse, with nothing written, when the checkout is
  dirty, on another branch, diverged or unreachable; a commit whose push fails is reset away, because an unpushed commit
  in the one shared specs checkout breaks the next fast-forward for every project in it. Both refuse an ARCHIVED spec,
  whose files are history — server-side, not by hiding a control. `/save` is the only route that accepts a body over
  4096 bytes — a description is not an action post — and its own cap is 64 KiB. `POST .../status/tick`, the route that
  ticked one row on its own press with no Save at all, was deleted with spec 188 and still answers 404.
- `/specs` and `/queue` — where the list used to live; both redirect to
  `/`, query string intact, so an old bookmark still lands
- `/queue/<id>` — redirects to `/specs/<id>`, where the job still is
- `/settings` — global defaults for the AI and model used by Explore, Create, Analyze, Implement, Archive, Manifest and
  Reopen. Saving writes the seven step values to `queue-config.json`; later jobs use them immediately, while jobs
  already accepted keep their stored choices.
- `POST /api/queue/settings` — validates all seven model names against
  `modelChoices`, updates the JSONC file atomically while retaining comments and unrelated values, and changes the live
  defaults only after the write succeeds. Token required like the rest of the queue surface.
- `/api/queue` — the same jobs as JSON; `POST /api/queue` enqueues one;
  `POST /api/queue/<id>/cancel` acts on one. The API keeps the queue's own name: it is a contract, not a page anyone
  reads. `approve` and
  `merge` were routes here until spec 149 and are gone: there is no stop between steps to approve, and every step lands
  its own work.
- `GET /api/queue/events` — held open, `text/event-stream`, and silent until something changes (spec 189). Writes a bare
  `changed` event when a job is written or `POST /api/aide-run` reports progress, plus a keep-alive comment every 45
  seconds. The event carries no payload:
  the page answers it by re-fetching `/?rows=1`, which it already knows how to do. Token required like the rest of
  `/api/queue*`, and
  `EventSource` sends the page's cookie for it — it cannot set a header.
- `POST /api/queue/<id>/steps` — edit a RUNNING job's tail (spec 160):
  `step` plus a `checked` flag adds a phase the run has not reached yet, or removes one it has not started. The running
  step and everything behind it are refused by name, as is any job that is not running — the decision is made against
  the job as it stands when the request arrives, never against what the page believed. This is deliberately NOT
  `POST /api/queue`: that route creates a job, and for a spec with one in flight it answers with the clash refusal.
- `POST /api/queue/create` — project, title and description in; a job that MAKES a spec out, which then lands itself and
  becomes an ordinary row (token required, like the rest of `/api/queue*`)
- `POST /api/queue/projects` — add a project to the allowlist: clone it under the projects root (`gitUrl`) or register a
  checkout already there (`existingPath`), write a minimal `.aide/project.yaml` if it has none, and optionally write
  `AIDE_SPECS_PATH` into its `.aide/config`. Answers per step, in the merge route's shape (spec 112).
- `POST /api/queue/projects/<name>/remove` — take it off the allowlist and off this dashboard. Requires `confirm` to
  equal the project's name exactly, and never touches the checkout or the specs root.

- `/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`,
  `/icon-512-maskable.svg`, `/apple-touch-icon.png` — what a browser reads before it offers to install the dashboard as
  an app (spec 173). No token: a manifest fetch that answers 401 is a page no browser offers to install. All five are
  computed in `src/render/pwa.ts` and answered from memory — see "Installing it as an app" under Deploying.

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

## Live runs (spec 80)

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

The address in that block changed with spec 172: it is the HTTPS one now, and the old `:8788` address answers on the
serving host itself and nowhere else. A bookmark carrying `?token=` still works on the new address; a browser that was
already signed in signs in once more, because the token cookie belongs to the origin it was set on.

The job page (and `/api/aide-runs`) merge the stored runs with claude-usage's `/api/live` (same host — but if
claude-usage there binds one address only, pass it explicitly: `CLAUDE_USAGE=http://<address>:8787 make install-serve`;
fetched lazily and cached 5 s): liveness state, subagent count and cost so far. claude-usage unreachable → rows render
without enrichment and a notice; never an error. Runs are kept in memory (LRU 512) and mirrored to
`~/aide-dashboard/aide-runs.json`
so restarts keep them.

## Running specs (spec 81)

The spec list runs aide workflow steps headless on this machine: one job at a time, each step a
`claude -p "/aide-<step> <spec>"` process started by aide's `aide-run-spec`. A job is an ordered list of steps; a step
that ends either advances the job, parks it for approval, or ends it.

One way in: the spec's own row, expanded (spec 103 — collapsed is the default;
see [How the list reads](#how-the-list-reads)). It carries a checkbox per phase, a model dropdown, and one Run button
that queues everything ticked as a single job in the workflow's order — the browser submits checkboxes in the order they
are drawn, so ticking `implement`
before `analyze` still queues analyze first. After the model, quiet and small-text on that same controls line (spec
117 — no disclosure to open), sits the one thing nobody sets every time: which other repos the job will touch. A "stop
for approval between steps" box sat beside it until spec 133; its two states were "run straight through" and "stop after
every step", and a reader who wants the second runs one phase at a time instead.

**Every phase the job in flight was queued with shows its box disabled**, not merely the step it has reached, because
the queue would refuse any of them anyway (see
[the duplicate guard](#notifications)) — a job queued as
`analyze` + `implement` left `implement` tickable until the moment it got there, and Run then answered "already running
on this spec". The box says why on hover ("analyze is running"), in the same words the state chip uses.

What is pre-ticked is every phase the spec has not had (spec 200): a press takes the spec as far as it can go, and
unticking a box is how a reader says to stop somewhere. The button names the FIRST of the ticked phases and not the
whole list — a label is a name, not a summary, and the boxes are on the row that the press acts on. A phase already done
is left unticked; ticking it anyway is a rerun, and no rule stands in the way. `archive` is the exception the rule
needs: a spec still on this list is by definition not archived, so it counts as outstanding however the history reads,
and the pre-ticked set is therefore never empty.

**Which phases a spec has HAD is read off one line, and nothing else**
(spec 139): `- **Workflow steps completed:** create, analyze` in the Tracking info of its `4-status.md`. Each step
writes its own name there once it has succeeded, and `core/rules/spec-structure.md` § 4-status is where that contract
lives.

The three things this replaced were each a proxy for the question rather than an answer to it: `2-analysis.md` being
over 400 bytes and free of a placeholder string meant analysed, a `## Plan review` heading in `3-solution.md` meant
reviewed, and 100% in `4-status.md` meant implemented. On 2026-08-20 the first of them marked spec 138 analysed before
any analyze had run — its untouched analysis template is 693 bytes — so the row offered review-plan instead, and
review-plan ran three times against an empty template. The percentage keeps its own job: it says how far the TDD phases
INSIDE implement have got, which is a different question from whether implement ran. It stopped being shown on the row
in spec 167 — implement is ONE step, so the figure read 0 until implement finished and 90-something after, never
anything between, and two specs of entirely different sizes both read "0% done"
on the same day. The spec's own page still shows it in full.

A spec whose status file predates the line has had nothing as far as the page is concerned. That is deliberate: a spec
that reads as unfinished is visible and is fixed by running the step, where a silent guess is neither.

The State column answers what a reader came to find out, and its FIRST line is one of two things, always (spec 132): the
verb for what is happening — "analyzing", "implementing", "implementing queued" — or, once nothing is running, the
resting state and what can happen next —
"ready for implement", "archive held back — the Slack webhook", "done — nothing waiting on you". The bare words
"done" and "queued" are neither, and neither appears alone: "done" said nothing about WHAT was done, and "queued" said
nothing about which step was waiting, while both facts were known.

A second line under it used to carry the states whose badge could not say the whole thing — "never run — tick a phase
and press Run", "press Run to try implement again". Spec 174 removed it and the div it filled. Since spec 157 the row's
button stands beside the badge and NAMES the phase it would run, so the sentence was telling a reader to press the
control they were looking at, to do the thing it already said. The page says what IS; the controls say what can be done.
The pips, the chip and the branch marks each answer their own narrower question beside it.

The branch marks answer WHERE the work is and whether it landed, and nothing else. An unmerged repo reads "waiting for
archive" — one answer, whether or not a step is running for that spec, because the branch is open either way and
`archive` is what lands it. Between spec 96 and spec 174 the mark echoed the running job's own verb instead (
"archiving"), which the State column beside it was already saying: on a row with two repos the verb appeared three
times.

The four sentences about how runs work on this machine sit behind a shut "How runs work here" disclosure, like the
New-spec panel and for the same reason: the list is what people come here for. The runner-unavailable notice is NOT
folded in with them — "nothing here spends money" must not need a click.

There used to be a form above the table as well, with a spec dropdown of its own. It was the only way to queue several
steps as one job, and it read as the way you were meant to start anything — while the row refresh could not keep its
dropdown current, because that refresh deliberately replaces the ROWS alone so a half-set control is never wiped. A spec
created since the page loaded was in the list and not in the dropdown. The row does everything the form did, so the form
is gone (spec 94).

### Making a spec from the page (spec 93)

Every spec that exists is a row, and every row runs. A spec that does not exist yet has no row — so above the table
there is a "New spec"
button, and it is a plain link to `/new` (spec 121). That page is the form and nothing else: a project, what the spec
builds on, a title, a description, and two actions — Create, which posts to
`POST /api/queue/create` and returns to the list, and Cancel, which returns having done nothing. Create queues an
ordinary job whose single step is `create`, and the run is guarded, budgeted and timed exactly like any other.

It was a disclosure folded into `/` until spec 121: pressing a primary button and having the page unfold under it read
oddly, and there was no way out of the open form but pressing the same button again. Both actions work with no script at
all — a link and a form POST — and a refused submission comes back to `/new?error=…`, where what was typed can be
corrected.

Two things about it are worth knowing:

- **The project list is the raw allowlist** (`queue-config.json`'s
  `projects`, seeded from `QUEUE_PROJECTS`), not the projects the server has found specs for. Every other control on the
  page is about a spec that exists; this one is about a project whose FIRST spec may not, and such a project appears in
  no other list here.
  `/api/queue` is unchanged and still refuses a project with no discovered spec.
- **Nothing here names the spec.** The job carries a provisional key (`new-abc123de`) which names its branch and its
  worktree and nothing else; the number and the slug are decided inside the `/aide-create`
  run, whose own steps own that rule. `aide-run-spec` then reports the folder that actually appeared, as `specFolder` in
  its result — read off the disk, and left unreported when zero or several appeared rather than guessed at.

When the step succeeds the dashboard **lands the branch itself** and renames the job to the real folder. It was the
first step to do so, and it is not a convenience: the list shows what is on disk in the main checkout, which every run
keeps on its default branch, so a created spec that is only pushed to a branch appears nowhere at all. A landing that
fails leaves the provisional key in place and says which repo and why. **While any job is landing the scheduler starts
nothing at all**, whatever the concurrency is set to: a landing merges into the shared main checkout, which worktree
isolation does not cover.

The list holds SPECS, not the machine's whole run history: a spec that has been archived leaves the page along with the
jobs it had. Nothing is destroyed — `/api/queue` still returns every job and `/specs/<id>` still renders each one. A
project the server knows no specs for at all keeps every row it has: an empty spec list means "we cannot tell", never
"everything here is archived".

A spec's row is collapsed by default: name, title, one status line, the five phase pips, and at most one action button.
The four phase lines and every control — phase checkboxes, model dropdown, the also-touches field, Run, Cancel — sit
behind the same chevron in front of the name (spec 103). Expanding is a link and lives in the query string
(`?open=<project>/<folder>,…`), which is what makes it survive the table's own row refresh, what makes it work with
JavaScript switched off, and what keeps the row a person just acted on open across the swap/redirect that follows their
own submit.

Every control here is a plain form first: ticking phases and pressing Run works with JavaScript switched off, and so do
Cancel, Create and expanding a row — each posts its form and follows a 303 back to the list. `queue-client.ts` is a
layer ABOVE that floor, never the mechanism (see
[what the script adds](#what-the-script-adds-specs-96-and-101)). It cannot `import` anything: `queueClientScript()` runs
`Bun.Transpiler.transformSync` over it and inlines the result into a plain `<script>` tag — that transpiles, it does not
bundle. An
`import` survives as an ESM import inside a classic inline script (a 404, since this server does not serve that path),
and an `export` is a syntax error. Any shared, unit-testable browser module needs a bundle step or a `type="module"` tag
first; the expand/collapse link was built to need neither.

The page was called Queue until spec 87. That a queue orders the runs is an implementation detail — `QueueStore`,
`/api/queue`, `QUEUE_PROJECTS`
and the rest keep the name; what a reader reads does not.

Nothing is guessed at across a restart: the runner spawns detached, in its own process group (measured: such a child
survives
`launchctl bootout`), and **the result file is the contract** — the scheduler polls the pid and the file, and a job left
`running` is reconciled from both.

A run that hits a cap is **stopped**, never **failed**. With caps this tight a cap-stop is a common, healthy outcome,
and a reader who cannot tell it from a broken agent will start ignoring both.

### The token

The whole queue surface — `GET /`, `GET /new` and `GET /projects`, and the old addresses `/specs` and `/queue`,
included — needs a token; a token a page hands to anyone who can load the page is not a secret. Open
`/?token=<the token>` once and the browser keeps an `HttpOnly`
cookie; API callers send `X-Aide-Token`. The generated pages (`/projects.html`, `/<slug>.html`, `/about.html`) and
`/live` stay open:
they carry nothing that needs the token. The token is read from a file (`--token-file`), never an argument: `ps` shows
arguments to every user on the machine.

**The cookie is `SameSite=Lax`, and it has to be.** A `Strict` cookie is withheld on a top-level navigation that STARTED
somewhere else, and an installed app launched from the home screen is exactly that — so with
`Strict` the dashboard installed on a phone opened on "unauthorized"
while the same browser was signed in (measured 2026-08-22, a Samsung S23+, the day the app became installable). `Lax` is
still withheld from a cross-site POST, which is what `Strict` was guarding here, and every form on this page posts
same-site. Tightening it again breaks the installed app and nothing will say so until someone opens it.

A cookie already in a browser is NOT rewritten by this change: a reader who signed in before it has to open
`/?token=<the token>` once more.

**With no token configured every queue route answers 503** — off loudly, rather than open quietly. `/live`,
`POST /api/aide-run` and the static site are unaffected: spec 80's emitter sends no credential and swallows the answer,
so a 401 there would silently empty `/live`.

### Caps

Four, all checked BEFORE a step starts — a cap that only stops you afterwards is a report, not a cap. They live in the
queue config (`--queue-config`), so a wrong number costs a config edit and a restart:

```json
{
  "budgetUsd": 3,
  "jobCapUsd": 10,
  "dailyCapUsd": 20,
  "timeoutSec": {
    "implement": 5400,
    "analyze": 2400,
    "default": 1200
  },
  "permissionMode": {
    "implement": "bypassPermissions",
    "default": "acceptEdits"
  },
  "model": {
    "implement": "opus",
    "default": "sonnet"
  },
  "push": "branch",
  "concurrency": 2,
  "projects": [
    "aide",
    "aide-dashboard"
  ],
  "notifyCommand": [
    "/Users/<you>/aide-dashboard/notify-slack.sh"
  ],
  "mergeEventUrl": "http://localhost:8787/api/merge-event"
}
```

A job may only TIGHTEN a cap, and cannot set the permission mode at all. A timed-out step is charged its full budget:
the accounting over-charges what it could not measure, never the other way round. That over-charge is a ceiling, not a
measurement, so every figure it is summed into carries an `est.` beside it — the step's own row, the job's total and the
spec's.

`timeoutSec` is a table per step, read the same way `permissionMode` and
`model` below are: a step the table does not name falls to `default`. It is per step because a plain `analyze` is
minutes and an `implement` on a twenty-file change is the better part of an hour, and one number for both stopped spec
149 with its tests already green. `analyze` itself picked up a longer-than-default ceiling — 2400s — in spec 181, once
the three-reviewer-perspective routine that used to be `review-plan`'s own step started running inside it. A tightening
override is checked against each step's OWN ceiling, so a job holding both steps cannot buy `analyze` more time by
naming `implement`. A file still carrying the old flat `"timeoutSec": 1200` is ignored and the built-in defaults stand,
the same direction every other malformed key here fails in.

`projects` is the odd one out in that file: it is the only key the server WRITES as well as reads. It is the queue's
allowlist, and the Projects panel on `/` rewrites it on every Add and Remove (spec 112) — which is what makes those take
effect without a restart. The
`--queue-projects` flag is the seed for a first install where this file does not exist yet; where the file HAS a
`projects` array, it wins over the flag. A malformed one is ignored entirely and the flag is kept, the same direction
every other key here fails in.

### Which AI runs a step (spec 125)

Every step runs on Claude Code unless a `modelChoices` entry says otherwise. That table is what the per-phase model
picker offers, and each entry may name a `tool` and a `model` of its own:

```json
{
  "modelChoices": {
    "sonnet": {
      "budgetUsd": 3
    },
    "opus": {
      "budgetUsd": 15,
      "jobCapUsd": 30
    },
    "codex-fast": {
      "budgetUsd": 5,
      "tool": "codex",
      "model": "gpt-5.6"
    }
  }
}
```

`tool` is `claude` (the default, and what an entry that says nothing means) or `codex`. `model` is the literal value
handed to the CLI when it differs from the entry's own key — the key is what the picker shows and what a request posts,
so a readable name can front a model string nobody wants to read. An entry naming a tool other than claude used to say
so in the dropdown, as a `(codex)` suffix, so two entries were tellable apart before one was picked; spec 167 took that
off. The entries are called `codex-sol` and `codex-luna`, so the name already says it, and since spec 169 each option
sits under a group named after its tool, which says it a second time while the list is open. A model name that does NOT
say which tool it starts is a name to fix here, not something to patch in the label.

**The tool is a choice per PHASE, not per row (spec 169).** Every phase's dropdown lists every configured model, grouped
in an
`<optgroup>` per CLI — `Claude Code` first, then `Codex`, and a tool with nothing configured draws no group at all.
Nothing is hidden and nothing is filtered, so a row can run analyze on one CLI and implement on another; the runner has
always allowed exactly that, reading
`job.model[step]` for each step on its own and deriving both `--model`
and `--tool` from that one entry (`runnerArgv`, `src/serve.ts`). The row carried an AI select until spec 169 that posted
nothing and hid the other tool's models from all five phase selects, which is what stopped anyone discovering it.

**Every phase line has an AI picker beside its model picker (spec 179).** In the column between the phase's name and its
model, on every line — where spec 169's one-per-row `Set all…` control stood, and spec 127's row-wide AI select before
that. Picking an AI fills in the model for THAT phase, and no other. The caption names the two columns separately, `AI`
and `Model`; it read `AI - Model` over the model's column alone in between.

Which model an AI fills in is worked out by the server and carried on the option: the step's own `model` default when
that default belongs to the tool, else the first entry `modelChoices` lists for it. The browser copies the value and
never chooses between a tool's models itself.

The picker POSTS NOTHING — a press still sends the same five
`model.<step>` fields it always did. What a phase runs on stays one value on the job and the tool is derived from it, so
the picker is read on change (to fill the model in) and written on redraw (to reflect it), never the reverse. Change a
model select by hand and the AI select beside it follows at once. It is drawn only when two tools are configured — one
AI is nothing to choose between — and filling a model in is a script's job, so with scripting off the pickers and their
caption are hidden outright (`<noscript>`) and the five model selects underneath stay exactly as usable as they are with
one.

The `Set all…` control is gone with this. A deployment with one tool and several models of it therefore has no
one-action way to set every phase at once any more; each phase's model select is changed on its own line.

The pre-filled model for a phase with no run behind it and no `model`
default of its own is the first entry `modelChoices` lists. A phase that HAS run shows the model it ran on, and a
per-step `model` default still wins over both.

The queue, the worktrees, the wall-clock timeout and all the git handling are one path for both tools. Three things
differ, and all three are visible on the page rather than papered over:

- **A Codex step's budget is not enforced while it runs.** Claude Code takes a `--max-budget-usd` and stops itself;
  Codex has no equivalent flag, so for a Codex entry `budgetUsd` feeds the dashboard's own grant-and-tighten arithmetic
  before the step starts and nothing else. **The wall clock (`timeoutSec`) is the only thing that stops a runaway Codex
  step**, and it is mandatory for every step either way.
- **A Codex step reports tokens, never dollars.** No dollar figure exists anywhere in Codex's output, so the Cost column
  shows the token count and a dash where the money would be — never `$0.00`, which would add up as though the step had
  been free. A job mixing both tools has a
  `spentUsd` covering its Claude steps only.
- **A Codex step has no "Live right now" panel.** That panel's contents come from `claude-usage`, which watches Claude
  Code sessions and knows nothing of Codex threads. The Activity tab works for both: the run's transcript is parsed in
  whichever schema wrote it.

Safety modes are stored the same way for both — the queue keeps Claude's own names, per step, config-only.
`aide-run-spec` translates them for Codex: `bypassPermissions` becomes
`--dangerously-bypass-approvals-and-sandbox`, `acceptEdits` becomes
`--sandbox workspace-write`, and `plan`/`default` become `--sandbox
read-only`. A mode with no entry in that table refuses the run rather than being guessed at. (`codex exec` is
non-interactive and has no
`--ask-for-approval` flag at all — that one belongs to the interactive command — so the sandbox mode is the whole of
what there is to say.)

### Running a job on a schedule (spec 259)

A project can name recurring work of its own — a periodic analysis or report — in a `schedule:` list in its committed
`.aide/project.yaml`:

```yaml
schedule:
  - name: nightly-report
    cron: "0 3 * * *"
    prompt: docs/nightly-report.md
```

Each entry is a name (becomes the job's `schedule-<name>` tracking key, never a spec folder), a standard five-field cron
expression, and a prompt file's path, relative to the project's own root. A background poll checks every project's
entries and enqueues a `schedule` step through the same queue, runner and worktree machinery every other step uses — on
whichever AI the queue's own `modelChoices` picks for it — whenever an entry is due and nothing is already queued or
running for it. The step sends the named file's contents to the model verbatim, with no aide skill or spec folder
involved at all; write it the way you would write a prompt by hand.

**Due is computed from the most recent fire time alone — there is no backfill.** If the dashboard is down across a whole
scheduled window, that occurrence simply does not happen; nothing catches up retroactively the next time the poll runs.
A project's own page shows each entry's name, cron expression, prompt path and next computed fire time, and the projects
overview names the soonest across a project's entries.

**A cron expression is evaluated in the SERVING HOST's local timezone**, the same as an ordinary crontab — there is no
`tz:` field. Check what
"3am" means on the machine actually running the poll before relying on it across a daylight-saving transition.

**A schedule is a committed, reviewed setting, like `codeLanding` — it has no `.aide/config` fallback and no edit
form.** Change it by editing
`.aide/project.yaml` directly. A `prompt:` path that would resolve outside the project root (an absolute path, or one
whose `..` climbs past it) is dropped at parse time, and a malformed `cron:` drops that one entry — never the whole
list.

### Adding and removing a project

The Projects panel on `/projects`, behind the queue token like every other mutating control. It sits under the listing
it changes — spec 112 had to put it on `/` because the overview was a generated file with no server behind it to check a
token against, and spec 115 made the overview a served page. Add takes a name plus either a git URL (cloned to
`<projects root>/<name>`) or a path to a checkout already there, and optionally a specs root and a one-line description.
It writes a minimal manifest — the name and that description, nothing else — only when the checkout has none; filling in
the rest is `/aide-manifest`'s job afterwards, and the form says so.

#### Whether a run can start there (spec 138)

Add answered "added" and nothing else, and the things that decide whether `aide-run-spec` will START were invisible
until Run was pressed and the run refused. Skjer, added 2026-08-20, is the case: on the allowlist, checkout where the
form said, minimal manifest written — and unable to run, because the `.aide/` the Add itself had just made was
untracked, the checkout stood on a feature branch whose upstream was gone, no specs root had been named, and no worktree
links were set.

So the answer says two things now, and keeps them apart. `ok` means the registration completed. `readiness.canRun` means
a run would start. Both were asked of Skjer's add and only the first was true — and folding them into one would have
reported a checkout that IS on disk as an add to try again.

The form asks for one thing more than it used to: **Worktree links**, the space-separated repo-relative paths a run has
to symlink into its worktree because git does not carry them (`node_modules`, `.venv`). A run works in a `git worktree`,
which checks out TRACKED files only, so a project whose test command lives behind a gitignored path fails in every run
for a reason that has nothing to do with its change. Nothing can derive which paths those are, so the form asks; leaving
it empty is normal and is reported as a note rather than a fault.

The checks are `aide-run-spec`'s own prerequisites, read-only, taken after the Add has written its files — the `.aide`
written a second earlier is part of what the runner will see:

| Check           | Blocks a run when                                                                                        |
|-----------------|----------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository, or is inside a bigger one — a run would branch and push that one |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory           |
| `specsRepo`     | that specs root is in no git repository, so nothing would commit the spec a run writes                   |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out         |
| `worktreeLinks` | a configured entry leaves the repository, or names a path that is not there                              |

`worktreeLinks` is read from the project's committed `.aide/project.yaml`
first and from `.aide/config`'s older `AIDE_WORKTREE_LINKS` second (spec 184) — the same order, and the same winner, as
`aide-run-spec` itself reads them in.
`tests/fixtures/worktree-links-precedence.json` is the one table both sides are tested against, because the two are
written independently and nothing else would stop them drifting.

`defaultBranch` is asked of **every** repository a run touches — the project's, and the specs repo when the specs live
elsewhere — because the runner refuses on it in any of them. A checkout on a feature branch is reported and does not
block: the runner puts the checkout on its default branch itself.

There was a `clean` check beside it until spec 144, refusing a repository with uncommitted or untracked files. The
runner stopped refusing over that, so this stopped asking: a run reads origin's default branch into a worktree of its
own, and what somebody left uncommitted in the main checkout reaches nothing.

Nothing in the assessment mutates anything: no branch is switched, no directory made, no file committed. That is also
why the answer can go stale. A default branch resolvable when the project was added is one somebody can delete or park a
second worktree on a minute later, and Run says so at the time — this is a preflight check, not a promise.

The result is shown where Save was pressed. With script it goes into the form's own slot and the page stays put, because
the Specs root and Worktree links fields on that page are usually what fixes it and saving again re-assesses. Without
script the redirect carries the same sentence to `/projects` in the query string, where the page renders it. The
sentence is built once, on the server, so the two modes cannot drift apart.

#### A page render never waits on the network (spec 203)

`assessProjectReadiness`, above, only ever touches disk — `rev-parse`,
`show-ref`, `symbolic-ref`, `worktree list` — and that was already the rule. The commits-behind-origin count beside it
on the same row broke it: `BranchStatusChecker.commitsBehindOrigin` ran a real `git fetch
origin` (4 s timeout) inline in the `GET /projects` handler on every cache miss, which is every project on server boot
and every project again once its 30 s cache entry expires. Six configured projects made the page 1.83 s against
0.04-0.10 s for `/`, and it gets slower with every project added.

The fix moves the fetch off the request path entirely rather than shortening it: `refreshDrift()` walks the configured
projects and calls
`commitsBehindOrigin` on an `.unref()`'d `setInterval`, the same shape as the runner's own tick and the SSE keep-alive
ping, cleared in
`stop()` beside them. The request handler calls a new synchronous
`peekDrift()` instead, which reads `commitsBehindOrigin`'s existing cache and never spawns git. A project the poll has
never reached yet returns `checkedAt: null`, and the row says "origin drift not checked yet" rather than showing nothing
or waiting for an answer — the reader sees a labelled stale number instead of a spinner, never a page that blocks on
GitHub being reachable.

#### What Add finishes itself (spec 140)

Skjer again, the same afternoon: Add reported success and a run still could not start, and making one possible took
three hand steps — `mkdir`
of the specs root and its `archive/`, `AIDE_SPECS_PATH` written into
`.aide/config`, and `.aide/` appended to `.git/info/exclude`. Two of those were things the form knew and did not do, and
one was a remedy named nowhere at all.

**The name is the directory's, not the typed one.** A project is discovered as a directory under the projects root, and
`discoverProjects` reads its name off that entry and out of no manifest — so a project registered under a name that
differs could never be found again. Picking `skjer` and typing `Skjer` beside it used to be refused, in a message naming
`<root>/Skjer`, a path that does not exist either. The pick wins now, and the Name field says what it is actually for:
naming the directory a **clone** creates. A full path typed by hand is not the picker and is unchanged, mismatch refusal
and all.

**A specs root that is not there is made.** The form used to write the path into `.aide/config` and then report the
project as unable to run because there is no such directory — a refusal over a path known the moment it was written. Add
creates it, with the `archive/` beside it that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the real state either way.

**The third hand step is gone rather than automated.** Appending
`.aide/` to `.git/info/exclude` was needed because the untracked manifest Add had just written made the tree dirty, and
a dirty tree refused the run. Spec 140 answered that by naming both ways out of it in the message — commit it, or
exclude it — and spec 144 removed the refusal itself, so there is nothing left to get out of. Where a manifest belongs
is still a question with two answers (in git in a project of one's own, out of it in an employer's checkout) and still
nothing an Add can decide; it is now a question nobody is forced to answer before running anything.

**Worktree links are suggested from the checkout's own `.gitignore`.**
Nothing can derive which gitignored paths a project's commands need, which is why the field exists — but the checkouts
on offer name the candidates in a file the reader had to go and open. The field carries a
`<datalist>` of the literal, top-level entries from every offered checkout's `.gitignore`, deduped: a suggestion the
reader may ignore, needing no script, like every other control on this page. Globs, negations, comments and nested paths
are left out — they are not values
`worktreeLinks` can take. A suggestion is not an endorsement either: a
`.gitignore` routinely lists `build`, `dist` or `.gradle` beside
`node_modules`, and those are refused — with the path named — because a link is one shared symlink, and a build writing
through it would collide with every other run's.

**And both fields are PROPOSED where they can be worked out** (spec 184). A checkout's own lockfile says which package
manager owns its dependency tree, and each of those puts that tree in one well-known gitignored directory: `bun.lock`/
`package.json` proposes `node_modules`,
`pyproject.toml`/`requirements.txt` proposes `.venv`, both propose both. The Specs root is proposed from how the
projects already added lay theirs out — at least two sharing a `<parent>/<projectName>` pattern proposes
`<parent>/<newName>`, and fewer than two is an example rather than a pattern. Anything that cannot be worked out is left
blank, never guessed. With exactly one checkout on offer the answer is unambiguous and goes straight into the fields, so
a browser with no script gets the help too; with several, the proposals ride on the form and the pick fills them in.

**A project's settings can be changed after it is added.** Its own
`/projects/<name>` page keeps the current values and the read-only settings overview visible while Edit opens Specs
root, Worktree links and Code landing inline. Save and Cancel return to the same project page. The same writer still
saves the specs path to `.aide/config` and the other two settings to
`.aide/project.yaml`; unchanged values are not rewritten. The old
`/projects/<name>/settings` address redirects to the project page.

**And the readiness note is recomputed on every visit.** It used to be shown exactly once — in the query string of the
redirect an Add landed on — so an operator who did not act on it there had no way to rediscover what was missing except
by starting a run and having it refused. Each row that cannot run now carries its own note, beside the Settings link
that acts on it.

Remove takes the project off the allowlist and off this dashboard, and that is all it does: the checkout and the specs
root stay on disk, untouched. It asks for the project's name to be typed back, and the server refuses anything but an
exact match — the browser turning the button off until it matches is a convenience over that check, not the check
itself.

The generated `projects.html` carries neither control: it is a redirect to the served page now. The generated pages stay
open, which means they carry nothing that needs the token — and both of these actions do.

A server started without `--root` has no projects root to list or add to. Its `GET /projects` redirects to the generated
`projects.html`
instead of rendering an empty listing, and its nav goes on naming that file — an empty page would read as "no projects
on this machine" rather than "this server was never told where they are".

The daily cap counts the budgets of the steps **already in flight**, not only what has been recorded. Recording happens
at completion, so with several slots N jobs would otherwise each pass the same check on the same numbers, and the cap be
exceeded by (N−1) budgets before anything noticed. A job the daily cap holds back does not block the queue either:
a cheaper job behind it may take the free slot.

### How many run at once

`concurrency`, two by default. **1 to 4 is accepted and anything else — missing, non-numeric, out of range — falls back
to two**; it does not clamp, because `concurrency: 9` would otherwise have to be both 4 and 2 depending on which rule
you read. The upper bound is the only thing between a typo in this file and sixteen `claude` sessions on the serving
host.

`1` reproduces the behaviour the queue had before spec 91 exactly, so rolling back is a config edit and a restart.

Two jobs for the same spec are never started at the same time — analyze and implement for one spec are ordered by
nature. Beyond that the jobs are genuinely independent: each `aide-run-spec` run works in `git
worktree` checkouts of its own, so the main checkouts never leave their default branch and no run can see another's.

### The dashboard's own checkouts

**The checkout a run is cut from is not the one a person edits.** A worktree used to be cut from
`<projects root>/<project>` — the directory Add clones into and the directory somebody works in. Both wrote to it:
the runner puts every root it touches onto its default branch before it starts, and a landing merges and pushes from the
same tree. On 2026-08-23 three specs were archived with their code stranded on a branch, because edits made in that
checkout met what two runs were landing from it. The per-repo lock serializes the dashboard against itself; nothing
serializes it against a person's own git client, and nothing can.

So the dashboard keeps clones of its own, under
`~/aide-dashboard-checkouts/<project>/` — `code/`, plus `specs/` when the specs root is a separate repository. One per
project, never one per run;
`--dashboard-checkouts <dir>` moves them. They are made the first time they are needed, by cloning the person's
checkout's own `origin`, and reused ever after. Everything that MUTATES goes there: `aide-run-spec
--project-dir`, a landing's merge and push, Save, Update, the dependency gate's fetches, the drift poll. The person's
checkout is read for the project list and the manifests, and is otherwise asked one read-only question ever — which
origin to clone from.

**The spec list itself is read from the dashboard's own checkout, not the person's (spec 218).** Every reader-facing
listing —
`GET /projects/:name`, `GET /projects` and the home page's queue rows, archived rows included — lists from
`resolvedCheckouts.get(project)?.specs`
when the dashboard's own clone exists, falling back to the person's checkout otherwise (a new project, or one whose
clone failed). This is the same clone `aide-run-spec` resolves a spec folder against, so a folder that only exists in
the person's checkout, committed but never pushed, does not appear in the list — before spec 218 it did, and running a
step on it failed with `unknown spec: ... (not under
<dashboard-checkout>/specs/<project>)`. The fetch that keeps the dashboard's clone current happens inside
`refreshSpecCaches`'s existing schedule, never inside a request, so this still costs no git spawn on the render path
(spec 208).

Two consequences worth knowing:

- **A landed run and a Save no longer show up in a person's own checkout until they pull it.** Nothing auto-syncs into
  it, deliberately: an auto-pull would recreate exactly the collision this removes. The specs cron pulls it every two
  minutes, which is what closes the gap in practice.
- **`.aide/config` is gitignored, so a clone never carries it.** It is copied from the person's checkout on every
  ensure — it is the file an operator edits by hand between merges, and a copy taken once would go on answering with
  whatever was true the day the clone was made.
  `AIDE_SPECS_PATH` is the one key that does not survive the copy: it names a directory in the person's checkout, and is
  rewritten to name the dashboard's own specs.

A project whose checkout has no `origin` gets no clone of its own. It keeps running exactly as it did before this — in
the person's checkout — and its readiness line says so, so the one project where a run and a person's editing can still
meet is named rather than silent.

### Notifications

There is no stop between steps and no way to ask for one (spec 149). A gate used to park a job in `awaiting-approval`
until someone pressed Approve; no form on the page could ever set one, the three jobs that ever had one were posted as
JSON by hand, and every step lands its own work now, so there is nothing between two steps for anyone to weigh. A
request that still names `gateAfter` is accepted and the field ignored, like any other unknown key.

`notifyCommand` is an argv ARRAY, run with **no shell**, given one line of JSON on stdin (claude-usage's contract,
copied so one wrapper can serve both). It is spawn-and-forget, SIGTERM at 10 s and SIGKILL a second later, and absent
unless configured. `deploy/notify-slack.sh` is the wrapper we use: it reads the payload and posts one line to a Slack
incoming webhook, whose URL lives in `~/aide-dashboard/slack-webhook`
(a secret — never in either repo).

The line reads, for example:

```text
aide · 81-queue-and-runner · analyze done · $2.1 · https://github.com/…/compare/main...aide/81-queue-and-runner
```

### Telling claude-usage a branch landed

claude-usage builds its shipping-pipeline ledger out of transcripts: a merge reaches it as a `gh pr merge` inside a Bash
tool call, and a review as the prompt `/aide-analyze`'s review step writes. The reviews already arrive with nothing
configured. The merges never do — since spec 149 the dashboard merges in its own Bun process, so no session writes a
transcript to read one out of, and a merge made by hand from a terminal is `git merge`
rather than `gh pr merge`. The ledger therefore cannot answer the question it exists for, "was this merge reviewed?",
about any of our work. So the dashboard says what it did.

`mergeEventUrl` in the queue config is where it says it. Every repo a step successfully lands — `create`, `analyze` and
`archive`, code roots and specs repos alike — sends one POST with a flat JSON body:

```json
{
  "project": "aide",
  "specFolder": "158-a-merge-is-an-event-claude-usage-can-see",
  "branch": "aide/158-a-merge-is-an-event-claude-usage-can-see",
  "repoRoot": "/Users/<you>/projects/aide-specs",
  "step": "archive",
  "jobId": "1f2e3d4c",
  "timestamp": "2026-08-21T10:00:00.000Z"
}
```

**Absent unless configured**, like `notifyCommand`: with no
`mergeEventUrl` the dashboard makes no request at all, which is what every instance does today. **And never fatal** —
the merge already happened, so a sink that refuses or times out is written to the log beside it and nothing else. One
request, bounded at 1.5 s, no retries.

The receiving end is claude-usage's to settle: `pipeline_event` is keyed on a transcript uuid and a session id, and a
merge reported by a machine has neither. Leave `mergeEventUrl` unset until that endpoint exists.

### What a finished step publishes

`push` in the queue config, passed on to `aide-run-spec`:

- `none` — commit locally and stop. Review by fetching from the host that ran it.
- `branch` (default) — also push `aide/<spec-folder>`, and the specs repo's own commits. The specs page and the
  notification then link to the GitHub compare page.
- `pr` — also open a pull request. Needs `gh auth login` on the serving host; a broken `gh` records the error and leaves
  the run successful.

### How the list reads

One row per spec, not per job, and collapsed by default (spec 103):
name, title, one status line, the phase pips, and at most one action button. Expanding it (the chevron in front of the
name, `?open=…`)
reveals the workflow phases underneath, always in that order, so how far a spec has got is readable without counting
rows, plus the run controls (phase checkboxes, model, the also-touches field after it, Run, Cancel). A phase never run
shows a muted "not run yet". A phase run more than once shows its LATEST attempt with the count beside it, because a
re-run is ordinary: one spec needed three `archive` runs.

The first line is `create` (spec 116) — history, not a control. It reads done once `4-status.md` records it, which is
what `/aide-create`
writes into a new spec; a spec with a create job in the queue's history additionally shows that run (state, model, time,
cost, link), and a spec made by hand or before spec 93 shows the line inert, the same way any phase run outside the
queue does. It has no checkbox. It had no pip either until spec 167 — the pips counted only the four RUNNABLE phases
below it — and the hole made create read as a different kind of thing rather than as the phase already behind you. It is
a pip like the other four now, but not on their rule: `done` comes from the git history, which counts only the runner's
own commits, so a spec written by hand has no create commit and would show grey. Create gets the LINE's rule instead,
and it has only two states — a spec that exists was created, so the pip is past unless a create job is running right
now.

**The running phase's own pip carries the motion (spec 168).** Since spec 157 the closed row is the whole interface for
the ordinary case, so the one thing that used to say "this is running" — a spinner on the phase checkbox, `phaseChip`'s
`busy` option — lived on a line that only exists once a row is expanded, and a reader watching the collapsed list saw no
motion at all. The signal moved to `.pip.now`, the running phase's marker: it already says WHICH phase without a word
(drawn in
`--accent`), so a lighter band skimming across it left to right, in the direction the four pips already run, adds "and
it is alive" in the same mark instead of a second element. A pulse was rejected — on a 14×4 bar it reads as an alert,
not as work in progress. Every running row animates on one shared timing rather than each starting when its row was
drawn, so several at once move together instead of shimmering at random. `phaseChip`'s `busy` option is gone along with
`.phase.busy` in
`css.ts` — `SPINNER` itself stays, still used by `btn()`'s busy variant and by `queue-client.ts`'s in-flight-press
spinner, a different fact with a different lifetime (spec 104, above).

This is also where `prefers-reduced-motion` enters `css.ts` for the first time: `.pip.now` drops the animation and holds
`--accent` still, so a machine set to reduce motion still tells a running phase from a waiting one, just without the
movement.

The header carries what belongs to the spec rather than to one run, unconditionally (collapsed or expanded): the summed
cost, one link per repo the spec pushed to, and the state that matters most right now — whatever is in flight, else the
most recent outcome. A collapsed row's single action button — the way out of a conflict, where the refusal is — sits
there too, once per spec instead of once per job; Cancel is only offered once the row is expanded.

### What the script adds (specs 96 and 101)

The page's own browser code does one thing to the controls: it keeps the reader where they are. Every one of them — Run,
Cancel, Create — is a real `<form>` that works on its own, and the script only intercepts.

- **A press changes the button at once, without changing its width**
  (spec 104). It disables, gains the `busy` look and a spinner ahead of its own label — the label itself stays put, only
  the `title` carries the pending word ("starting…", "cancelling…", "queueing…",
  "merging…", "creating…"), read from `data-pending` beside the label it used to replace. On a row control the same
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
- **A refusal no longer navigates either.** The reason and the spec it belongs to are written into the address bar with
  `history.replaceState` — the same `?error=&errorSpec=` query the server's own 303 would have built — and the rows are
  re-asked with it, so the message comes back rendered on the spec's own row. The filter, the sort and the fold ride
  along in that query, which is why a refusal cannot throw the reader back to the default list.
- **The New-spec form answers for itself.** It sits outside `#jobrows`
  on purpose (a half-typed description must survive the row swap), so it is bound directly rather than by delegation,
  and a refused create has no row to land on — the spec it named was never made. Its reason is written beside the form;
  on success the form empties and shuts, and the new row arrives with the swap.

Without the script every one of those falls back to a form post and a 303 to the list: slower, and one full page load,
but functionally complete.

### The page changes when something changes (spec 189)

The list used to re-ask the server every five seconds and redraw whether anything had happened or not. Two costs came
out of that: a reader with the browser's own tools open had the ground move under them twelve times a minute, and a step
that finished waited up to five seconds to show. The server says when instead.

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

On the browser's side the polling timer is gone entirely. (Spec 199 added one back, and only one: a one-second tick that
rewrites the TEXT of the running-phase elapsed marks — see "A spec's date does not move"
below. It fetches nothing, swaps no rows and touches nothing that could move the page, so the rule this section states
is unchanged: the rows redraw when the server says something moved, and at no other time.) A `changed` event redraws the
rows unless a press is in flight — the same `inFlight`
guard the tick had, for the same reason: the server still shows the pre-press state until the press answers. The `open`
event redraws too, and that is what makes a dropped network or a restarted server heal itself: `EventSource` reconnects
on its own, `open` fires again, and the resync picks up whatever was missed. A hidden tab closes its connection and
opens a fresh one when it comes back, which is the
"the timer already stops for a hidden tab" behaviour applied to a socket.

Two things this deliberately does NOT do. There is no periodic server-side broadcast to reconcile drift — an idle page
must issue no requests and redraw not at all, which is the whole point — so a spec file hand-edited outside the
dashboard leaves its staleness badge behind until some real change happens nearby. And the runner's own two-second poll
is untouched: "about a second" means about a second after the SERVER notices, not after the step really moved.

The one server-side timer this adds is a `: ping\n\n` comment every 45 seconds. `Bun.serve` cuts a connection quiet for
`idleTimeout` (120 seconds here, set for slow git work), and a page watching a quiet queue is exactly that. It is
`.unref()`'d like the runner's timer and cleared in `stop()` besides — `bun test` runs many suites in one process, and a
timer from a stopped test's server would fire into the next one.

### A spec's date does not move, and a phase says how long it took (spec 199)

The "Started" column used to hold the most recently active job's own start, so every phase started threw the row to the
top of a list sorted by it, and a spec made months ago and re-run an hour ago outranked one made this morning. It holds
**when the spec was made** now, and a run does not move it.

The date comes from **git, never from the queue**. `QueueStore` is an LRU of 200 jobs, so a spec older than that has no
`Job` record of its own beginning left; the specs repo still has the first commit that touched the folder, years on.
`firstCommitAt` in
`src/description-freshness.ts` asks for it and
`SpecCreatedAtChecker` caches the answer, both shaped exactly like
`DescriptionFreshnessChecker` beside them — same TTL, same key, same fail-to-nothing. `withFreshness` attaches it to
each `QueueTarget`.

Two traps worth knowing before touching this:

- **The oldest commit is not `git log -1 --reverse`.** `-1` limits the commit SELECTION, which runs newest-first, and
  `--reverse` only turns the already-limited output round — the two together still answer with the newest. The oldest is
  the last line of the unlimited log.
- **A spec git cannot date shows a dash, and deliberately no fallback to a job's own time.** A `Job`-backed fallback
  would put the jumping straight back for exactly the specs that cannot be dated. The never-run tie-break in
  `sortGroups` therefore asks two things now, not one: neither spec has a job AND neither has a date.

The other half is duration. **Nothing stores one.** A job carries a single `startedAt` however many steps it ran, so `finishedAt -
startedAt` is the whole job's span and belongs to no one step of it — reaching for that is the mistake `phaseDuration`
exists to prevent. What does exist is an end per finished step (`StepResult.at`), so a step's own span runs from where
the step before it ended, or from the job's own start for the first one.

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
spec 189's rule holds unchanged.

**`formatElapsed` there is HAND-PAIRED with `durationLabel` in
`src/render/job-state.ts`** — the client file is transpiled into an inline `<script>` and can neither import nor export,
so the wording rule exists twice. `test/queue-client.test.ts`'s "the page words a duration exactly as the server does"
runs a tick against the imported
`durationLabel` over a table of spans and pins them; change one and change the other, or a phase changes its wording the
first time the clock ticks over the figure the server drew.

### Branches, and merging them

A job that touches two repositories makes a branch of the same name in both — `aide/89-merge-from-the-dashboard` exists
in the project and in the specs repo, with different contents and two separate compare pages. Merging one does nothing
for the other, and that went unnoticed three times on one day. So the header names **every** repo the spec pushed to,
each with its own compare link and its own badge, each asked of that repo's own checkout. A project whose specs live
inside it (`paceup`, `atlasaurus`) has one repo and reads as a list of one — the same code, not a special case.

The badge says what the reader needs, not merely what git answered. It used to read "not merged" whatever was going on —
a fact about the BRANCH that read as a verdict on the spec, shown in the same amber while the step writing that branch
was still running. So while the spec's job is in flight the badge names what it is doing (`analyze running`), and once
nothing is running it says what is open and why — the one window that still exists being the code after
`implement` and before `archive`.

**Nothing here is merged by hand (spec 149).** Every step lands its own work the moment it finishes: `create` and
`analyze`
merge the branch they pushed into that repo's default branch and delete it on origin; `implement` lands nothing, so the
code stays on the branch for anyone who wants to read or test it first; `archive`
merges every repo it was TOLD about — the roots its own run reported, plus the ones the queue's own history recorded for
the spec — the specs repo first, the code last, so the code is the last word — runs
`AIDE_INSTALL_CMD` after a code root exactly as the old Merge route did, and then archives. It is not "every repo the
spec's branch exists in":
the loop can only merge what it knows about, which is why it ASKS ORIGIN afterwards, see
[Origin decides whether a landing finished](#origin-decides-whether-a-landing-finished-spec-193). Leaving `archive`
unticked IS the inspection point. A landing that cannot be made (a conflict with the default branch) is refused by name
and the branch stays where it was — but
`archive` settles most of those itself before it gets that far, see
[Archive resolves the conflict itself](#archive-resolves-the-conflict-itself-spec-171). A branch whose label is a known
project name is that project's code; a label that is not any project on this machine is the specs repo, which is a
closed set rather than a guess (`.claude/rules/development.md`: "the run only watches ... the roots it knows about").

There was a Merge button until spec 149 — spec 96 put the sentence
"what a press would land" on it, spec 132 moved that sentence into the State column and the button into the opened row's
panel. Both were about a control that had one outcome: whatever it read, pressing it merged whatever was open. Spec 149
took the press away: the steps that made the work know when it is done, and `create` and `archive` had already been
landing themselves for the same reason (specs 93 and 136).

While a step is still running that button is **disabled**, and a small
"merge anyway" sits beside it behind a confirmation. Merging an unfinished spec stays possible for someone who means it;
it is no longer the thing a mouse lands on. The count is gone: `Merge (1)` said how many repos and nothing about which
kind, so a reader had to know that one meant the specs repo, that the specs repo is the plan, and that the running step
was about to rewrite it.

With JavaScript on, the button posts from the page rather than through a navigation — the shape every control on this
page now shares, see
[what the script adds](#what-the-script-adds-specs-96-and-101).

The merge itself merges the spec branch into each repo's default branch and pushes, one repo at a time:

- **A conflict refuses and names the repo.** The failed merge is aborted, so no half-merged tree is left behind — the
  same shape
  `aide-run-spec` already uses when it brings a reused branch up to date.
- **A dirty tree decides nothing (spec 144).** It used to refuse before anything touched history, back when whichever
  side got to the checkout first left it dirty. A run no longer dirties the main tree at all — it works in a worktree of
  its own and only ever fast-forwards this one — so the refusal only ever stopped merges over somebody's unrelated
  uncommitted file. The `switch`, `pull` and
  `merge` write nothing but what differs between the commits, and a file that genuinely collides raises git's own error
  instead of a guess made in advance. What the two sides can still collide over is git's `index.lock`, and there the run
  yields — its pull is a courtesy, recorded and never fatal.
- **`index.lock` is not a conflict.** A merge that loses that race used to be refused with "cannot fast-forward main —
  merge it by hand", which is the same sentence a genuinely diverged base gets. The pull is now retried twice, a quarter
  of a second apart, and ONLY when git's own stderr names `index.lock`; every other failure is refused on the first
  attempt, as immediately as before.
- **The plan lands first, the code last.** A run records the project before its specs root, so the code used to merge
  before the plan describing it. The code is the one that matters, so it is the last word.
- **A code merge can install.** Merged is not deployed: for a project that installs itself somewhere, the default branch
  moving changes nothing on this machine. Set `AIDE_INSTALL_CMD` in that project's own
  `.aide/config` and it is run in that checkout after its code merges — argv, no shell, bounded by a timeout, and
  reported beside the merge rather than turning a completed merge into a failed one. Without the key nothing runs and
  the result says plainly that deploying is still a hand step. Either way the sentence reaches the page — in the same
  banner a refusal uses, whether the merge was posted from the page or by a plain form.
- **More conflicts than before are expected, not a regression.** Two branches touching the same file conflict at merge
  time, and running several specs side by side means it happens more often. Both sides refuse and name the repo rather
  than corrupting anything, which is what turns this into a merge to do by hand — or, since spec 106, into one more
  queue step (below).
- **The report is per repo, never one collective "ok".** Several repos cannot be merged atomically, and one succeeding
  while another fails is exactly what has to be readable.
- **Nothing is deleted.** A merged branch is still worth reading, and deleting is the one step that cannot be undone
  cheaply.

An unfinished spec may be merged — every step makes branches, and merging after `analyze` is a legitimate thing to want.
It goes through the confirmed "merge anyway", so it is a choice rather than a surprise.

### Archive resolves the conflict itself (spec 171)

A spec's branch is brought up to date with the default branch before a step's own work starts, and every step but one
treats a conflict there as a person's problem: the merge is aborted and the run refuses on the spot with
`errorReason: "conflict"`. `archive` is the exception, because
`archive` is the step that LANDS the branch — a merge that fails is the merging step's problem, not a phase of its own.

So `core/scripts/aide-run-spec` hands `archive`, and only `archive`, the worktree exactly as git left it: `MERGE_HEAD`
set, the markers in the files. `/aide-archive`'s Step 1 checks for that and, when it finds it, follows
`core/skills/aide-archive/references/resolve-conflict.md` before anything else — read the conflict, resolve it or decide
not to, finish the merge with `git commit --no-edit`, run the project's own test command — and only then goes on to
archive the spec. The default branch is never touched by the step itself; the dashboard lands the resolved branch
afterwards, the way it lands any other step's work (spec 149).

There was a sixth step for this until spec 171, `resolve`, with a Resolve button on the row that queued it. Both are
gone: `resolve` is not in `WORKFLOW_STEPS`, so a post that names it is refused as an invalid entry in `steps`, and no
control on the page draws off
`errorReason` any more.

- **The condition is the literal string `archive`, never a denylist.**
  A step this got backwards would carry conflict markers into a commit, which is worse than the refusal it replaced.
- **It either finishes or puts the branch back.** Tests red, or a conflict the skill will not decide, and the merge is
  undone to the commit the branch started on. `aide-run-spec` pushes a repo only when its `HEAD` moved, so a branch put
  back never reaches origin — no new rollback machinery, the gate that already exists. A run interrupted mid-merge is
  aborted by the script before the commit loop, so conflict markers are never committed either way.
- **The test command is the gate the design rests on.** A machine resolving a conflict unattended and then landing it is
  defensible because a resolution that does not pass the project's own tests does not land.
- **A conflict that still reaches a reader is one no machine could settle.** The row shows it as the failure's own
  text — which names the branch — beside the ordinary re-run control every other failed step offers. Understanding it is
  a person's job, with the diff in front of them.
- **Archive's cost and duration are variable now.** It was a short, cheap step; a run that meets a conflict is as big a
  piece of work as a resolution ever was. No timeout change was needed — `resolve` used the same `timeoutSec.default`
  (1200s) and the same model archive already falls to.

### Origin decides whether a landing finished (spec 193)

Three specs reached the archive with their code still sitting on a branch, and every row said done. The archive STEP had
succeeded, so the job was `done` and the folder was already under `archive/` — the folder moves before the code merge is
even attempted. The landing that failed after it stored a sentence and a reason on the job, and nothing was drawing
either. **A spec whose code did not land is not finished, and its row has to say so.**

- **The archive landing asks origin, after merging.** One
  `git ls-remote --heads origin 'refs/heads/aide/*'` per repo root, cached for 30 seconds, asked fresh at the end of a
  landing because the merge has just deleted the branch it is about to ask about. A root that still holds
  `aide/<folder>` is a landing that did not finish, whatever the merge loop reported — and this catches every cause at
  once: a conflict, a repo the queue never knew about, history the LRU cap evicted, a push that half-succeeded.
- **It is `archive`'s question and no other step's.** An `analyze`
  landing runs while implement's code branch is legitimately open, and the same check there would call a healthy landing
  failed.
- **A failed landing moves the job to `failed`.** Every page reads the state through one path, so it reads as unfinished
  wherever the job is shown. Downgraded only from `done`: the runner may have queued the job's NEXT step in between, and
  a landing must not overwrite a job that has moved on.
- **`errorReason` is `"conflict" | "unlanded"`.** The class, beside the sentence a person reads — the sentence is joined
  across repos before any page sees it, so nothing may match on it. Declared twice, in
  `src/queue.ts` and `src/render/job-state.ts`, and pinned to each other by a test in `test/queue.test.ts` the way
  `PHASE_STEPS` is pinned to
  `QUEUE_STEPS`.
- **An unanswerable question invents nothing.** `ls-remote` that fails is `null`, and `null` claims neither that the
  branch is open nor that it is gone — the same fail-open rule `isMerged` keeps. A network blip must not report every
  archive as unlanded.
- **The spec keeps its row while its branch is open.** Every archived spec has a reader row on the specs list since spec
  221, but only on a chip that asks for one; a spec whose own `aide/<folder>` is still on origin is built whatever the
  chip, so it stays on the DEFAULT view — wearing the "not landed" mark, and counted by the Problems chip. It rendered
  as an ordinary failed job row until spec 221, offering a Run the server would have refused. The filter is the BRANCH,
  never the job's `errorReason`:
  `146-one-place-owns-a-steps-commit` carried no reason at all, and a stale reason on an old job would resurrect a row
  for a spec that is genuinely finished.
- **The way out is the step that already exists.** `archive` can be enqueued again for such a spec: `aide-run-spec`
  hands it the open merge, `/aide-archive`'s Step 1 resolves it, Step 2 stops because the folder has already moved, and
  the landing that follows merges cleanly. A set that has not been refreshed yet is empty, so the enqueue fails closed.
- **What it does not do.** The Slack ping that already said "finished"
  is not withdrawn — `announce` belongs to the Runner and fires before the landing exists. And a page loaded in the
  second between
  `complete()` writing `done` and the landing settling still reads
  `done`; the correction arrives a moment later.

Filtering and sorting work on those groups. "Active" means the spec has something in flight; sorting by cost sorts on
the sum. A step outside the four (`explore`, `create`, `manifest` — valid steps the form does not offer) is appended
after them rather than dropped, so a run is never invisible (spec 86).

## How it looks (spec 102)

One design foundation, and nothing outside it. Before spec 102 the stylesheet was the sum of one small addition per
spec: ten font sizes with no scale, nine greys, blue/amber/red from three unrelated palettes, and a class per control
per spec (`.stepbox`, `.chip`,
`.state`, `.pip`, `.tick`, …) — a button in three versions depending on which form it sat in.

### Tokens

`src/render/css.ts` declares every colour, type size, space and radius ONCE, as CSS custom properties, between the
`tokens:start` and
`tokens:end` sentinels — and again inside
`@media (prefers-color-scheme: dark)`, where the same ramp is read from the other end. Every rule below the block uses
`var(--…)`; nothing else in the file may contain a literal.

The palette is the brand's: warm neutrals (paper `--bg`, card
`--surface`, ink `--text`), vermilion `--accent`, and `--danger` set to the darkest bar of the mark rather than to a
shade of the accent — so
"running" and "refused" never rest on hue alone. The refused badge is also the only live one with a visible border, and
the row that carries it carries a `.rowmsg.err` with a warning mark beside the reason.

### Components

`src/render/components.ts` is the one place markup for them is built:

| Component       | Variants                                                               |
|-----------------|------------------------------------------------------------------------|
| `btn()`         | bare (secondary), `primary`, `ok`, `danger`, `busy`, disabled, `small` |
| `badge()`       | `b-idle`, `b-running`, `b-waiting`, `b-ready`, `b-refused`, `b-done`   |
| `phaseChip()`   | `default`, `checked`, `done`, `off` (with the reason in `title`)       |
| `rowMessage()`  | `err`, `warn`, `info`                                                  |
| `field()`       | label above any control, one height and one radius                     |
| `filterPills()` | "Label · count", the chosen one marked with `aria-current`             |

`STEP_LABELS` lives there too — a step's technical name mapped to a friendlier one shown to a reader, while
`data-phase`, the checkbox
`value`, the queue step and the skill all keep the technical name regardless. It is empty today: `review-plan` (once
shown as `review`)
folded into `analyze` in spec 181, and no other step needs the substitution.

The brand is `src/render/brand.ts` — the mark, the wordmark and the favicons, all inline SVG and data URIs, because the
generated site is published as plain files and has to work opened from a folder.

### The guard

`test/css-token-guard.test.ts` fails the suite on a colour literal or an off-scale font size anywhere in `css.ts`
outside the token block, and on any CSS class a render file emits that is not one of the components, one of the named
`queue-client.ts` selector hooks (`rowrun`, `actionform`, `mergeform`, `refused`,
`refusal`, `newspec`, `newspecform`) or one of the short list of structural names it writes out in full.

So a spec that wants a look it cannot build from the tokens has to change the TOKENS — visibly, in one block — rather
than add a colour beside them.

`CSS` in `css.ts` is a template literal, so a backtick inside a comment closes it and the file stops parsing —
`bunx tsc --noEmit` catches this,
`bun test` alone does not (spec 165). A comment's prose also reaches the browser as page content, re-read on every
request, so it is read by whoever views source, not just by the next editor (`queue-detail.test.ts`
proves the re-read by writing a marker word to a comment and asserting a second response does not contain it).

`mergeoverride` in that allow-list and in `queue-client.ts`'s `ACTIONS`
selector is dead in production since spec 105: no render path emits it any more (the server stopped emitting it in
commit `cd81e95`, before that spec). It stays deliberately — generic pending/disable plumbing shared by four form
classes, not worth touching `queue-client.ts`/
`queue-client.test.ts` to remove for a class nothing else needs.

### Spacing lives in the container, not the component (spec 120)

A gap between two interactive controls comes from the flex `gap` on the row that holds them, never from a `margin` on
one of the components. Spec 102 fixed colours, sizes and radii the same way — one token, used everywhere — but left
spacing per spot: `.mergeform`,
`.actionform` and `.extra` each carried their own
`margin-left`, so a component that looked right beside one sibling carried the wrong (or doubled) gap into the next
place it was used.
`test/css-token-guard.test.ts` now asserts these classes declare no
`margin`, alongside the existing check that `tr[data-controls] .row`
still has a scoped, non-`center` `align-items` — a row that mixes a labelled field with plain buttons needs its own
baseline, not `.row`'s default, and the override must stay scoped to that one row's
`data-controls` attribute rather than changing what `.row` means everywhere else (the filter bar uses `.row` too).

### One busy flag, not a per-step lookup (spec 105)

A spec's queue row reads its "is anything in flight" state from a single predicate, `specBusy()` in `queue-list.ts`,
rather than each control re-deriving it from the in-flight job's own `steps` list. The earlier per-step lookup let a row
show a step as tickable, and Run as clickable, while a job was already running on the spec — the queue would refuse the
request, so the row promised something it could not keep. Every control that can act on a busy row — the phase boxes,
the Run button, and the model and "also touches" fields — reads the same flag, so a new control cannot forget to check
it.

Spec 160 narrowed that, and only that: the boxes for phases a RUNNING job has not reached yet stay live, so a reader who
knows more at minute ten than at minute zero can add a phase to the run or drop one it has not started. Which those are
is not re-derived by the row — the server puts them on it (`editableSteps`, from `tailEdits()` in `queue.ts`, the same
function the edit route refuses against), so a box is never drawn live for an edit the store would say no to. Everything
else is as it was: the running step and every step behind it stay locked, a job merely `queued` between two steps locks
the whole row, and a live box posts to `POST /api/queue/<id>/steps` on the tick itself rather than to the Run form,
which while busy would be asking for a second job. A live box is the one `phaseChip` that does nothing with script off —
it belongs to no form — and that is a known limitation, not an oversight.

### A structural marker with no CSS rule uses data-*, not a class (spec 123)

`test/css-token-guard.test.ts` holds render files to a closed class vocabulary (see [The guard](#the-guard)). A render
change that needs to mark up a structural role — nothing to style, just something a test or a future render pass needs
to find — should not grow that vocabulary for a class that carries no CSS rule. Spec 123's per-phase caption row
(`Phase` / `Model` above the phase lines' pickers) is marked
`data-caption="1"` instead of a class for exactly this reason: adding it to the guard's allow-list would have been
accepted, but every entry there is meant to declare tokens, and this one declares nothing.

### Theme choice (spec 107)

The nav carries a Dark/Light/Auto control, stored in the browser (`localStorage`), not on the server — the generated
pages are files with no server in front of them when opened from a folder, so nothing server-computed could carry the
choice. An explicit pick sets
`data-theme` on `<html>`; two extra token blocks in `css.ts`,
`:root[data-theme="dark"]` and `:root[data-theme="light"]`, override the `@media (prefers-color-scheme: dark)` block by
attribute-selector specificity (0-2-0 beats 0-1-0) regardless of source order. Auto needs no rule at all — no attribute
set falls straight through to the existing OS-driven CSS.

**This is the one deliberate exception to "generated pages carry no page code."** Applying the stored choice before
first paint (no flash)
needs a script that runs before body content, on every page — served and generated alike — so `src/render/shell.ts`'s
`pageShell()` now emits exactly one shared, unconditional `<script>` in `<head>`:
`src/render/theme-script.ts`, inlined the same way `serve.ts` inlines
`queue-client.ts` for the served `/` page, and tested the same way (transpile the file and run it against a fake DOM —
`theme-script.ts`
cannot `import`/`export`, for the same reason `queue-client.ts` can't). This is a separate mechanism from `opts.script`
(end-of-body, served-`/`-only, unchanged) — a page can now carry two `<script>` tags, so a test that locates "the"
script by first occurrence will silently grab the wrong one; find each by a substring unique to its content.

### Header and tab bar, not a sidebar (spec 119)

Every page's `<body>` is `header + nav.tabs + main` now — `pageShell()`
no longer wraps a `.layout` flex-row around a sidebar `nav()` and
`main`. `nav()` is gone; `shell.ts` builds `pageHeader()` (the wordmark, then a "..." menu) and `tabBar()`
(Specs/Projects) instead, and the sidebar's ~12rem reserved column is gone with it.

The "..." menu is a `<details>`/`<summary>` disclosure, the same pattern
`.more`, `.newspec` and `.intro` already used — not a JS-driven popover. That keeps `queue-routes.test.ts`'s "no page
script beyond the theme switcher" guarantee true by construction and keeps the menu working with JavaScript off, like
every other control on the site. The tab bar reuses
`filterPills()` in its `"page"` mode (the same call the job detail page already made for its own tabs), which is why
`filterPills()` now omits the `<span class="lbl">` wrapper when its `label` argument is `""` — a page-level tab bar
needs no group caption, and the wrapper used to render empty regardless.

`.layout`'s `min-height: 100vh` had no other rule carrying it — removing
`.layout` without carrying that forward would have let short pages (an empty spec list) stop filling the viewport. It
now sits on `body`.

## Deploying

### HTTPS, and the one address

The dashboard is reached at `https://<serving-host>.<tailnet>.ts.net/`, and only there. The Bun server binds `127.0.0.1`
and a `tailscale serve`
proxy terminates TLS in front of it, with a certificate Tailscale issues and renews itself. Nothing in the server does
any of this — no certificate handling, no scheme awareness, no host check anywhere in
`serve.ts`.

`make install-serve` sets the proxy up, so it is not a step anybody has to remember:

```bash
tailscale serve --bg --https 443 http://127.0.0.1:8788
```

`--bg` persists the rule in tailscaled's own state, which is why this needs no launchd job of its own and is safe to
re-run — the deploy issues it again on every install.

**`BIND` has to be `127.0.0.1`, and `install-serve` refuses anything else** when the serving host has tailscale on it.
This is the one thing here with a measurement behind it (2026-08-21): tailscaled will not proxy to the host's own
tailnet address — pointed there it hangs for 75 seconds and answers 502. `0.0.0.0` would work for the proxy but would
also open the dashboard on the house network, a door that does not exist today. Localhost closes the question. A host
with no tailscale at all gets the plain deploy it always had, with a note saying so; only the wrong `BIND` is fatal,
because that one fails silently.

Two tailnet settings had to be enabled once, both in the admin console:
**Serve**, and **HTTPS Certificates** under DNS. `TS_PORT` moves the proxy off 443 if the serving host needs that port
for something else.

Why it matters beyond a nicer URL: a service worker needs a secure context, so the dashboard could not be installed as
an app on a phone or a desktop until this landed.

### Installing it as an app (spec 173)

The served dashboard is a web app you can install: Chrome and Edge offer it from the address bar, and iOS Safari from
Share → "Add to Home Screen". It then opens in a window of its own, with the mark as its icon and the page's own
background behind the title bar.

**Install it after signing in, not before.** An installed app is launched on `start_url` — `/`, with no query string —
so the token has to be in the cookie already. Open `/?token=<the token>` once in the browser, and the installed app
opens straight into the spec list. The other order gives a 401 as the app's first screen, and the fix is the same: open
it with `?token=` once.

Five routes make it work, and none of them is a file:
`/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`,
`/icon-512-maskable.svg` and `/apple-touch-icon.png` are all computed in `src/render/pwa.ts` and answered from memory,
so nothing has to be kept in sync with the mark by hand and nothing is published by rsync. They are the only things on
this site a page fetches rather than carries inline — a browser will not install a page whose manifest is a data URI —
and they are outside the token, because a manifest fetch that answers 401 is a page the browser will not offer to
install at all.

The service worker caches **nothing**. Every line of this dashboard is live state, and a queue served out of yesterday's
storage would be worse than no app at all: it passes every request through to the server and answers a page load with a
short "not reachable" page when the tailnet is out of reach. That is all it is for — that, and being what a browser
looks for before it offers to install anything.

None of this works over plain HTTP: a service worker needs a secure context, which is what the section above is about.
The manifest and the icons are served either way, and the tags on the page are inert until then.

### On a second host

`MINI=<host> make install-serve` clones or pulls the repo there (the clone URL comes from this checkout's own `origin`),
installs deps, renders a launchd plist and starts the job. No plist is committed:
`deploy/render-plist.ts` builds it per invocation from the target's own
`$HOME`, resolved over ssh at install time. Logs go to
`~/Library/Logs/aide-dashboard/serve.log` on that host.

**The repo it clones there is the dashboard's OWN checkout —
`~/aide-dashboard-checkouts/aide/code` — not a checkout a person edits.** That is the directory a code landing merges
into and runs
`AIDE_INSTALL_CMD` in (spec 205), and the landing restarts the launchd job afterwards. Point the job anywhere else and
the restart reloads code the landing never touched: on 2026-08-24 two specs reached
`origin`, were installed, and changed nothing on the served page until somebody ran `git pull` by hand in
`develop/aide`. The path is written once in the Makefile (`MINI_REPO`) and once in
`src/dashboard-checkout.ts` (`dashboardCheckoutRoot`), and
`test/install-serve-paths.test.ts` reads both and fails if they disagree.

`install-serve` creates that checkout itself, with plain `git clone`
over ssh, so a fresh host needs neither the checkout nor a running service beforehand. Once the service boots from it,
its own periodic
`ensureDashboardCheckout` keeps it current from then on.

**An already-installed service migrates by re-running the same command.** `make install-serve` is idempotent and is
already the documented upgrade path (`deploy-serve: install-serve`) — it rewrites the plist with the new location and
restarts the job. Nothing else is needed, and the person's own checkout on that host goes back to being just a working
copy: no service reads from it, so letting it fall behind stops mattering.

**Check your `.env.deploy` for a `MINI_REPO` override before upgrading.** It is gitignored and per-machine, so a host
that names its own checkout there keeps pointing the service at that checkout — which is the exact bug above,
reintroduced for that one operator. Remove the line and let the default apply.

Everything is overridable, nothing personal is baked in:

All paths are relative to the serving host's own `$HOME`.

| Variable         | Default                              | What it is                                                        |
|------------------|--------------------------------------|-------------------------------------------------------------------|
| `MINI`           | — required                           | the ssh target                                                    |
| `PORT`           | `8788`                               | port to serve on, behind the proxy                                |
| `TS_PORT`        | `443`                                | port tailscale serve terminates TLS on                            |
| `MINI_REPO`      | `aide-dashboard-checkouts/aide/code` | the repo to clone or pull — the dashboard's own checkout          |
| `MINI_SRC`       | `$(MINI_REPO)/dashboard`             | the directory bun runs in, and what the plist points at           |
| `REMOTE_STATE`   | `aide-dashboard`                     | site, mirrors, queue state                                        |
| `REMOTE_BUN`     | `.local/share/mise/shims/bun`        | bun on that host                                                  |
| `LABEL`          | `com.aide-dashboard.serve`           | launchd job label                                                 |
| `QUEUE_PROJECTS` | `aide,aide-dashboard`                | the allowlist's first-boot seed                                   |
| `ROOT`           | unset                                | project root there (omitted when unset)                           |
| `BIND`           | unset                                | address to bind; `127.0.0.1`, or the tailscale serve step refuses |
| `CLAUDE_USAGE`   | unset                                | claude-usage URL (omitted when unset)                             |

Publishing the generated site to that host is separate:
`AIDE_DASH_HOST=<host> make publish`. Before rsyncing (with `--delete`),
`deploy/rsync-publish.sh` checks that a specific file exists under
`out/` — a guard against wiping the serving host with an empty directory. That filename is a second place the front
page's identity lives, next to the route table above: renaming which generated page is the front page (spec 100) means
updating this guard too, not just the route strings.

### Saying it once instead of every time

Copy `.env.deploy.example` to `.env.deploy` and fill in your own machines. The Makefile includes it, so
`make install-serve` and
`make publish` stop needing a wall of variables on the command line. The file is gitignored — which is the point: the
tracked repo names nobody's machine, and this is where yours lives instead.

### On one machine

`make serve-local` generates the site and serves `out/` from the same machine — no ssh, no rsync, no launchd, no second
host involved. `PORT=`
and an optional `ROOT=` (the directory to scan for projects) are the only knobs. This is the whole thing running in one
place.
