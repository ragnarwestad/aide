# Projects

How a project is added to the dashboard, what decides whether a run can start there, and what its own page shows. The
queue that runs its specs is on [Running specs](running-specs.md).

The page has two parts. [Using it](#using-it) is for someone adding and running projects on the board.
[How it works inside](#how-it-works-inside) is for someone changing the code that does it.

## Table of contents

- [Using it](#using-it)
    - [Adding a project](#adding-a-project)
    - [Where a project's settings are kept](#where-a-projects-settings-are-kept)
    - [Removing a project](#removing-a-project)
    - [Whether a run can start there](#whether-a-run-can-start-there)
    - [What Add finishes itself](#what-add-finishes-itself)
    - [A project's own page](#a-projects-own-page)
        - [Config](#config)
        - [Deploy](#deploy)
        - [Schedule](#schedule)
    - [How a project's code lands](#how-a-projects-code-lands)
- [How it works inside](#how-it-works-inside)
    - [Two homes for a project's manifest keys](#two-homes-for-a-projects-manifest-keys)
    - [How the settings reach a run](#how-the-settings-reach-a-run)
    - [Which readiness checks are the dashboard's own](#which-readiness-checks-are-the-dashboards-own)
    - [A page render never waits on the network](#a-page-render-never-waits-on-the-network)
    - [A server started with no projects root](#a-server-started-with-no-projects-root)

---

## Using it

### Adding a project

`/projects` lists every project the dashboard knows, with an **Add** button above the list and a **Remove** link on
each row. Add opens a page of its own; both are held to the same-origin rule, like every other control that changes
something.

**The projects root is where they all live** — the directory the server was started with as `--root`. A project is
a directory under it, and the list is what the dashboard finds there. Adding one also puts its name on the queue's
allowlist, which is what a run checks before it starts; removing one takes the name off again.

The Add form asks for:

| Field          | What it takes                                                                                                  |
|----------------|----------------------------------------------------------------------------------------------------------------|
| Name           | Required. The name of the directory the clone makes under the projects root, and the project's name everywhere |
| Git URL        | Required. The address to clone                                                                                 |
| Specs path     | Optional. Where this project's specs live, when they are not in `specs/` inside it                             |
| Code landing   | Required, none pre-selected — see [How a project's code lands](#how-a-projects-code-lands)                     |
| Worktree links | Optional. Space-separated repo-relative paths a run has to symlink into its worktree                           |
| Description    | One line saying what the project is                                                                            |

**A project is added by its git address and cloned — there is no way to register a directory already on the host.**
That leaves ONE layout for every project: the entry under the projects root is a checkout the dashboard itself made.
Where the clone lands depends on what the projects root is:

- **An ordinary directory**, such as a laptop's own `~/develop`: Add clones into `<projects root>/<name>`, and then
  makes the dashboard's own checkout, `~/.aide/dashboard/checkouts/<name>/code`, as a second clone.
- **The directory of links beside the dashboard's own checkouts**, as on a serving host: Add clones into
  `~/.aide/dashboard/checkouts/<name>/code` and puts a link to it at `<projects root>/<name>`. A checkout already
  there — one `install-serve` made — is linked rather than cloned again.

**A clone happens on a press and at no other time.** Add clones the project, and a successful save of its settings
on the project's own page makes any checkout it is still missing — whichever field was saved, not the specs root
alone. Every tick, boot and page render asks for the checkout without permission to make one. The dashboard never
deletes a checkout and never re-clones one to repair it: a directory that is there and does not answer is something
to look at, and the message says so.

**What is reported, and where.** A checkout git cannot answer for, and a clone that failed, are named at the top of
every page. A missing dashboard checkout is named there only when the project's own entry under the projects root is
gone as well: while that entry is there, every reader falls back to it, and the missing checkout goes to the server's
log alone. The sentence at the top of the page is the dashboard's own, naming the path and what to do about it —
except for a failed clone, where it quotes what git said.

**A project that does not already track a manifest keeps nothing of Aide's in its repository.** What Add would have
written into the checkout — the name, the description, worktree links, code landing — goes to the dashboard's own
settings file, `~/.aide/dashboard/checkouts/<name>/settings.yaml`, in the manifest's own format. A manifest the checkout already tracks is the team's and
is never written to; Add says so in its manifest step and writes nothing for the links and the landing. An untracked
`.aide/project.yaml` in the checkout (a draft from `/aide-manifest`) is left as it is and seeds the settings file, so what
it said is not lost.

### Where a project's settings are kept

A project's settings live in one of two files, and the page says which in a sentence above the table.
Four states, in the page's own words:

| The page says                                  | What it means                                                                        |
|------------------------------------------------|--------------------------------------------------------------------------------------|
| Kept in the project's own `.aide/project.yaml` | The repository tracks a manifest, and it travels with the project to any machine     |
| Kept in the dashboard, in `settings.yaml`      | The repository tracks no manifest, so this dashboard holds them beside its checkouts |
| … and the dashboard's copy is not used         | Both files exist, and the tracked manifest wins as a whole file                      |
| No settings are stored yet                     | Neither file exists                                                                  |

**Add always leaves a project in the second state**, whatever was typed: the form writes the name,
the description, the worktree links and the code landing to the dashboard's own settings file and
nothing into the repository.

**What moves a project to the first state is the project itself**: commit an `.aide/project.yaml` in
its repository — `/aide-manifest` drafts one — and the dashboard reads that instead from the next
render on. Nothing on the board moves the settings, and no press copies one file into the other.

Two of the seven values never travel this way at all: Specs path and Install command are written to
`.aide/config`, which is never committed, so they are this machine's alone whichever state the
project is in.

### Removing a project

Remove takes the project off the allowlist and off this dashboard, and that is all it does: the checkout and the
specs root stay on disk, untouched. `/projects/<name>/remove` asks the question in a sentence and the press is the
answer; nothing is typed back.

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
owns rather than the project's own directory.

| Check           | Blocks a run when                                                                                                                                                     |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository at all — or, in this dashboard check only, is inside a bigger one (`aide-run-spec` does not refuse that second case)           |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory                                                                        |
| `specsRepo`     | (dashboard only) that specs root is in no git repository — `aide-run-spec` silently leaves such a root out of what it commits, rather than refusing                   |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out                                                                      |
| `worktreeLinks` | a configured entry leaves the repository, names a path that is not there, or names a build directory (`build`, `dist`, `.gradle`, `target`), which is refused by name |

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
put, because the Specs path and Worktree links fields are usually what fixes it and saving again re-assesses.
Without script the redirect carries the same sentence to `/projects` in the query string, where the page renders
it. The sentence is built once, on the server, so the two modes cannot drift apart. A Settings save is the gap: a successful one shows no readiness line at
all. Its redirect carries the sentence to `/projects/<name>`, which reads only an error from the query string, so
the sentence is dropped. Reload the project page to see where the save left things.

### What Add finishes itself

Add does itself what a run would otherwise refuse over a minute later.

**The name is the directory's.** A project is discovered as a directory under the projects root, and its name is
read off that entry and out of no manifest — so a project under a name that differs could never be found again. The
Name field therefore names the directory the clone creates, and nothing else settles it.

**A specs root that is not there is made.** Writing the path into `.aide/config` and then reporting the project as
unable to run over a directory that is not there is a refusal over a path known the moment it was written. Add
creates it, with the `archive/` beside it that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the real state either way.

**A specs root one level too high is refused, not guessed.** One specs repository holds the specs of several
projects, each in a folder of its own, so a root set to the repository itself looks exactly like a root set right.
Where the root IS the repository's top level and a folder named after the project is already sitting in it, the run
refuses and names both paths: set the root to that folder, or move it aside if it is not this project's. Guessing
either way writes the spec folder in one place while every list looks in the other.

**Nothing is appended to `.git/info/exclude` of a checkout a person edits.** Add writes nothing into it, so there
is nothing to get out of git afterwards. Keeping `.aide/config` untracked is the reader's own job, once per
machine: a personal global gitignore (`core.excludesFile`) covers it in every project without touching any
project's own `.gitignore`. The dashboard's own clone, which nobody edits, lists its derived `.aide/project.yaml`
in that clone's `.git/info/exclude`.

**Worktree links are suggested on the project's own page, not on Add.** Nothing can derive which gitignored paths a
project's commands need, which is why the field exists — but a checkout's `.gitignore` names the candidates in a
file the reader had to go and open. The Config tab's Edit form lists the literal, top-level
entries from that checkout's `.gitignore` as a line of text under the field: a suggestion the reader may ignore. Globs, negations, comments and nested paths are left out — they are not values
`worktreeLinks` can take. A suggestion is not an endorsement either: a `.gitignore` routinely lists `build`, `dist`
or `.gradle` beside `node_modules`, and those are refused — with the path named — because a link is one shared
symlink, and a build writing through it would collide with every other run's. Add has no such list, and proposes
nothing at all: the project is not on this host yet, so there is no lockfile to read and no `.gitignore` to suggest
from.

### A project's own page

`/projects/<name>` has three tabs — **Config**, **Deploy** and **Schedule** — chosen with `?tab=` and defaulting to
Config, which is also where an unrecognised value lands.

#### Config

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
Six controls open: Specs path, Worktree links, Install command, Preview command, Test command and Code landing.
Lint and build stay read-only, since nothing a run does reads them. The test field is empty with the worked-out
command as its placeholder, so a save that never touched it configures nothing. Worktree links has a line of the
checkout's own top-level `.gitignore` entries under it. The five text fields are as wide as their cell and grow to
show the whole value; with the board's script on, Enter saves, and a value is always one line — a line break in it is
folded to a space. Save and Cancel both return to
`/projects/<name>`, and `/projects/<name>/settings` redirects there too.

Where each value is written is not one rule but two. Specs path and Install command go to `.aide/config`, which is
never committed. Worktree links, Preview command, Test command and Code landing go to the manifest — the project's
own `.aide/project.yaml` where it is tracked, else the dashboard's `settings.yaml`. Unchanged values are not
rewritten.

#### Deploy

Two panels. The first says how far the checkout is behind origin, and for the one project this server runs from,
which commit it is serving; under it a **Deploy** button, disabled when the checkout matches origin or when origin
has not been checked yet. A project with no `AIDE_INSTALL_CMD` keeps the heading and a sentence saying there is
nothing to act on. When drift has not been checked yet, the page asks for itself again after five seconds.

The second panel starts a test server for the project, in a new tab. Without a preview command configured, the
heading stays with a sentence saying it is unavailable.

#### Schedule

A scheduled job runs a prompt against this project on a cron expression, with no spec involved — a report, a
sweep, a check. The tab lists this project's jobs by name, cron expression, prompt and next run, or says nothing is
scheduled, and under the list is the form that creates one, with this project already filled in.
[Running a job on a schedule](running-specs.md#running-a-job-on-a-schedule) has what such a job may do and where
its output goes. The tab is drawn even for a project
that is not on the allowlist; its submission is then refused, with the reason on the form.

### How a project's code lands

When a spec is archived, the dashboard lands its code in one of two ways, chosen per project with **Code landing** — in
the Add form, which leaves it unchosen and refuses a project added without an answer, or under Edit on the project's own page:

| Code landing                                | What happens                                                                                                                                                                                                                                        |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Merge into the default branch               | Archive merges the code branch into the project's main branch, once the project's tests pass on the merged result.                                                                                                                                  |
| Create a pull request                       | Each step that pushes the code branch opens a pull request for it, and archive leaves that pull request open instead of merging, so someone can review the code before it reaches main. The row links to it for as long as the branch is on origin. |

Either way, the spec folder itself is archived straight away: its move to `archive/` is merged into the specs
repository without review. A project that keeps its specs inside its own repository has one branch for both, so there
the archived spec waits in the same pull request as the code.

A pull request is opened with `gh` on the machine that runs the dashboard, so `gh` has to be logged in there. When it
is not, the run still succeeds, and the row says no pull request was opened and that one can be opened by hand — on the
line of the step that tried, since that is the step that called `gh`.

Two cases are not failures, and the row says nothing about either going wrong. A step that pushed nothing to the
project's own repository opens no request at all, and says so nowhere: a create and an analyze change the spec folder
alone, and there is nothing about the code to review. And a branch that already has a request keeps it — `gh` names
that request in the very message it refuses with, and the row links to it, so a later step of the same spec reads the
same as the one that opened it.

A step whose push failed opens no request either, and says so, since there is no branch on origin to review.

Only `codeLanding: pr` is ever written: merge is what an absent key already means (a manifest with none reads it), and choosing it removes the key
again. It goes in the project's `.aide/project.yaml` where the project tracks its manifest — and then every machine
and every teammate lands the same way — otherwise in the dashboard's own settings file, which reaches a run as a
copy and is local to this machine. It is never read from `.aide/config`.

It applies only to what the dashboard lands. `/aide-archive` run by hand in an AI assistant archives the spec and leaves
the branches as they are; merging them or opening a pull request is then up to you.

How the landing works inside, and what not to get backwards when changing it:
[A project can ask for its code branch to stay open](landing.md#a-project-can-ask-for-its-code-branch-to-stay-open).

---

## How it works inside

### Two homes for a project's manifest keys

"Tracked" means `git ls-files --error-unmatch
.aide/project.yaml` in the checkout answers yes (exit 0); exit 1 is not tracked, and any other answer means git cannot
say, so nothing is written, committed or overwritten for a manifest key and the save names why. A tracked manifest
wins as a whole file: the settings file is then read by nothing, and the project's page says so. Without a tracked
manifest the settings file is the manifest. A Settings save commits and pushes only where the manifest is tracked;
otherwise it writes the settings file and waits for a fresh `ensureDashboardCheckout` to carry it.

### How the settings reach a run

`ensureDashboardCheckout` writes the settings file as an ignored
`.aide/project.yaml` in the dashboard's own clone (listed in that clone's `.git/info/exclude` before any
fast-forward, so the day the team commits a manifest the pull overwrites the copy instead of refusing). `aide-run-spec`
copies it from the main checkout into a step's worktree and keeps it out of the commit and out of `aide_tree_hash`;
the landing's test gate copies it into its tree, and reads the worktree links from there. Every reader of
`<dir>/.aide/project.yaml` — TypeScript and bash — therefore finds it unchanged. Discovery and the project page read a
project's manifest from the clone when the project's own directory holds none.

### Which readiness checks are the dashboard's own

The asymmetry is recorded in
`tests/fixtures/project-readiness-prerequisites.json`'s own comment rather than pinned against the runner.

`worktreeLinks` is read from the project's `.aide/project.yaml` (the committed one, else the dashboard's derived copy)
first and from `.aide/config`'s older `AIDE_WORKTREE_LINKS` second — the same order, and the same winner, as
`aide-run-spec` itself reads them in.
`tests/fixtures/worktree-links-precedence.json` is the one table both sides are tested against, because the two are
written independently and nothing else would stop them drifting.

`tests/fixtures/project-readiness-prerequisites.json` is the equivalent table for `gitRoot`, `specsRoot`,
`defaultBranch` and `worktreeLinks` themselves: a test on each side reads it and asserts `aide-run-spec` really
refuses what this page says it does, for the same identifier and the same blocking answer.

### A page render never waits on the network

`assessProjectReadiness` only ever touches disk — `rev-parse`, `show-ref`, `symbolic-ref`, `worktree list`,
`remote get-url` — and so
does everything else on the request path. The commits-behind-origin count on a project's own Deploy tab needs a real
`git fetch origin`, and that fetch runs off the request path: `refreshDrift()` walks the configured projects on an
`.unref()`'d `setInterval`, the same shape as the runner's own tick and the SSE keep-alive ping, cleared in `stop()`
beside them. The handler calls the synchronous `peekDrift()`, which reads the cache and never spawns git. A project
the poll has never reached yet returns `checkedAt: null`, and the Deploy tab says the check has not been made yet —
a labelled stale number, never a page that blocks on GitHub being reachable.

### A server started with no projects root

A server started without `--root` has no projects root to list or add to. Its `GET /projects` redirects to the
generated `projects.html` instead of rendering an empty listing, and its nav goes on naming that file — an empty
page would read as "no projects on this machine" rather than "this server was never told where they are". That
generated file is a redirect to the served page and carries no controls of its own; the only other generated page
is `about.html`. There is no generated page per project: the served `/projects/<name>` is the only one, because a
frozen copy beside it was a second page with the same name, one tab away from the live one and always a little out
of date.
