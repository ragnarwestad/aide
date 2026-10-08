# Development in aide/dashboard

What a session working under `dashboard/` has to know before changing the
queue, the worktrees or a run: the things that are easy to get backwards.
Each rule names the page in `docs/` that says why. Much of this also
governs `core/scripts/aide-run-spec`, the dashboard's execution backend — a
session editing that script directly should read this file by hand.

The rules that matter only in one part of the code live in `.claude/rules/`
beside this file and load when a file they name is read:

- `landing.md` — the landing, the archive step and Close: the code that
  lands a branch, and the rows and pages that read what a landing left.
- `process-groups.md` — signalling a process group, under `src/serve/`.
- `dashboard-design.md` — tokens, the class vocabulary and the layout
  rules, under `src/render/`.

They load only for a session whose working directory is `dashboard/`. A
session run from the repo root — one editing `aide-run-spec` — does not
get them, and reads them by hand.

## How a run touches the repositories

`docs/the-runner.md`, "How a run touches the repositories".

- `aide-run-spec` branches EVERY repo it touches, and pushes a repo only
  when its branch has content beyond its own default branch AND origin
  does not already hold that tip — never on `changedFiles`, which a step
  that commits its own work leaves at `0`, and never on "moved during
  THIS run" alone: a commit a prior run's failed push left stranded is
  retried on every later run, not only the run that made it.
  A run's own bookkeeping (`Workflow steps completed`) is written and
  pushed as its own confirmed step, so it never lands while that push
  cannot be confirmed against origin.
- It works in `git worktree` checkouts under
  `$HOME/.aide/dashboard/worktrees/<project>/<spec>/`. The result's `repos[].root` is
  the MAIN checkout; `repos[].worktree` is the throwaway one.
- Gitignored paths reach a worktree only through `worktreeLinks:` in the
  manifest; `.aide/config`'s `AIDE_WORKTREE_LINKS` is the fallback, and the
  manifest wins. A project that does not track a manifest keeps its
  settings in the dashboard's `checkouts/<name>/settings.yaml`; the
  clone, a step's worktree and the landing's tree carry an untracked copy
  of it as `.aide/project.yaml`, kept out of every commit and out of
  `aide_tree_hash`. A tracked manifest always wins.
- A run reaches the project and its specs root, and nothing else — and
  under the specs root only its own folder (and its `archive/` twin):
  a step that writes another spec's folder ends `scope-violation`, with
  those changes discarded before the commit. `create` is the one step
  that makes a folder.
- The script runs from a private copy of itself — an `implement` step
  reinstalls it under bash's feet — and `/bin/bash` here is 3.2: no
  `mapfile`, build arrays with `array+=(...)`.
- **An `implement` whose own turn ends `completed` is reviewed before
  its tests decide anything** (`run-spec/turn/review.sh`): a second,
  fresh session with the same model reads the description and the
  branch's diff and looks for defects against the description alone.
  Defects go back to the ORIGINAL session as one follow-up turn; the
  review itself is best-effort, so a verdict it cannot parse counts as
  "found nothing". The step's cost sums every turn, and its `sessionId`
  stays the implement session's.
- **An `implement` ends only on a green test run the runner made itself**
  (`run-spec/turn/step-tests.sh`), never on the session's own record.
  Red goes back to the same session, at most `AIDE_TEST_FIX_ROUNDS` (2)
  more turns; still red is `tests-red` on the STEP (Implement offered
  again), unlike the landing's `tests-red`, which STOPS the job. An
  `archive` runs no suite of its own: its landing runs it once, on what
  main is about to become, and skips it when the runner already saw that
  same tree green (`testedGreen`, `aide_tree_hash`).

  `docs/the-runner.md` and `docs/landing.md` have the rest.
- Every move of a shared checkout — the pull (switch, fetch,
  fast-forward) and the worktree add — runs under the per-root lock
  `$root/.git/aide-run-spec-worktree.lock` (`acquire_worktree_lock`,
  `run-spec/setup/gates.sh`). Runs of one project share its checkout, and a
  git command that moves it outside the lock loses a ref lock or the
  checkout under its feet when another run is in its own section.
  A refusal from such a command quotes git's own first line.

## The dashboard's own checkouts

`docs/projects.md`, "Adding a project".

- **A clone happens on a press and nowhere else.** `ensureDashboardCheckout`
  clones only when its caller passes `mayClone` — Add, and any
  successful Settings save of the project, whichever field it changed. Every tick, boot and page render asks
  without it and is told what is missing; `CheckoutEnsurer.make()` is
  the one entry that may clone, and `get`/`fresh` never do.
- **Nothing here deletes a checkout, and nothing re-clones one to repair
  it.** A directory that is there and that git cannot answer for is
  reported by project at the top of every page
  (`render/ui/checkout-faults.ts`), in the dashboard's own sentence —
  git's own words appear only for a clone that failed — and left alone. A checkout that IS
  the project's own entry gets its own sentence, because the advice
  "remove it by hand" would be advice to delete the project.
- **A path handed to git has both sides resolved first.** git answers
  with every symlink resolved; a path off the scan of the projects root
  does not — that root is a directory of LINKS on a serving host, and on
  macOS `$TMPDIR` is a link too. Subtracting one from the other
  (`relative(root, dir)`) then climbs out of the repository and back down
  an absolute path, and `git show <ref>:<that>` finds nothing while
  failing quietly: the read comes back empty and whatever it fed reads as
  "gone", so an acceptance tick on a row the page has just drawn is
  refused as no longer there. `real()` in
  `git/branch-file.ts` and `sameRoot` in `land-branch/merge.ts` are the
  guard; `aide-run-spec` resolves the specs root it is handed for the
  same reason.
- **A project is added by its git address, so no directory already on
  the host is ever registered.** Where the clone lands depends on the
  projects root. On the directory of links a serving host uses, the
  entry is a link to the dashboard's own checkout, so `personDir` and
  that checkout are one directory. On an ordinary projects root, Add
  clones into `<projects root>/<name>` and then makes the dashboard's own
  checkout as a second clone of the same origin, so they are two.

## The hand-paired bash/TypeScript pairs

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. Each pair is pinned by a test that reads
both sides, but the two copies are still edited by hand together.
`docs/bash-typescript-decisions.md` has the table, and the decisions that
look like pairs but share one source.

- **The landing runs Aide's scripts from beside `--runner-bin`, never from
  PATH alone** (`scriptFor` in `land-branch/run-script.ts`). A test board
  serving a branch runs that branch's TypeScript, and the bash written
  together with it lives in the same checkout; the copy under
  `~/.local/bin` is main's, so a flag the branch added is "unknown" to
  it. Prod's runner IS the installed one, so prod is unchanged.
  `test/serve/land-branch/scripts-beside-the-runner.test.ts` pins the
  lookup and the wiring.

## Starting a script

- **A script is started through its own interpreter, never exec'd
  directly** (`scriptArgv`, `src/integrations/script-argv.ts`). macOS
  checks a freshly written executable for 10-13 seconds the first time it
  is exec'd, once per new file; every install and every test stub is one.
  A test that puts a stub on PATH for a bash script to call hands it down
  as an exported function (`BASH_FUNC_<name>%%`) instead of a file, and a
  stub that must be a file is written once per test file, not per test.

## Code health

The repository's rules for file length, folder size, splitting a module
and where its tests live are in `.claude/rules/development.md`, "Code
health", and hold here as everywhere. The dashboard checks them in
`test/design/code-health-limits.test.ts`, its stylesheets included. What
is particular to the dashboard:

- `messages.ts`, `en.ts` and `nb.ts` are exempt from the line limit by
  filename — the message catalogues grow with every new string. Files
  already over the limit are held at their recorded length in the test's
  `OVER_LINE_LIMIT`.
- A test moved into a subfolder gains one `../` in its own imports.
- No `<name>-e` twin sits beside a file under `src/` or `test/`. macOS
  `sed -i -e ...` reads `-e` as the backup suffix and leaves the original
  under that name; the copy still parses, so nothing fails and nothing
  says so.
