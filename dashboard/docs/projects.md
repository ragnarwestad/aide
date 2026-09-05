# Projects

How a project is added to the dashboard, what decides whether a run can start there, and what its own page shows. The
queue that runs its specs is on [Running specs](running-specs.md).

## Table of contents

- [Adding and removing a project](#adding-and-removing-a-project)
    - [Whether a run can start there](#whether-a-run-can-start-there)
    - [A page render never waits on the network](#a-page-render-never-waits-on-the-network)
    - [What Add finishes itself](#what-add-finishes-itself)

---

## Adding and removing a project

The Projects panel on `/projects`, behind the queue token like every other mutating control. It sits under the listing
it changes, which it can because the overview is a served page with a server behind it to check a token against. Add
takes a name plus either a git URL (cloned to
`<projects root>/<name>`) or a path to a checkout already there, and optionally a specs root and a one-line description.
It writes a minimal manifest — the name and that description, nothing else — only when the checkout has none; filling in
the rest is `/aide-manifest`'s job afterwards, and the form says so.

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
the `.aide` written a second earlier is part of what the runner will see. Two rows are not: `gitRoot`'s
"inside a bigger repository" case and `specsRepo` are this dashboard's own, stricter reading — `aide-run-spec` does
not refuse on either today, a known asymmetry recorded in
`tests/fixtures/project-readiness-prerequisites.json`'s own comment rather than pinned against the runner.

| Check           | Blocks a run when                                                                                                                                           |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `gitRoot`       | the project directory is no repository at all — or, in this dashboard check only, is inside a bigger one (`aide-run-spec` does not refuse that second case) |
| `specsRoot`     | the configured `AIDE_SPECS_PATH`, or `<project>/specs` when none was given, is not a directory                                                              |
| `specsRepo`     | (dashboard only) that specs root is in no git repository — `aide-run-spec` silently leaves such a root out of what it commits, rather than refusing         |
| `defaultBranch` | the default branch is neither here nor on origin, or another worktree already has it checked out                                                            |
| `worktreeLinks` | a configured entry leaves the repository, or names a path that is not there                                                                                 |

`worktreeLinks` is read from the project's committed `.aide/project.yaml`
first and from `.aide/config`'s older `AIDE_WORKTREE_LINKS` second — the same order, and the same winner, as
`aide-run-spec` itself reads them in.
`tests/fixtures/worktree-links-precedence.json` is the one table both sides are tested against, because the two are
written independently and nothing else would stop them drifting.

`tests/fixtures/project-readiness-prerequisites.json` is the equivalent table for `gitRoot`, `specsRoot`,
`defaultBranch` and `worktreeLinks` themselves: a test on each side reads it and asserts `aide-run-spec` really
refuses what this page says it does, for the same identifier and the same blocking answer.

`defaultBranch` is asked of **every** repository a run touches — the project's, and the specs repo when the specs live
elsewhere — because the runner refuses on it in any of them. A checkout on a feature branch is reported and does not
block: the runner puts the checkout on its default branch itself.

There is no `clean` check: a run reads origin's default branch into a worktree of its
own, so what somebody left uncommitted in the main checkout reaches nothing, and the runner does not refuse over it
either.

Nothing in the assessment mutates anything: no branch is switched, no directory made, no file committed. That is also
why the answer can go stale. A default branch resolvable when the project was added is one somebody can delete or park a
second worktree on a minute later, and Run says so at the time — this is a preflight check, not a promise.

The result is shown where Save was pressed. With script it goes into the form's own slot and the page stays put, because
the Specs root and Worktree links fields on that page are usually what fixes it and saving again re-assesses. Without
script the redirect carries the same sentence to `/projects` in the query string, where the page renders it. The
sentence is built once, on the server, so the two modes cannot drift apart.

### A page render never waits on the network

`assessProjectReadiness` only ever touches disk — `rev-parse`, `show-ref`, `symbolic-ref`, `worktree list` — and so
does everything else on the request path. The commits-behind-origin count beside it on the same row needs a real
`git fetch origin`, and that fetch runs off the request path: `refreshDrift()` walks the configured projects on an
`.unref()`'d `setInterval`, the same shape as the runner's own tick and the SSE keep-alive ping, cleared in `stop()`
beside them. The handler calls the synchronous `peekDrift()`, which reads the cache and never spawns git. A project
the poll has never reached yet returns `checkedAt: null`, and the row says "origin drift not checked yet" — a labelled
stale number, never a page that blocks on GitHub being reachable.

### What Add finishes itself

Add does itself what a run would otherwise refuse over a minute later.

**The name is the directory's, not the typed one.** A project is discovered as a directory under the projects root, and
`discoverProjects` reads its name off that entry and out of no manifest — so a project registered under a name that
differs could never be found again. Where a pick and a typed name disagree, the pick wins. The Name field says what it is actually for:
naming the directory a **clone** creates. A full path typed by hand is not the picker, mismatch refusal
and all.

**A specs root that is not there is made.** Writing the path into `.aide/config` and then reporting the project as
unable to run over a directory that is not there is a refusal over a path known the moment it was written. Add
creates it, with the `archive/` beside it that a run walks. A creation that fails is not a refusal of the add:
the step says what happened, and the `specsRoot` check below reads the real state either way.

**Nothing is appended to `.git/info/exclude`.** No run refuses over a dirty tree, so an untracked manifest Add has
just written needs no getting out of. Where a manifest belongs
is a question with two answers — in git in a project of one's own, out of it in an employer's checkout — and nothing an
Add can decide; it is not a question anybody is forced to answer before running anything.

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

**The project's own page, `/projects/<name>`, answers the two things a generated file could not:** what its
`.aide/config` says, and whether a run could start there at all. The manifest itself is not repeated — a frozen copy
of a file nothing on the page can act on, and a manifest that fails to parse already says so on the project's
`/projects` row, which is the live view of the same thing. Each of the seven recognized config keys is marked
configured, worked out (naming the lockfile that decided it, hedged as a default rather than a verified command) or
not set; a checkout with no `.aide/config` says so in as many words, because "no file" and "a file setting nothing"
are different states and the first is what a project cloned onto a second machine is in. Below that, the same checks
`assessProjectReadiness` runs at Add time, on every load rather than once in a notice gone by the next page. Nothing
is executed and nothing is moved: a git that cannot answer leaves the settings standing, with no readiness section.
The generated `/<slug>.html` page shows the manifest and the specs only: it is generated after a merge lands somewhere
in the queue, and a config file edited between merges would be described there as it stood days ago.

**A project's settings can be changed after it is added.** Its own
`/projects/<name>` page keeps the current values and the read-only settings overview visible while Edit opens Specs
root, Worktree links and Code landing inline. Save and Cancel return to the same project page. The same writer still
saves the specs path to `.aide/config` and the other two settings to
`.aide/project.yaml`; unchanged values are not rewritten. `/projects/<name>/settings` redirects to the project page.

**And the readiness note is recomputed on every visit.** Each row that cannot run carries its own note, beside the
Settings link that acts on it — a note shown once, in the query string of the redirect an Add lands on, leaves an
operator who did not act on it there no way to rediscover what was missing except by starting a run and having it
refused.

Remove takes the project off the allowlist and off this dashboard, and that is all it does: the checkout and the specs
root stay on disk, untouched. It asks for the project's name to be typed back, and the server refuses anything but an
exact match — the browser turning the button off until it matches is a convenience over that check, not the check
itself.

The generated `projects.html` carries neither control: it is a redirect to the served page. The generated pages stay
open, which means they carry nothing that needs the token — and both of these actions do.

A server started without `--root` has no projects root to list or add to. Its `GET /projects` redirects to the generated
`projects.html`
instead of rendering an empty listing, and its nav goes on naming that file — an empty page would read as "no projects
on this machine" rather than "this server was never told where they are".
