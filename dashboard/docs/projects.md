# Projects

How a project is added to the dashboard, what decides whether a run can start there, and what its own page shows. The
queue that runs its specs is on [Running specs](running-specs.md).

## Table of contents

- [Adding and removing a project](#adding-and-removing-a-project)
    - [Whether a run can start there](#whether-a-run-can-start-there)
    - [What Add finishes itself](#what-add-finishes-itself)
    - [A page render never waits on the network](#a-page-render-never-waits-on-the-network)
- [A project's own page](#a-projects-own-page)
    - [Config](#config)
    - [Deploy](#deploy)
    - [Schedule](#schedule)
- [How a project's code lands](#how-a-projects-code-lands)

---

## Adding and removing a project

`/projects` lists every project the dashboard knows, with an **Add** button above the list and a **Remove** link on
each row. Add opens a page of its own; both are held to the same-origin rule, like every other control that changes
something.

**The projects root is where they all live** — the directory the server was started with as `--root`. A project is
a directory under it, and the list is what the dashboard finds there. Adding one also puts its name on the queue's
allowlist, which is what a run checks before it starts; removing one takes the name off again.

The Add form asks for:

| Field           | What it takes                                                                                                                             |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Name            | The directory's name under the projects root. Picked from the checkouts already there, or typed to name the directory a clone will create |
| Git URL or path | A URL to clone, or a path to a checkout already on disk                                                                                   |
| Specs root      | Where this project's specs live, when they are not in `specs/` inside it                                                                  |
| Worktree links  | Space-separated repo-relative paths a run has to symlink into its worktree                                                                |
| Code landing    | Merge the code, or leave it as a pull request                                                                                             |
| --------------  | -----------------------------------------------                                                                                           |

A clone lands in `<projects root>/<name>` — or, when the projects root is the directory of links beside the
dashboard's own checkouts, in `~/.aide/dashboard/checkouts/<name>/code`, with a link to it at
`<projects root>/<name>`.

**A project that does not already track a manifest keeps nothing of Aide's in its repository.** What Add would have
written into the checkout — the name, the description, worktree links, code landing — goes to the dashboard's own
settings file, `~/.aide/dashboard/checkouts/<name>/settings.yaml`, in the manifest's own format. A manifest the checkout already tracks is the team's and
is never written to; Add says so in its manifest step and writes nothing for the links and the landing. An untracked
`.aide/project.yaml` in the checkout (a draft from `/aide-manifest`) is left as it is and seeds the settings file, so what
it said is not lost. Filling in the rest is `/aide-manifest`'s job afterwards, and the form says so.

**Two homes for a project's manifest keys, one winner.** "Tracked" means `git ls-files --error-unmatch
.aide/project.yaml` in the checkout answers yes (exit 0); exit 1 is not tracked, and any other answer means git cannot
say, so nothing is written, committed or overwritten for a manifest key and the save names why. A tracked manifest
wins as a whole file: the settings file is then read by nothing, and the project's page says so. Without a tracked
manifest the settings file is the manifest. A Settings save commits and pushes only where the manifest is tracked;
otherwise it writes the settings file and waits for a fresh `ensureDashboardCheckout` to carry it.

**How the settings reach a run.** `ensureDashboardCheckout` writes the settings file as an ignored
`.aide/project.yaml` in the dashboard's own clone (listed in that clone's `.git/info/exclude` before any
fast-forward, so the day the team commits a manifest the pull overwrites the copy instead of refusing). `aide-run-spec`
copies it from the main checkout into a step's worktree and keeps it out of the commit and out of `aide_tree_hash`;
the landing's test gate copies it into its tree, and reads the worktree links from there. Every reader of
`<dir>/.aide/project.yaml` — TypeScript and bash — therefore finds it unchanged. Discovery and the project page read a
project's manifest from the clone when the project's own directory holds none.

Remove takes the project off the allowlist and off this dashboard, and that is all it does: the checkout and the
specs root stay on disk, untouched. `/projects/<name>/remove` asks the question in a sentence and the press is the
answer; nothing is typed back.

A server started without `--root` has no projects root to list or add to. Its `GET /projects` redirects to the
generated `projects.html` instead of rendering an empty listing, and its nav goes on naming that file — an empty
page would read as "no projects on this machine" rather than "this server was never told where they are". That
generated file is a redirect to the served page and carries no controls of its own; the only other generated page
is `about.html`. There is no generated page per project: the served `/projects/<name>` is the only one, because a
frozen copy beside it was a second page with the same name, one tab away from the live one and always a little out
of date.

### Whether a run can start there

An Add that answers "added" and nothing else leaves the things that decide whether `aide-run-spec` will START
invisible until Run is pressed and the run refuses. A project can be on the allowlist, cloned where the
form said and carrying a minimal manifest, and still be unable to run: a feature branch whose upstream is gone, no
specs root named, no worktree links set.

So the answer says two things, and keeps them apart. `ok` means the registration completed. `readiness.canRun` means
a run would start. Only the first is commonly true of a fresh add, and folding them into one would report a checkout
that IS on disk as an add to try again.

The form asks for one thing beyond the registration: **Worktree links**, the space-separated repo-relative paths a run has
to symlink into its worktree because git does not carry them (`node_modules`, `.venv`). A run works in a `git worktree`,
which checks out TRACKED files only, so a project whose test command lives behind a gitignored path fails in every run
for a reason that has nothing to do with its change. Nothing can derive which paths those are, so the form asks; leaving
it empty is normal and is reported as a note rather than a fault.

Most of these checks are `aide-run-spec`'s own prerequisites, read-only, taken after the Add has written its files —
the `.aide` written a second earlier is part of what the runner will see. Three rows are this dashboard's own, and `aide-run-spec` refuses on none of
them: `gitRoot`'s "inside a bigger repository" case, `specsRepo`, and `dashboardCheckout` — which blocks nothing at
all, and is left out of the table below because all it reports is whether the run will use a checkout the dashboard
owns rather than the project's own directory. The asymmetry is recorded in
`tests/fixtures/project-readiness-prerequisites.json`'s own comment rather than pinned against the runner.

| Check           | Blocks a run when                                                                                                                                                     |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository at all — or, in this dashboard check only, is inside a bigger one (`aide-run-spec` does not refuse that second case)           |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory                                                                        |
| `specsRepo`     | (dashboard only) that specs root is in no git repository — `aide-run-spec` silently leaves such a root out of what it commits, rather than refusing                   |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out                                                                      |
| `worktreeLinks` | a configured entry leaves the repository, names a path that is not there, or names a build directory (`build`, `dist`, `.gradle`, `target`), which is refused by name |

`worktreeLinks` is read from the project's `.aide/project.yaml` (the committed one, else the dashboard's derived copy)
first and from `.aide/config`'s older `AIDE_WORKTREE_LINKS` second — the same order, and the same winner, as
`aide-run-spec` itself reads them in.
`tests/fixtures/worktree-links-precedence.json` is the one table both sides are tested against, because the two are
written independently and nothing else would stop them drifting.

`tests/fixtures/project-readiness-prerequisites.json` is the equivalent table for `gitRoot`, `specsRoot`,
`defaultBranch` and `worktreeLinks` themselves: a test on each side reads it and asserts `aide-run-spec` really
refuses what this page says it does, for the same identifier and the same blocking answer.

A `defaultBranch` blocked by another worktree is the one a reader meets by accident: `git worktree list` in the
checkout names the directory holding it, and `git worktree remove <dir>` releases it.

`defaultBranch` is asked of **every** repository a run touches — the project's, and the specs repo when the specs live
elsewhere — because the runner refuses on it in any of them. A checkout on a feature branch is reported and does not
block: the runner puts the checkout on its default branch itself.

There is no `clean` check: a run reads origin's default branch into a worktree of its
own, so what somebody left uncommitted in the main checkout reaches nothing, and the runner does not refuse over it
either.

Nothing in the assessment mutates anything: no branch is switched, no directory made, no file committed. That is also
why the answer can go stale. A default branch resolvable when the project was added is one somebody can delete or park a
second worktree on a minute later, and Run says so at the time — this is a preflight check, not a promise.

An Add's result is shown where Save was pressed. With script it goes into the form's own slot and the page stays
put, because the Specs root and Worktree links fields are usually what fixes it and saving again re-assesses.
Without script the redirect carries the same sentence to `/projects` in the query string, where the page renders
it. The sentence is built once, on the server, so the two modes cannot drift apart. A Settings save is the gap: a successful one shows no readiness line at
all. Its redirect carries the sentence to `/projects/<name>`, which reads only an error from the query string, so
the sentence is dropped. Reload the project page to see where the save left things.

### What Add finishes itself

Add does itself what a run would otherwise refuse over a minute later.

**The name is the directory's, not the typed one.** A project is discovered as a directory under the projects root,
and its name is read off that entry and out of no manifest — so a project registered under a name that differs
could never be found again. Where a pick and a typed name disagree, the pick wins, and the Name field then only
names the directory a **clone** would create. A path typed by hand instead of picked is taken as given, and an add
whose typed name and typed path disagree is refused.

**A specs root that is not there is made.** Writing the path into `.aide/config` and then reporting the project as
unable to run over a directory that is not there is a refusal over a path known the moment it was written. Add
creates it, with the `archive/` beside it that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the real state either way.

**Nothing is appended to `.git/info/exclude` of a checkout a person edits.** Add writes nothing into it, so there
is nothing to get out of git afterwards. Keeping `.aide/config` untracked is the reader's own job, once per
machine: a personal global gitignore (`core.excludesFile`) covers it in every project without touching any
project's own `.gitignore`. The dashboard's own clone, which nobody edits, lists its derived `.aide/project.yaml`
in that clone's `.git/info/exclude`.

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

**And both fields are PROPOSED where they can be worked out.** A checkout's own lockfile says which package
manager owns its dependency tree, and each of those puts that tree in one well-known gitignored directory: `bun.lock`/
`package.json` proposes `node_modules`,
`pyproject.toml`/`requirements.txt` proposes `.venv`, both propose both. The Specs root is proposed from how the
projects already added lay theirs out — at least two sharing a `<parent>/<projectName>` pattern proposes
`<parent>/<newName>`, and fewer than two is an example rather than a pattern. Anything that cannot be worked out is left
blank, never guessed. With exactly one checkout on offer the answer is unambiguous and goes straight into the fields, so
a browser with no script gets the help too; with several, the proposals ride on the form and the pick fills them in.

### A page render never waits on the network

`assessProjectReadiness` only ever touches disk — `rev-parse`, `show-ref`, `symbolic-ref`, `worktree list`,
`remote get-url` — and so
does everything else on the request path. The commits-behind-origin count on a project's own Deploy tab needs a real
`git fetch origin`, and that fetch runs off the request path: `refreshDrift()` walks the configured projects on an
`.unref()`'d `setInterval`, the same shape as the runner's own tick and the SSE keep-alive ping, cleared in `stop()`
beside them. The handler calls the synchronous `peekDrift()`, which reads the cache and never spawns git. A project
the poll has never reached yet returns `checkedAt: null`, and the Deploy tab says the check has not been made yet —
a labelled stale number, never a page that blocks on GitHub being reachable.

## A project's own page

`/projects/<name>` has three tabs — **Config**, **Deploy** and **Schedule** — chosen with `?tab=` and defaulting to
Config, which is also where an unrecognised value lands.

### Config

Four things, in this order.

A line saying the checkout has no `.aide/config`, when it has none: "no file" and "a file setting nothing" are
different states, and the first is what a project cloned onto a second machine is in.

**The readiness verdict**, one line: a run can start here, or it cannot. It is absent entirely when git could not be
asked, and it is recomputed on every visit rather than shown once in a notice that is gone by the next page.

**The checkout itself** — the readiness checks the page cannot act on: `gitRoot`, `specsRepo`, `defaultBranch` and
`dashboardCheckout`. They are fixed on the machine, not on this page, and the section says so. The two checks a
settings row owns, `specsRoot` and `worktreeLinks`, are left out here and carried inline on their own rows instead.

**The settings table**, with a sentence above it saying where this project's settings live: in the dashboard's own
file, in the project's tracked manifest, in both — where the tracked manifest wins and the dashboard's copy is not
used — or nowhere yet. The table has a row per recognized `.aide/config` key, each marked configured, worked out
(naming the lockfile that decided it, hedged as a default rather than a verified command) or not set, plus a **Code
landing** row, which is not a config key. A row whose readiness check failed carries that check's sentence inline.

The test command is the one worth knowing: a run and a landing test with a configured command only
(`aide-resolve-test-cmd`), so an unset one reads "not set — no tests run when a spec lands", with the worked-out
command beside it as a suggestion.

**Edit** (`?edit=1`) turns the same table into a form — there is only ever one table on the page, in either mode.
Six controls open: Specs root, Worktree links, Install command, Preview command, Test command and Code landing.
Lint and build stay read-only, since nothing a run does reads them. The test field is empty with the worked-out
command as its placeholder, so a save that never touched it configures nothing. Worktree links carries a
`<datalist>` of the checkout's own top-level `.gitignore` entries. Save and Cancel both return to
`/projects/<name>`, and `/projects/<name>/settings` redirects there too.

Where each value is written is not one rule but two. Specs root and Install command go to `.aide/config`, which is
never committed. Worktree links, Preview command, Test command and Code landing go to the manifest — the project's
own `.aide/project.yaml` where it is tracked, else the dashboard's `settings.yaml`. Unchanged values are not
rewritten.

### Deploy

Two panels. The first says how far the checkout is behind origin, and for the one project this server runs from,
which commit it is serving; under it a **Deploy** button, disabled when the checkout matches origin or when origin
has not been checked yet. A project with no `AIDE_INSTALL_CMD` keeps the heading and a sentence saying there is
nothing to act on. When drift has not been checked yet, the page asks for itself again after five seconds.

The second panel starts a test server for the project, in a new tab. Without a preview command configured, the
heading stays with a sentence saying it is unavailable.

### Schedule

A scheduled job runs a prompt against this project on a cron expression, with no spec involved — a report, a
sweep, a check. The tab lists this project's jobs by name, cron expression, prompt and next run, or says nothing is
scheduled, and under the list is the form that creates one, with this project already filled in.
[Running a job on a schedule](running-specs.md#running-a-job-on-a-schedule) has what such a job may do and where
its output goes. The tab is drawn even for a project
that is not on the allowlist; its submission is then refused, with the reason on the form.


## How a project's code lands

When a spec is archived, the dashboard lands its code in one of two ways, chosen per project with **Code landing** — in
the Add form, or under Edit on the project's own page:

| Code landing                                | What happens                                                                                                                                                                                                                                        |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Merge into the default branch (the default) | Archive merges the code branch into the project's main branch, once the project's tests pass on the merged result.                                                                                                                                  |
| Create a pull request                       | Each step that pushes the code branch opens a pull request for it, and archive leaves that pull request open instead of merging, so someone can review the code before it reaches main. The row links to it for as long as the branch is on origin. |

Either way, the spec folder itself is archived straight away: its move to `archive/` is merged into the specs
repository without review. A project that keeps its specs inside its own repository has one branch for both, so there
the archived spec waits in the same pull request as the code.

A pull request is opened with `gh` on the machine that runs the dashboard, so `gh` has to be logged in there. When it
is not, the run still succeeds, and the row says no pull request was opened and that one can be opened by hand.

Only `codeLanding: pr` is ever written: merge is what an absent key already means, and choosing it removes the key
again. It goes in the project's `.aide/project.yaml` where the project tracks its manifest — and then every machine
and every teammate lands the same way — otherwise in the dashboard's own settings file, which reaches a run as a
copy and is local to this machine. It is never read from `.aide/config`.

It applies only to what the dashboard lands. `/aide-archive` run by hand in an AI assistant archives the spec and leaves
the branches as they are; merging them or opening a pull request is then up to you.

How the landing works inside, and what not to get backwards when changing it:
[A project can ask for its code branch to stay open](landing.md#a-project-can-ask-for-its-code-branch-to-stay-open).
