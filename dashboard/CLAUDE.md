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
  retried on every later run, not only the run that made it (spec 343).
  A run's own bookkeeping (`Workflow steps completed`) is written and
  pushed as its own confirmed step, so it never lands while that push
  cannot be confirmed against origin (spec 343).
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
- **An `implement` ends only on a green test run the runner made itself**
  (`run-spec-step-tests.sh`): the session's own record is never what
  decides. Red goes back to the same session first, as a follow-up turn
  with the failing lines — at most `AIDE_TEST_FIX_ROUNDS` (2) more, each
  within what is left of the step's time limit — claude through
  `-p --resume`, codex through `codex exec resume <thread> -`.
  Still red is `terminalReason: tests-red` on the STEP — a failed job
  with the failing lines as detail, and Implement offered again — unlike
  the landing's `tests-red`, which STOPS the job. `run_model_turn`
  (`run-spec-spec-paths.sh`) is the one turn; every turn of a step
  appends to the same transcript. An `archive` runs no suite of its own,
  merged with main or not: its landing runs the suite once, on exactly
  what main is about to become, and that is the one run an archive
  gets. A green
  `test-run.json` whose `tree` (`aide_tree_hash`, `_aide-spec-lib.sh`)
  is the delivered tree's, naming the resolved commands, IS the runner's
  run — the suite is not run again for it, before the first run or after
  a fix turn; a record without a tree is the session's word and never
  counts. The tree hash leaves the project's worktree links out, so it is
  the tree the commit carries, and a landing about to run the same
  commands on the same tree skips its own run (`testedGreen`,
  `land-branch/seen-green.ts`).
- Every move of a shared checkout — the pull (switch, fetch,
  fast-forward) and the worktree add — runs under the per-root lock
  `$root/.git/aide-run-spec-worktree.lock` (`acquire_worktree_lock`,
  `run-spec-gates.sh`). Runs of one project share its checkout, and a
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
  "gone" — an acceptance tick was refused with "that check is not there
  to change any more" on a row the page had just drawn. `real()` in
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
both sides, so drift is caught — but the two copies still have to be
edited by hand together. Three further decisions look like such pairs but
share one source file each — the workflow's own vocabulary, the effort
levels, and whether a spec may move from one phase to another — so those
three are never hand-paired; each carries a runtime assertion instead of
a test that reads two sides.

`docs/bash-typescript-decisions.md` has the full table, the two known
asymmetries in the readiness pair, and the three shared-source decisions
with the tests and assertions that pin all of them.

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

The dashboard's own source keeps these limits, checked by
`test/design/code-health-limits.test.ts`:

- A source file under `src/` stays at or under 500 lines. `messages.ts`,
  `en.ts` and `nb.ts` are exempt by filename — the message catalogues
  grow with every new string.
- A test file stays at or under 800 lines.
- A directory holds at most 15 `.ts` files directly inside it, with no
  exceptions: the six that were over it are grouped into subdirectories
  now, and the list of exceptions is gone. A new `.ts` file that would
  take a directory past 15 goes in a subdirectory of it instead, named
  for what those files are about — `test/e2e/phone/`, `test/serve/schedule/`.
  A moved test's own imports gain one `../`.
- As a rule, a source file's tests live under the matching path in
  `test/` — the test for `src/queue/store/index.ts` belongs under
  `test/queue/`. A small, tightly-coupled file may keep its test beside
  it instead, as `src/i18n/`'s own catalogue files already do.
- A module split across several files is a directory named after the
  module, holding an `index.ts` — never a file sitting beside a
  directory of the same name. `src/render/pages/spec-page/index.ts`,
  not `spec-page.ts` next to `spec-page/`.

- No `<name>-e` twin sits beside a file under `src/` or `test/`. macOS
  `sed -i -e ...` reads `-e` as the backup suffix and leaves the original
  under that name; the copy still parses, so nothing fails and nothing
  says so.

A file nearing a limit is split by responsibility, not by size — pull
out the part that has its own name, not an arbitrary half. New
functionality goes into its own file rather than being appended to one
that already holds something else.
