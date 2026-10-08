# Glossary

## Table of contents

- [The spec](#the-spec)
- [The board](#the-board)
- [When something does not go on](#when-something-does-not-go-on)
- [The wiki](#the-wiki)

---

The words Aide's documentation, rules and skills use, one meaning each.
Each entry says what the word is and links the page that has the rest.

## The spec

- **Spec** — one piece of work: a folder of four files in the project's
  specs root, `NN-slug/`. [Spec structure](../core/rules/spec-structure.md).
- **Description** — `1-description.md`: the problem as the author gave it,
  with optional acceptance criteria and an optional `## Out of scope`
  section. Never rewritten by a step.
- **Acceptance criterion** (`AC-n`) — one requirement in the description,
  one sentence in an EARS pattern. The user ticks its row in `4-status.md`;
  no step ever does.
- **EARS** — the five sentence patterns a criterion is written in (always,
  WHEN, WHILE, IF … THEN, WHERE), condition first.
- **Criteria checks** — how strictly the analysis holds the criteria to
  account: `off`, `warn` or `stop`, chosen when the spec is created.
- **Plan review** — the last part of an analysis: three reviewers attack
  the plan, and it is revised before any test is written.
- **Phase** — one of the four steps a spec passes through: create,
  analyze, implement, archive.
- **State** — where a spec stands, in the past tense: created, analyzed,
  implemented, archived, closed. Derived from its files, never stored.
  [How a spec moves between phases](../dashboard/docs/spec-transitions.md).
- **Round** — another analysis or implementation on a spec that is held
  back on its criteria, or reopened with its files kept, without starting
  over. [A spec's lifecycle](../dashboard/docs/spec-lifecycle.md#another-round-on-the-same-spec).
- **Reopen** — take an archived or closed spec back into the active list,
  keeping its files or resetting the analysis, the plan and the status.
- **Close** — end a spec that will not work: its reason is stamped, the
  folder moves to `archive/`, and its code branch is deleted unmerged.
- **Depends on** — a Tracking info line naming specs this one waits for:
  its analyze, implement and archive wait until they have landed.

## The board

- **Board** — the dashboard: the web pages that queue, run and show the
  steps. [The dashboard](../dashboard/README.md).
- **Job** — one run of one or more steps for one spec, wiki or scheduled
  task, with its own state: queued, running, done, stopped, failed,
  cancelled or interrupted.
  [A job's states](../dashboard/docs/job-states.md).
- **Step** — anything the queue runs: the four phases, and explore,
  manifest, schedule, reopen, close and wiki.
- **Skill step** — a numbered section of the skill a step runs,
  `Step N of X`, marked in the step's log.
- **Runner** — `aide-run-spec`, the script that runs one step: checks out
  a worktree, starts the AI tool, records what happened.
  [The runner](../dashboard/docs/the-runner.md).
- **Worktree** — the throwaway checkout a step works in, on the spec's own
  branch `aide/<folder>`.
- **Worktree links** — the gitignored folders, such as `node_modules` or
  `.venv`, linked into a worktree from the main checkout; named by
  `worktreeLinks:` in the project's manifest.
- **Landing** — merging a step's branch into the default branch, after
  the step itself. A step is not finished until it has landed; an
  archive's landing runs the project's tests on the merge first.
  [Landing](../dashboard/docs/landing.md).
- **Merge into main** — the skill step a landing is marked as in the log:
  the last step of every skill whose work lands.
- **Test server** — a running copy of the project built from a spec's
  branch, offered between implement and archive.
  [Test server](../dashboard/docs/test-server.md).
- **Deploy** — installing what has reached the default branch on the
  machine the board runs on (`AIDE_INSTALL_CMD`); pressed by hand.
- **Schedule** — a task the board runs at set times, such as the nightly
  browser tests.
- **Specs root** — the folder holding a project's specs; `AIDE_SPECS_PATH`
  points Aide's own at `aide-specs/aide/`.

## When something does not go on

Two words are used for two different things each, and the context says
which:

- **Held back** — (1) a **job** held back: still queued, waiting for a
  dependency to land or another job on the same spec to finish; nothing
  failed. (2) an **archive** held back: the spec's acceptance criteria are
  not all ticked, so archive declines until they are.
- **Stopped** — (1) a **job** in the state `stopped`. (2) a **step** that
  ended without finishing, for a reason it names: `timeout`, `tests-red`,
  `no-progress`, `scope-violation`, and others.
- **Conflict** — the spec's branch does not merge cleanly with the
  default branch; archive resolves it.

## The wiki

- **Wiki** — a map of how a project's parts hang together, in `wiki/` in
  its specs root, read first by the analysis. [The wiki](WIKI.md).
- **Generated page** — a wiki page a wiki run wrote, naming the files and
  the commit it was written from; rewritten when its files change.
- **Hand-written page** — a wiki page a person wrote; no run changes it.
- **Build / refresh** — a build rewrites every generated page; a refresh
  only those whose files changed, and runs by itself after an archive
  lands.
