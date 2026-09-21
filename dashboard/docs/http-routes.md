# The dashboard's HTTP routes

Every path the dashboard's server answers, with its method, whether it reads or acts, what it takes, what it answers and
who it is made for. The feature pages mention the routes beside their own feature; this page is the whole set in one
place, and `test/guards/http-routes-page.test.ts` fails when a route in the source has no row here, or a row here has no
route in the source.

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
(`application/x-www-form-urlencoded`), up to 4,096 bytes (65,536 for `tick`, `save` and `tracking`). A caller that sends
`Accept: application/json` gets JSON: `{ ok: true, … }`, or `{ error }` with 400 (409 for a refused tick or cancel, 404
for an unknown job). Anything else gets a 303 redirect back to the page the press came from. A body over the cap gets 413
`{ error: "payload too large" }`, whatever the route. The wrong method on a known path gets 405
`method not allowed` — except the three redirects `/queue`, `/specs` and `/queue/<rest>`, which answer
the same 302 for every method — and an unknown project or spec gets a plain-text 404 before the route
reads anything. A project that was added, changed or removed answers 400 when any step of that change
failed, rather than 200 with `ok: false`. Where a row says otherwise, the row is right: `POST /api/queue/projects/<project>/test-server`
answers only a redirect or an HTML page, and the spec `update`, `save` and `tracking` routes redirect whatever `Accept`
says, apart from a 400 for a malformed body.

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
| `POST /api/queue`                             | action | JSON or form: project, spec folder, steps          | `{ ok, job }`, or a 303 to the page                                        | interface |
| `GET /api/queue/<id>`                         | read   | nothing                                            | `{ generatedAt, job }`; 404 `{ error }` for an unknown id                  | interface |
| `GET /api/queue/events`                       | read   | optional `?phases=`                                | a held-open `text/event-stream` of queue changes                           | interface |
| `POST /api/queue/<id>/cancel`                 | action | nothing                                            | `{ ok, job }`; 409 for a finished job, unless its landing is still running | form      |
| `POST /api/queue/<id>/steps`                  | action | step and checked, for a running job's tail         | `{ ok, job }`                                                              | form      |
| `POST /api/queue/<id>/model`                  | action | step and model, for a running job's tail           | `{ ok, job }`                                                              | form      |
| `POST /api/queue/create`                      | action | JSON or form: the new spec's title and description | `{ ok, job }`; 400 `{ error }`                                             | interface |
| `POST /api/queue/failed-creates/<id>/dismiss` | action | nothing                                            | `{ ok }`; 404 for an unknown message                                       | form      |

### Specs

Answered by the files under `src/serve/routes/spec-edit/`.

| Route                                                     | Kind   | Takes                                                                  | Answers                                               | Made for  |
|-----------------------------------------------------------|--------|------------------------------------------------------------------------|-------------------------------------------------------|-----------|
| `POST /api/queue/specs/<project>/<spec>/tick`             | action | the rows to tick, unverify or fail, and the phase; up to 65,536 bytes  | a redirect or `{ ok }`; 409 for a refused tick        | form      |
| `POST /api/queue/specs/<project>/<spec>/tracking`         | action | the tracking fields, and optionally a sha to check they have not moved | a redirect; 400 for a malformed body                  | form      |
| `POST /api/queue/specs/<project>/<spec>/update`           | action | nothing; pulls the spec's repository from its remote                   | a redirect back to the spec page, with a notice       | form      |
| `POST /api/queue/specs/<project>/<spec>/save`             | action | which of the four files, its text, and the sha it was read at          | a redirect; 400 for a malformed body                  | form      |
| `POST /api/queue/specs/<project>/<spec>/model`            | action | step and model                                                         | `{ ok }`, or a 303 to the specs list                  | form      |
| `POST /api/queue/specs/<project>/<spec>/close`            | action | a reason                                                               | `{ ok, job }`, or a 303; 400 without a reason         | form      |
| `POST /api/queue/specs/<project>/<spec>/test-server`      | action | nothing                                                                | `{ ok, testServer }`, or a 303 to the spec page       | interface |
| `POST /api/queue/specs/<project>/<spec>/test-server/stop` | action | nothing                                                                | `{ ok }`, or a 303 back to the page it was pressed on | form      |

### Projects and settings

Answered by `src/serve/routes/queue-admin.ts`.

| Route                                                 | Kind   | Takes                               | Answers                                                                                              | Made for |
|-------------------------------------------------------|--------|-------------------------------------|------------------------------------------------------------------------------------------------------|----------|
| `POST /api/queue/settings`                            | action | model and timeout defaults per step | `{ ok }`; 400 `{ error }` for an unknown step or model                                               | form     |
| `POST /api/queue/settings/check`                      | action | tool: the AI tool to check          | the check's result; 400 for a tool it cannot check                                                   | form     |
| `POST /api/queue/projects`                            | action | name, git URL and Code landing      | `{ ok, … }` with the steps taken, or a 303                                                           | form     |
| `POST /api/queue/projects/<project>/settings`         | action | the project's settings              | `{ ok, … }` with the steps taken, or a 303                                                           | form     |
| `POST /api/queue/projects/<project>/deploy`           | action | nothing                             | `{ ok, restarting, installError? }`, or a 303; fast-forwards a checkout and runs the install command | form     |
| `POST /api/queue/projects/<project>/test-server`      | action | nothing                             | a 303 or an HTML page, never JSON                                                                    | form     |
| `POST /api/queue/projects/<project>/test-server/stop` | action | nothing                             | `{ ok }`, or a 303 back to the page it was pressed on                                                | form     |
| `POST /api/queue/projects/<project>/remove`           | action | nothing                             | `{ ok }`, or a 303 to the projects list                                                              | form     |

### Schedule

Answered by `src/serve/routes/schedule-admin-routes.ts`.

| Route                                               | Kind   | Takes                                      | Answers                                                                        | Made for |
|-----------------------------------------------------|--------|--------------------------------------------|--------------------------------------------------------------------------------|----------|
| `GET /api/queue/schedule/cron-next`                 | read   | `?cron=` a cron expression                 | `{ next }`: the next time it fires; 400 for an expression it cannot read       | form     |
| `POST /api/queue/schedule`                          | action | project, name, cron, prompt, model, notify | `{ ok }`, or a 303; 400 for a refused schedule                                 | form     |
| `POST /api/queue/schedule/<project>/<name>`         | action | name, cron, prompt, model, notify          | `{ ok }`, or a 303; 400 for a refused schedule                                 | form     |
| `POST /api/queue/schedule/<project>/<name>/enabled` | action | enabled                                    | `{ ok, enabled }`, or a 303                                                    | form     |
| `POST /api/queue/schedule/<project>/<name>/run`     | action | nothing                                    | `{ ok, job }`, or a 303 to the schedule list                                   | form     |
| `POST /api/queue/schedule/<project>/<name>/delete`  | action | nothing                                    | `{ ok }`, or a 303 to the schedule list; a refusal returns to the confirm page | form     |

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

| Route                 | Kind   | Takes   | Answers                                                                                         | Made for  |
|-----------------------|--------|---------|-------------------------------------------------------------------------------------------------|-----------|
| `GET /api/self-run`   | read   | nothing | JSON: how far the round has come                                                                | interface |
| `POST /api/self-run`  | action | nothing | starts queueing the fixtures: `{ ok, stage }`, or a 303; 409 while one is resetting or queueing | interface |
| `POST /api/self-stop` | action | nothing | a stopped page, then the board exits                                                            | form      |

### Sessions and probes

Answered by `src/serve/core-routes.ts`. These three are the only API routes that do not go through the queue's
dispatcher.

| Route                | Kind   | Takes                              | Answers                                         | Made for  |
|----------------------|--------|------------------------------------|-------------------------------------------------|-----------|
| `POST /api/aide-run` | action | JSON: a session's report of itself | `{ ok, sessionId }`; 400 for a malformed body   | interface |
| `GET /api/aide-runs` | read   | nothing                            | `{ generatedAt, rows }`: the sessions in flight | interface |
| `GET /api/version`   | read   | nothing                            | `{ sha }`: the commit this process is running   | interface |

### Pages

Answered by the files under `src/serve/routes/page-routes/`, `src/serve/routes/spec-edit/` and
`src/serve/routes/spec-pdf.ts`. A page that shows an error or a notice takes it as a query (`?error=`, `?notice=`). Every page route also reads
`?lang=`, and answers with a year-long `set-cookie` when it is set.

| Route                                           | Kind   | Takes                                        | Answers                                                                                                       | Made for |
|-------------------------------------------------|--------|----------------------------------------------|---------------------------------------------------------------------------------------------------------------|----------|
| `GET /`                                         | read   | optional filters in the query, `?rows=`      | the specs list; with `?rows=`, the rows alone                                                                 | page     |
| `GET /new`                                      | read   | optional `?retry=`, `?error=`                | the New spec form                                                                                             | page     |
| `GET /queue`                                    | read   | nothing                                      | 302 to `/`, whatever the method                                                                               | page     |
| `GET /specs`                                    | read   | nothing                                      | 302 to `/`, whatever the method                                                                               | page     |
| `GET /queue/<rest>`                             | read   | nothing                                      | 302 to `/specs/<rest>`, whatever the method                                                                   | page     |
| `GET /specs/<id>`                               | read   | optional `?tab=`, `?only=`, `?step=`         | the job's page                                                                                                | page     |
| `GET /specs/<project>/<spec>`                   | read   | optional `?tab=`, `?only=`, `?step=`         | the spec's page                                                                                               | page     |
| `GET /specs/<project>/<spec>?startTestServer=1` | action | optional `?retryTestServer=1`                | starts a test server for the spec, then a waiting page, a 303 to it, or a page saying why it could not start  | page     |
| `GET /specs/<project>/<spec>/reopen`            | read   | optional `?error=`                           | the confirm page for reopening the spec                                                                       | page     |
| `GET /specs/<project>/<spec>/close`             | read   | optional `?error=`                           | the confirm page for closing the spec                                                                         | page     |
| `GET /specs/<project>/<spec>/pdf`               | read   | nothing                                      | `application/pdf`; 503 without md-to-pdf, 502 when the generator fails; writes a cached file when none exists | page     |
| `GET /settings`                                 | read   | optional `?tab=`, `?error=`                  | the settings page                                                                                             | page     |
| `GET /test-servers`                             | read   | nothing                                      | the running test servers                                                                                      | page     |
| `GET /projects`                                 | read   | optional `?notice=`, `?error=`               | the projects list                                                                                             | page     |
| `GET /projects/new`                             | read   | optional `?error=`                           | the add-project form                                                                                          | page     |
| `GET /projects/<project>`                       | read   | optional `?tab=`, `?edit=1`, `?deployError=` | the project's page                                                                                            | page     |
| `GET /projects/<project>?startTestServer=1`     | read   | nothing                                      | a waiting page, a 303 to the test server or back to the deploy tab, or a page saying why it could not start   | page     |
| `GET /projects/<project>/settings`              | read   | nothing                                      | 302 to the project's page, which carries the form                                                             | page     |
| `GET /projects/<project>/remove`                | read   | optional `?error=`                           | the confirm page for removing the project                                                                     | page     |
| `GET /schedule`                                 | read   | optional `?q=`, `?sort=`, `?dir=`            | the schedule list                                                                                             | page     |
| `GET /schedule/<project>/<name>`                | read   | optional `?tab=`, `?run=`                    | the schedule's page                                                                                           | page     |
| `GET /schedule/<project>/<name>/delete`         | read   | optional `?error=`                           | the confirm page for deleting the schedule                                                                    | page     |
| `GET /schedule-output/<file>`                   | read   | nothing                                      | a file from the schedule output folder                                                                        | page     |

### Files

Answered by `src/serve/core-routes.ts` and `src/serve/serve-helpers/static.ts`. Only `GET` and `HEAD` reach them; any
other method gets 405.

| Route                        | Kind | Takes   | Answers                                             | Made for |
|------------------------------|------|---------|-----------------------------------------------------|----------|
| `GET /spec-editor.js`        | read | nothing | the spec page's editor script; 304 against its ETag | page     |
| `GET /spec-viewer.js`        | read | nothing | the spec page's viewer script; 304 against its ETag | page     |
| `GET /manifest.webmanifest`  | read | nothing | the web app manifest                                | page     |
| `GET /sw.js`                 | read | nothing | the service worker, with `cache-control: no-cache`  | page     |
| `GET /icon-192.png`          | read | nothing | the app icon, 192 px                                | page     |
| `GET /icon-512.png`          | read | nothing | the app icon, 512 px                                | page     |
| `GET /icon-512-maskable.png` | read | nothing | the maskable app icon                               | page     |
| `GET /icon-512.svg`          | read | nothing | the app icon as SVG                                 | page     |
| `GET /icon-512-maskable.svg` | read | nothing | the maskable app icon as SVG                        | page     |
| `GET /apple-touch-icon.png`  | read | nothing | the icon iOS puts on a home screen                  | page     |
| `GET /<file>`                | read | nothing | any other file in the generated site, or 404        | page     |

`GET /<file>` is the fallback: it has no path in the source, since `serveStatic` in `src/serve/core-routes.ts` answers
whatever no other route claimed. It is the one row the test does not look for a handler for.
