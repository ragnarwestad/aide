# aide-dashboard

## Table of contents

- [What it is](#what-it-is)
- [URL scheme](#url-scheme)
- [Usage](#usage)
- [Live runs](#live-runs)

Longer pages of their own:

- [Running specs](docs/running-specs.md) — the queue, the runner, the checkouts, branches and landing
- [How it looks](docs/design-system.md) — tokens, components, the class vocabulary guard
- [Deploying](docs/deploying.md) — HTTPS, the serving host, installing it as an app

---

## What it is

Dashboard for aide projects (specs in aide-specs): scans a root for
`.aide/project.yaml` manifests, resolves each project's specs root, parses spec progress/phase from `4-status.md` files,
and renders a small static site — an overview page plus one page per project, all sharing a left-column nav. Generated
where the repos live and served by a small Bun server that also receives live aide-run events; that server listens on
localhost, and a `tailscale serve` proxy puts HTTPS in front of it
(see [HTTPS, and the one address](docs/deploying.md#https-and-the-one-address)). Generator and server can run on the same machine or on
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
    - **An archived spec is a row here**, on this list and nowhere else — there is no separate archive page. Its row is
      a READER row: the link to its own
      `/specs/<project>/<spec>` page, its whole description behind a two-line clamp, the
      date it was archived, what it cost in time, the "not landed" mark, and Reopen. No model select, no tick box
      and no Run — the server refuses every step but `reopen` for an archived spec (`ARCHIVE_ONLY_STEP`), and a control
      that would be refused is a control that should not be drawn. The date is the `**Archived:**`
      stamp in `4-status.md`, or, where a folder carries no stamp, the commit that last
      touched it; a spec neither can date reads "date unknown" rather than leaving the column blank, and one
      with no `## Description` section reads as a dash.
    - **What the archived row says a spec COST, in time,** is read the same way Cost is: a
      live `reduce` in `readerGroup()` (`data-model/group-builders.ts`) over each phase's own `timeSpentMs`, off the
      per-phase Tracking info files `spec-files.ts`'s siblings already parse — never a figure worked out once, at
      archive-landing time, off the queue's own job records. The queue keeps 200 jobs while the archive holds 150 and
      grows, so a figure stamped at landing time is unwritable for any spec whose jobs the queue has already
      forgotten. The live reduce has no such window — it reads whatever each phase's own file still says, whenever
      the row renders. A total of
      `0` across every phase draws a bare date with no duration span, the same "nothing recorded" rule `costCell()`
      already gives an all-zero `spentUsd`.
    - **Building those rows is gated on the chip** (`filterShowsArchived`, exported from `render/queue-list.ts` so the
      gate and the chips cannot disagree). A row costs two small file reads, aide alone archives about 150 specs, and
      this page rebuilds itself on every change event on every open tab — so a view whose chip cannot show an archived
      row builds nothing for one. ONE exception: an archived spec whose own branch is still on origin is
      built whatever the chip, because it has NOT finished and the reading view is where that has to be seen. That is
      also why
      there are two archived pseudo-states — `archived` and `archived-unlanded`: the second is archived to the Archived
      chip, a problem to the Problems chip, and not-archived to the chip defined by excluding archived specs, and all
      three fall out of the chip tables rather than out of an exception inside the filter.
    - **`?q=` is a plain search**, a GET form carrying the rest of the view as hidden fields, matching the folder, the
      title and the WHOLE description — including the part the clamp does not show, which the note under the field says
      out loud. It reads live and archived rows alike, because they are rows on one list.
- `/new` — the form that makes a spec: a project, what it builds on, a title and a description, with Create (queues the
  job and returns to the list, where the new spec's row shows its progress) and Cancel (returns having done nothing).
  Reached from the "New spec" button on
  `/`, which is a plain link. Token required, like `/`: it carries a real form.
- `/projects` — every project with description and active/archived spec counts, plus the panel that adds and removes
  them. Reached from the nav, labelled "Projects". Token required, like `/`: the panel is a mutating control, and a page
  carrying one needs a server to check the token per request.
- `/projects/<name>` — one project's own page, served: the two things a generated file could not answer —
  what its `.aide/config`
  says, and whether a run could start here at all. The manifest itself is not repeated here — a frozen copy of a file
  nothing on the page can act on, and a manifest that fails to parse already says so on the
  project's `/projects` row, which is the live view of the same thing. Each of the seven recognized config keys is
  marked configured, worked out (naming the lockfile that decided it, hedged as a default rather than a verified
  command) or not set; a checkout with no `.aide/config` says so in as many words, because "no file" and "a file setting
  nothing" are different states and the first is what a project cloned onto a second machine is in. Below that, the same
  checks `assessProjectReadiness` runs at Add time, on every load rather than once in a notice gone by the next
  page. Nothing is executed and nothing is moved: a git that cannot answer leaves the settings standing, with no
  readiness section. Specs root, Worktree links and Code landing can be edited inline on this page; Save and Cancel both
  return here. `/projects/<name>/settings` redirects here. Token required, like every other `/projects`
  path.
- `/projects.html` — a redirect to `/projects`, keeping
  whatever the address carried; no token needed, like every other generated page. The file stays: bookmarks point at it,
  and `deploy/rsync-publish.sh` refuses to publish a site without it.
- `/<slug>.html` — one page per project (slug = lowercased name, non-alphanumerics → hyphens; collisions get `-2`,
  `-3`, …; `index`,
  `about` and `projects` are reserved). The manifest and the specs only: it is generated after a merge lands somewhere
  in the queue, and a config file an operator edits between merges would be described as it stood days ago. A live
  server's nav links `/projects/<name>`
  instead; this file is what a site published by `rsync-publish.sh`, with no server behind it, still shows.
- `/api/aide-runs` — aide runs in flight, as JSON; `POST /api/aide-run`
  receives one event. There is no page rendering them: the spec list shows every queued
  run per row, and interactive sessions are claude-usage's own page.
- `/specs/<id>` — one job, in full. The LIST does not send anyone here — a phase line opens a tab of the spec page
  instead — but the route, its
  renderer and its tests stay, for the reason above: an old link is a promise.
- `/specs/<project>/<spec>` — the whole SPEC, as it stands now, in SEVEN tabs: Overview, one tab per document
  (Description, Analysis, Solution, Status — each stamped with the commit that last changed it), and Activity and Steps
  for one of its runs. Overview carries no file text at all — stacking four files in full there put thousands
  of lines of preformatted text between the reader and what they came for.
  It is where the spec STANDS: the state chip, the Update button that pulls the specs checkout
  (`POST /api/queue/specs/<project>/<spec>/update`), the title, what the spec depends on (read-only — the picker that
  CHANGES it is on the Description tab, with the file the line is stored in), and the checks, as real boxes with a Save
  of their own. **A phase line on the spec list opens the tab that shows what that phase MADE**: create →
  Description, analyze → Solution, implement → Status, archive → Overview, since archive writes no file of its own.
  `PHASE_TAB` in `render/spec-page.ts` is the one place that mapping is written; `queue-list.ts` imports it. A step
  outside those four — `explore`, or anything not in the fixed workflow — has no tab that speaks for it and keeps
  linking to its own job page. Such a link is live whether or not the phase has ever run: the tab belongs to the spec,
  not to the run. **The Logs tab lists every step from every attempt in one flat list, no picker.**
  A spec with more than one job for the same work round tags each row `Attempt N` (oldest = 1); a single-attempt
  spec shows no marker at all. There is no `?job=`: the tab's own count is the true total across every
  attempt, not just the latest one's. **Only the Logs tab reloads itself** (`<meta refresh>`, ten seconds): it is the
  one that moves while a step runs, and every other tab carries a form a timer would wipe. The price is a state chip
  only as fresh as the last time the page was asked for, with Update beside it. An ARCHIVED spec has this page too —
  the scan records every spec's directory before it drops the archived ones from the list. It
  says it is archived, and its Description tab is read-only with no box to tick anywhere: the spec is a record.
  `GET /specs/<project>/<spec>/edit` answers 404 — removed
  rather than redirected, like every other retired route here.
- The **Description tab** is `1-description.md` in a textarea with its own Save, plus the `Depends on` picker (also the
  New-spec page's own control — the line it writes is a line of this very file, and leaving it in the
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
  back to Overview. It is a route of its own so that ticking a box does not mean opening the description's editor.
  A tick's new text is computed HERE from the row the
  server verified against the file on disk and never taken from the body, so no byte of `4-status.md` outside a Status
  cell can move. Two guards, not one: the file's `baseSha` as it was read at, and each ticked row's own exact text
  posted back — a row that no longer reads as it did is refused even when the sha still matches, which is what tells a
  second press apart from a first. One bad row refuses every box in the same press; a `text` field posted here is read
  by nothing, and
  `tick` fields posted at `/save` are read by nothing. Both routes refuse, with nothing written, when the checkout is
  dirty, on another branch, diverged or unreachable; a commit whose push fails is reset away, because an unpushed commit
  in the one shared specs checkout breaks the next fast-forward for every project in it. Both refuse an ARCHIVED spec,
  whose files are history — server-side, not by hiding a control. `/save` is the only route that accepts a body over
  4096 bytes — a description is not an action post — and its own cap is 64 KiB. `POST .../status/tick` answers 404.
- `/specs` and `/queue` — both redirect to
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
  reads. There is no `approve` and no
  `merge`: there is no stop between steps to approve, and every step lands
  its own work.
- `GET /api/queue/events` — held open, `text/event-stream`, and silent until something changes. Writes a bare
  `changed` event when a job is written or `POST /api/aide-run` reports progress, plus a keep-alive comment every 45
  seconds. The event carries no payload:
  the page answers it by re-fetching `/?rows=1`, which it already knows how to do. Token required like the rest of
  `/api/queue*`, and
  `EventSource` sends the page's cookie for it — it cannot set a header.
- `POST /api/queue/<id>/steps` — edit a RUNNING job's tail:
  `step` plus a `checked` flag adds a phase the run has not reached yet, or removes one it has not started. The running
  step and everything behind it are refused by name, as is any job that is not running — the decision is made against
  the job as it stands when the request arrives, never against what the page believed. This is deliberately NOT
  `POST /api/queue`: that route creates a job, and for a spec with one in flight it answers with the clash refusal.
- `POST /api/queue/create` — project, title and description in; a job that MAKES a spec out, which then lands itself and
  becomes an ordinary row (token required, like the rest of `/api/queue*`)
- `POST /api/queue/projects` — add a project to the allowlist: clone it under the projects root (`gitUrl`) or register a
  checkout already there (`existingPath`), write a minimal `.aide/project.yaml` if it has none, and optionally write
  `AIDE_SPECS_PATH` into its `.aide/config`. Answers per step, in the merge route's shape.
- `POST /api/queue/projects/<name>/remove` — take it off the allowlist and off this dashboard. Requires `confirm` to
  equal the project's name exactly, and never touches the checkout or the specs root.

- `/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`,
  `/icon-512-maskable.svg`, `/apple-touch-icon.png` — what a browser reads before it offers to install the dashboard as
  an app. No token: a manifest fetch that answers 401 is a page no browser offers to install. All five are
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

## Live runs

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

The address in that block is the HTTPS one; the `:8788` address answers on the
serving host itself and nowhere else. A bookmark carrying `?token=` works on the HTTPS address, and a browser signed
in on the old one signs in once more, because the token cookie belongs to the origin it was set on.

The job page (and `/api/aide-runs`) merge the stored runs with claude-usage's `/api/live` (same host — but if
claude-usage there binds one address only, pass it explicitly: `CLAUDE_USAGE=http://<address>:8787 make install-serve`;
fetched lazily and cached 5 s): liveness state, subagent count and cost so far. claude-usage unreachable → rows render
without enrichment and a notice; never an error. Runs are kept in memory (LRU 512) and mirrored to
`~/aide-dashboard/aide-runs.json`
so restarts keep them.
