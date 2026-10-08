# The dashboard's HTTP routes

## Table of contents

- [How to read this page](#how-to-read-this-page)
- [Reads and actions share a prefix](#reads-and-actions-share-a-prefix)
- [Adding a route](#adding-a-route)
- [The routes](#the-routes)
  - [Jobs and the board](#jobs-and-the-board)
  - [Specs](#specs)
  - [Projects and settings](#projects-and-settings)
  - [Schedule](#schedule)
  - [Push](#push)
  - [A test server only](#a-test-server-only)
  - [Sessions and probes](#sessions-and-probes)
  - [Pages](#pages)
  - [Files](#files)

---

Every path the dashboard's server answers, with its method, whether it reads or acts, what it takes, what it answers and
who it is made for. The feature pages mention the routes beside their own feature; this page is the whole set in one
place, and `test/guards/http-routes-page.test.ts` fails when a route in the source has no row here, or a row here has no
route in the source.


## How to read this page

A route is a method and a path shape, so `GET /api/queue` and `POST /api/queue` are two rows. In a path, `<id>` is a
job's id, `<project>` a project's name, `<spec>` a spec's folder and `<name>` a schedule's name. A row can end in a query
string where the query changes the row's own Kind: `?startTestServer=1` starts something, so it has a row
of its own beside the plain `GET`. A query that only changes what comes back — `?rows=`, `?tab=` — stays
in the Takes column of the one row.

| Column   | Says                                                                                                                                     |
|----------|------------------------------------------------------------------------------------------------------------------------------------------|
| Route    | The method and the path.                                                                                                                 |
| Kind     | `read` changes nothing a later request can see. `action` changes something: a job, a file in a repository, a setting, a running process. |
| Takes    | What the request has to carry: a body, a query, or nothing.                                                                              |
| Answers  | What comes back.                                                                                                                         |
| Made for | Who the route is meant for, as `page`, `form` or `interface`.                                                                            |

**Made for** says what a route is meant for, not who has called it. `page` is an HTML page or a file a browser loads.
`form` is a control the dashboard's own pages draw, as a form or through their script, meant for nothing else.
`interface` is meant to be called by something other than those pages: a script, a hook, another machine. The callers
the repository shows are the evidence: `aide-emit-run` posts to `/api/aide-run`, the round script and
`scripts/test-linux-install` use `/api/queue`, and a browser tab can hold `/api/queue/events` open. That is what the
repository shows, not a census of every caller.

**How an action answers.** Almost every `POST` reads its body as JSON or as a form
(`application/x-www-form-urlencoded`), up to 4,096 bytes (65,536 for `tick`, `save` and `tracking`), and answers JSON,
whatever `Accept` says: `{ ok: true, … }`, or `{ error }` with 400 (409 for a refused tick or cancel, and for a save or
tracking refused while another job for the spec runs; 404 for an unknown job). The page script reads that answer and
writes a refusal into the page; no answer carries a message in an address. A body over the cap gets 413
`{ error: "payload too large" }`, whatever the route. The wrong method on a known path gets 405
`method not allowed` — except the two redirects `/queue` and `/queue/<rest>`, which answer
the same 302 for every method — and an unknown project or spec gets a plain-text 404 before the route
reads anything. A project that was added, changed or removed answers 400 when any step of that change
failed, rather than 200 with `ok: false`. Two presses are navigations and answer a page:
`POST /api/queue/projects/<project>/test-server` answers a redirect to the waiting page or an HTML page, and
`POST /api/self-stop` answers the stopped page.

A row's wording can go stale while its path stays real: the test checks that a route and a row exist, not what the row
says. It does check the row's shape — every row must fill Takes, Answers and Made for, Made for must be one of the three
words, and a `POST` row must be an `action`. `HEAD` gets no rows: the static files answer it, and their `GET` rows stand
for both. Each family below names the source file that answers it.

---

## Reads and actions share a prefix

Under `/api/queue` a read and an action share the same path, and the HTTP method alone tells them apart:
`GET /api/queue` returns the queue, and `POST /api/queue` puts a step on it. Everything under `/api/queue/` follows the
same split: a `GET` there reads, a `POST` acts. A caller that may read the queue may, as far as the server can tell,
also act on it.

Who is let in is one rule for every request, the three routes outside `/api/queue` included, and it is written down
once: "Which requests the dashboard answers" in [running-specs.md](running-specs.md#which-requests-the-dashboard-answers)
has the `Host` allowlist, the `Origin` and `Sec-Fetch-Site` check, and why a request carrying neither header passes.
Nothing in that rule tells a reading caller from an acting one. The dashboard asks for no sign-in, so a caller admitted
to `GET /api/queue` is admitted to `POST /api/queue` as well.

---

## Adding a route

**A path reaches a handler through one `??`-chain.** `handleRoutes()` in `src/serve/routes/index.ts` tries each themed
route file in turn, and each returns `null` for a path that is not its own. A new route is a new check inside one of
those files, and the file it belongs in is the one this page names for its family.

**The order of that chain is load-bearing.** Several routes work only because a more specific one is tried first —
`job-detail.ts` matches a single path segment as a job id, and would swallow `/api/queue/create` if it came earlier.
A new route goes in without reordering the chain; moving a file up or down it means re-checking every regex above and
below for overlap.

**The request guard covers a new route already, with one exception.** `checkRequest`
(`src/serve/serve-helpers/request-guard.ts`) runs in front of every route, so a new `POST` is behind it the moment it
exists. A new `GET` that changes something is not: `changesSomething()` in that file decides which requests need the
`Origin` check, and it asks for a method other than `GET`, `HEAD` and `OPTIONS`, or the literal query
`startTestServer=1`. A second `GET` that changes something has to be named there by hand, or any web page can trigger
it. Nothing about a `read` in the new route's row will say so.

Two `GET`s are not plain reads, and the Origin check counts both as requests that change something:

- `GET /specs/<project>/<spec>?startTestServer=1` starts a test server for the spec, and has its own row, marked `action`.
- `GET /specs/<project>/<spec>/pdf` spawns the generator and writes a PDF into a cache directory outside every
  checkout when none is cached for that commit. The next request for that commit answers the same PDF, so nothing a
  later request can see has changed and its row says `read`.

`GET /projects/<project>?startTestServer=1` is the third: it starts nothing, and only waits for the test server a
`POST /api/queue/projects/<project>/test-server` started, so its row says `read`.

**Three reads keep the test-server register honest.** `GET /test-servers`, `GET /projects/<project>?startTestServer=1`
and the spec page each ask every registered test server whether it is still there, and drop the entry when its process
is gone (`refreshTestServerStatus`, `src/serve/test-servers/lifecycle.ts`). That deletes a registry entry and frees its
work directory, so a `read` here can change what the next request sees about a server that had already died. It never
stops one that is running.

---

## The routes

### Jobs and the board

Answered by `src/serve/routes/job-actions.ts`, `src/serve/routes/job-detail.ts`, `src/serve/routes/sse.ts` and
`src/serve/routes/failed-create-routes.ts`. `POST /api/queue/create` is the exception: it is answered by
`src/serve/routes/queue-admin.ts`, beside the project and settings routes.

| Route                                         | Kind   | Takes                                              | Answers                                                                    | Made for  |
|-----------------------------------------------|--------|----------------------------------------------------|----------------------------------------------------------------------------|-----------|
| `GET /api/queue`                              | read   | nothing                                            | `{ generatedAt, jobs }`                                                    | interface |
| `POST /api/queue`                             | action | JSON or form: project, spec folder, steps          | `{ ok, job }`; 400 `{ error, spec? }`                                      | interface |
| `GET /api/queue/<id>`                         | read   | optional `?marks=1`                                | `{ generatedAt, job }`, with `marks` and `reason` if asked; 404 if unknown | interface |
| `GET /api/queue/events`                       | read   | optional `?phases=`                                | a held-open `text/event-stream` of queue changes                           | interface |
| `POST /api/queue/<id>/cancel`                 | action | nothing                                            | `{ ok, job }`; 409 for a finished job, unless its landing is still running | form      |
| `POST /api/queue/<id>/steps`                  | action | step and checked, for a running job's tail         | `{ ok, job }`                                                              | form      |
| `POST /api/queue/<id>/model`                  | action | step and model, for a running job's tail           | `{ ok, job }`                                                              | form      |
| `POST /api/queue/create`                      | action | JSON or form: the new spec's title and description | `{ ok, job }`; 400 `{ error }`                                             | interface |
| `POST /api/queue/failed-creates/<id>/dismiss` | action | nothing                                            | `{ ok }`; 404 for an unknown message                                       | form      |

### Specs

Answered by the files under `src/serve/routes/spec-edit/`.

| Route                                                     | Kind   | Takes                                                                  | Answers                                         | Made for  |
|-----------------------------------------------------------|--------|------------------------------------------------------------------------|-------------------------------------------------|-----------|
| `POST /api/queue/specs/<project>/<spec>/tick`             | action | the rows to tick, unverify or fail, and the phase; up to 65,536 bytes  | `{ ok, note, changed }`; 409 for a refused tick | form      |
| `POST /api/queue/specs/<project>/<spec>/approach`         | action | the approach chosen, by its letter                                     | `{ ok, note, changed }`; 409 `{ error, spec }`  | form      |
| `POST /api/queue/specs/<project>/<spec>/tracking`         | action | the tracking fields, and optionally a sha to check they have not moved | `{ ok, note, changed }`; 400 `{ error }`        | form      |
| `POST /api/queue/specs/<project>/<spec>/update`           | action | nothing; pulls the spec's repository from its remote                   | `{ ok, note, changed }`; 400 `{ error }`        | form      |
| `POST /api/queue/specs/<project>/<spec>/save`             | action | which of the four files, its text, and the sha it was read at          | `{ ok, note, changed }`; 400 `{ error }`        | form      |
| `POST /api/queue/specs/<project>/<spec>/model`            | action | step and model                                                         | `{ ok }`; 400 `{ error, spec }`                 | form      |
| `POST /api/queue/specs/<project>/<spec>/close`            | action | a reason                                                               | `{ ok, job }`; 400 without a reason             | form      |
| `POST /api/queue/specs/<project>/<spec>/delete-branch`    | action | nothing; deletes an archived spec's merged branch on origin            | `{ ok }`; 400 if refused                        | form      |
| `POST /api/queue/specs/<project>/<spec>/test-server`      | action | nothing                                                                | `{ ok, testServer }`; 400 `{ error, spec }`     | interface |
| `POST /api/queue/specs/<project>/<spec>/test-server/stop` | action | nothing                                                                | `{ ok }`                                        | form      |

`tracking` also queues a job in one case: the spec's newest job stopped `shared-files`, and the saved Depends on names a
spec that stop named. The route then queues Analyze with the stopped job's remaining steps, on its models and effort,
and answers 400 `{ error }` with `Depends on was saved, but analyze could not be queued: …` when the queue refuses it.

### Projects and settings

Answered by `src/serve/routes/queue-admin.ts`, except `settings/concurrency`, which
`src/serve/routes/settings-concurrency.ts` answers, the two `settings/models/<add|remove>` rows, which
`src/serve/routes/settings-models.ts` answers, and the four `deploy/<step>` rows and the `drift` row, which
`src/serve/routes/deploy-steps.ts` answers. The page script posts the four steps one after the other, and `drift` once
when the Deploy tab is opened.

| Route                                                 | Kind   | Takes                                                         | Answers                                                                                                                            | Made for |
|-------------------------------------------------------|--------|---------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|----------|
| `POST /api/queue/settings`                            | action | model and timeout defaults per step                           | `{ ok }`; 400 `{ error }` for an unknown step or model                                                                             | form     |
| `POST /api/queue/settings/check`                      | action | tool: the AI tool; part: models, subscription or installation | `{ ok, models }`, `{ ok, usage }` or `{ ok, check }`: the one part read; 400 for a tool it cannot check or a part it does not know | form     |
| `POST /api/queue/settings/concurrency`                | action | concurrency: a whole number, 1 to 8                           | `{ ok, concurrency }`; 400 `{ error }` for a number outside 1 to 8 or a server with no queue                                       | form     |
| `POST /api/queue/settings/models/add`                 | action | tool and model                                                | `{ ok, name }`: the new choice's name; 400 `{ error }` for a model the last Models Check did not read among those offered          | form     |
| `POST /api/queue/settings/models/remove`              | action | name: a model choice                                          | `{ ok, name }`; 400 `{ error }` for no such choice, or one that is a step's default model                                          | form     |
| `POST /api/queue/projects`                            | action | name, git URL, Code landing and Try a branch                  | `{ ok, project, results, readiness? }`: the steps taken; 400 when one failed                                                       | form     |
| `POST /api/queue/projects/<project>/settings`         | action | the project's settings                                        | `{ ok, project, results, readiness? }`: the steps taken; 400 when one failed                                                       | form     |
| `POST /api/queue/projects/<project>/deploy/fetch`     | action | nothing                                                       | `{ ok }`; 400 `{ error }` for a refusal; fast-forwards the checkout                                                                | form     |
| `POST /api/queue/projects/<project>/deploy/install`   | action | nothing                                                       | `{ ok }`; 400 `{ error, faulty? }` when the install fails; then a fresh count against origin                                       | form     |
| `POST /api/queue/projects/<project>/deploy/restart`   | action | nothing                                                       | `{ ok, restart, startedAt?, faulty? }`: `restart` is `fired`, `held` or `none`                                                     | form     |
| `POST /api/queue/projects/<project>/deploy/check`     | action | nothing                                                       | `{ ok }`; 400 `{ error, faulty }` when the service runs another commit than the checkout                                           | form     |
| `POST /api/queue/projects/<project>/drift`            | action | nothing                                                       | `{ ok, behind }` after a fresh count; 400 `{ error }` when it cannot count; reads only                                             | form     |
| `POST /api/queue/projects/<project>/wiki`             | action | nothing                                                       | `{ ok, job }`; 400 `{ error }` for a refusal                                                                                       | form     |
| `POST /api/queue/projects/<project>/test-server`      | action | nothing                                                       | a 303 or an HTML page, never JSON                                                                                                  | form     |
| `POST /api/queue/projects/<project>/test-server/stop` | action | nothing                                                       | `{ ok }`                                                                                                                           | form     |
| `POST /api/queue/projects/<project>/remove`           | action | nothing                                                       | `{ ok, project, results }`: the steps taken; 400 when one failed                                                                   | form     |

### Schedule

Answered by `src/serve/routes/schedule-admin-routes.ts`.

| Route                                               | Kind   | Takes                                            | Answers                                                                    | Made for |
|-----------------------------------------------------|--------|--------------------------------------------------|----------------------------------------------------------------------------|----------|
| `GET /api/queue/schedule/cron-next`                 | read   | `?cron=` a cron expression                       | `{ next }`: the next time it fires; 400 for an expression it cannot read   | form     |
| `POST /api/queue/schedule`                          | action | project, name, cron, prompt, model, notify, back | `{ ok, location }`: `back`, or the project's Schedule tab; 400 `{ error }` | form     |
| `POST /api/queue/schedule/<project>/<name>`         | action | name, cron, prompt, model, notify, back          | `{ ok, location }`: `back`, or the project's Schedule tab; 400 `{ error }` | form     |
| `POST /api/queue/schedule/<project>/<name>/enabled` | action | enabled                                          | `{ ok, enabled }`; 400 `{ error }`                                         | form     |
| `POST /api/queue/schedule/<project>/<name>/run`     | action | nothing                                          | `{ ok, job }`; 400 `{ error }`                                             | form     |
| `POST /api/queue/schedule/<project>/<name>/delete`  | action | nothing                                          | `{ ok }`; 400 `{ error }`                                                  | form     |

### Push

Answered by `src/serve/routes/push-routes.ts`.

| Route                        | Kind   | Takes                                              | Answers                                            | Made for |
|------------------------------|--------|----------------------------------------------------|----------------------------------------------------|----------|
| `POST /api/push/subscribe`   | action | JSON: a browser's push subscription, at most 8 KiB | `{ ok }`; 400 for a malformed body, 413 over 8 KiB | form     |
| `POST /api/push/unsubscribe` | action | JSON: the subscription to drop, at most 8 KiB      | `{ ok }`; 400 for a malformed body, 413 over 8 KiB | form     |

### A test server only

Answered by `src/serve/routes/self-stop.ts` and `src/serve/routes/self-run.ts`. On an ordinary server both answer 404
`not a test board`. On a test server started from a spec's branch, `POST /api/self-run` answers 404 once the round
script's own seeding press has been made — which is the whole life of such a server, since the stage never returns to
idle after it.

| Route                 | Kind   | Takes   | Answers                                                                               | Made for  |
|-----------------------|--------|---------|---------------------------------------------------------------------------------------|-----------|
| `GET /api/self-run`   | read   | nothing | JSON: how far the round has come                                                      | interface |
| `POST /api/self-run`  | action | nothing | starts queueing the fixtures: `{ ok, stage }`; 409 while one is resetting or queueing | interface |
| `POST /api/self-stop` | action | nothing | a stopped page, then the board exits                                                  | form      |

### Sessions and probes

Answered by `src/serve/core-routes.ts`. These three are the only API routes that do not go through the queue's
dispatcher.

| Route                | Kind   | Takes                              | Answers                                                                | Made for  |
|----------------------|--------|------------------------------------|------------------------------------------------------------------------|-----------|
| `POST /api/aide-run` | action | JSON: a session's report of itself | `{ ok, sessionId }`; 400 for a malformed body                          | interface |
| `GET /api/aide-runs` | read   | nothing                            | `{ generatedAt, rows }`: the sessions in flight                        | interface |
| `GET /api/version`   | read   | nothing                            | `{ sha, startedAt }`: the commit this process runs, and when it booted | interface |

### Pages

Answered by the files under `src/serve/routes/page-routes/`, `src/serve/routes/spec-edit/` and
`src/serve/routes/spec-pdf.ts`. No page takes a message from its query: a refusal or a notice is written in by the page
script, from the answer to the press that made it. Every page route also reads
`?lang=`, and answers with a year-long `set-cookie` when it is set.

| Route                                           | Kind   | Takes                                                  | Answers                                                                                                                                                                                                  | Made for |
|-------------------------------------------------|--------|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| `GET /`                                         | read   | optional `?open=`, `?checks=`, `?phases=`, `?rows=`    | the Jobs page; with `?rows=1`, the rows alone; with `?only=` too, one spec's rows. A Specs list key in the query (`state`, `project`, `sort`, `dir`, `q`) gives 302 to `/specs`                          | page     |
| `GET /new`                                      | read   | optional `?retry=`, `?tab=`                            | the New spec form                                                                                                                                                                                        | page     |
| `GET /queue`                                    | read   | nothing                                                | 302 to `/specs`, whatever the method                                                                                                                                                                     | page     |
| `GET /specs`                                    | read   | optional filters in the query, `?rows=`                | the specs list; with `?rows=`, the rows alone; with `?only=` too, one spec's rows                                                                                                                        | page     |
| `GET /queue/<rest>`                             | read   | nothing                                                | 302 to `/specs/<rest>`, whatever the method                                                                                                                                                              | page     |
| `GET /jobs/<id>`                                | read   | optional `?tab=`, `?step=`, `?steptab=`, `?follow=1`   | the job's page; with `?follow=1`, its banner and steps table alone, and the follow marker while the job is in flight                                                                                     | page     |
| `GET /specs/<id>`                               | read   | the same as `/jobs/<id>`                               | a 301 to `/jobs/<id>` with the same query string                                                                                                                                                         | page     |
| `GET /specs/<project>/<spec>`                   | read   | optional `?tab=`, `?step=`, `?steptab=`, `?follow=1`   | the spec's page; with `?follow=1`, the Steps tab's running badge and steps table alone, and the follow marker while the lead job is in flight                                                            | page     |
| `GET /specs/<project>/<spec>?startTestServer=1` | action | optional `?retryTestServer=1`                          | starts a test server for the spec, then a waiting page, a 303 to it, or a page saying why it could not start                                                                                             | page     |
| `GET /specs/<project>/<spec>/pdf`               | read   | nothing                                                | `application/pdf`; 503 without md-to-pdf, 502 when the generator fails; writes a cached file when none exists                                                                                            | page     |
| `GET /settings`                                 | read   | optional `?tab=` and `?aitab=`                         | the settings page; `?tab=` takes `ai`, `process`, `notifications`, `phases` or an AI's key, else opens AI; on an AI's tab, `?aitab=` takes `models`, `subscription` or `installation`, else opens Models | page     |
| `GET /test-servers`                             | read   | nothing                                                | the running test servers                                                                                                                                                                                 | page     |
| `GET /projects`                                 | read   | nothing                                                | the projects list                                                                                                                                                                                        | page     |
| `GET /projects/new`                             | read   | nothing                                                | the add-project form                                                                                                                                                                                     | page     |
| `GET /projects/<project>`                       | read   | optional `?tab=`, `?edit=`, `?page=`                   | the project's page; with `?tab=wiki`, the wiki's pages, or the one `?page=` names                                                                                                                        | page     |
| `GET /projects/<project>?startTestServer=1`     | read   | nothing                                                | a waiting page, a 303 to the test server or back to the deploy tab, or a page saying why it could not start                                                                                              | page     |
| `GET /projects/<project>/settings`              | read   | nothing                                                | 302 to the project's Config tab, which carries the form                                                                                                                                                  | page     |
| `GET /schedule`                                 | read   | optional `?q=`, `?sort=`, `?dir=`                      | the schedule list                                                                                                                                                                                        | page     |
| `GET /schedule/<project>/<name>`                | read   | optional `?tab=`, `?run=`, `?sort=`, `?dir=`, `?edit=` | the schedule's page; with `?tab=settings&edit=1`, its Settings tab as a form                                                                                                                             | page     |
| `GET /schedule/new`                             | read   | `?project=`                                            | the page that makes a schedule entry                                                                                                                                                                     | page     |
| `GET /schedule-output/<file>`                   | read   | nothing                                                | a file from the schedule output folder                                                                                                                                                                   | page     |

### Files

Answered by `src/serve/core-routes.ts` and `src/serve/serve-helpers/static.ts`. Only `GET` and `HEAD` reach them; any
other method gets 405.

| Route                        | Kind | Takes   | Answers                                                                           | Made for |
|------------------------------|------|---------|-----------------------------------------------------------------------------------|----------|
| `GET /spec-editor.js`        | read | nothing | the spec page's editor script; 304 against its ETag                               | page     |
| `GET /spec-viewer.js`        | read | nothing | the viewer script of the spec page and of an open wiki page; 304 against its ETag | page     |
| `GET /manifest.webmanifest`  | read | nothing | the web app manifest                                                              | page     |
| `GET /sw.js`                 | read | nothing | the service worker, with `cache-control: no-cache`                                | page     |
| `GET /icon-192.png`          | read | nothing | the app icon, 192 px                                                              | page     |
| `GET /icon-512.png`          | read | nothing | the app icon, 512 px                                                              | page     |
| `GET /icon-512-maskable.png` | read | nothing | the maskable app icon                                                             | page     |
| `GET /icon-512.svg`          | read | nothing | the app icon as SVG                                                               | page     |
| `GET /icon-512-maskable.svg` | read | nothing | the maskable app icon as SVG                                                      | page     |
| `GET /apple-touch-icon.png`  | read | nothing | the icon iOS puts on a home screen                                                | page     |
| `GET /badge-96.png`          | read | nothing | the notification badge: the mark on transparency                                  | page     |
| `GET /projects.html`         | read | nothing | 302 to `/projects`, keeping the query string                                      | page     |
| `GET /<file>`                | read | nothing | 404 — nothing else answers a path this route reaches                              | page     |

`GET /<file>` is the fallback: it has no path in the source, since `handleCore` in `src/serve/core-routes.ts` ends in
a plain 404 once every other check above has declined. It is the one row the test does not look for a handler for.
