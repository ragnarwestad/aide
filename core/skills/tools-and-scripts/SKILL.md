---
name: tools-and-scripts
description: >-
  Aide's skills, the per-project .aide/config keys, how a project's own
  test/lint/build commands are detected, and where specs are stored.
  Use when: running a project's test, lint or build command; looking up
  which Aide skill does what; reading or writing .aide/config; deciding
  where a spec belongs.
  Do NOT use for: how to run tests correctly (that is the testing rule),
  the spec files' own layout (use the spec-structure skill).
effort: medium
---

# Tools and scripts

## Table of contents

- [Skills](#skills)
- [Project commands](#project-commands)
- [Per-project configuration (.aide/config)](#per-project-configuration-aideconfig)
- [Spec storage](#spec-storage)

---

## Skills

Skills are loaded from `~/.claude/skills/` — use the `/` syntax.

Each skill's own description says what it does and when to use it; the
`aide-*` skills are the workflow's steps (`/aide-explore`, `/aide-create`,
`/aide-analyze`, `/aide-implement`, `/aide-archive`, `/aide-close`,
`/aide-reopen`) and its helpers (`/aide-manifest`, `/aide-wiki`,
`/aide-to-pdf`).

---

## Project commands

Run the project's own test/lint/build commands **automatically** without asking
the user.

**The test command is `AIDE_TEST_CMD` in `.aide/project.yaml`, and nothing
else.** Committed with the project, so every checkout runs the same one.
One command that runs the project's whole suite — a step, the landing and
`/aide-implement` all run exactly it, through
`aide-resolve-test-cmd --project-dir <path>`. It is never guessed: a project without the key has
no test command, and the dashboard says so on the project's page. Say so
too, rather than detecting one.

**Lint and build:** `AIDE_LINT_CMD` / `AIDE_BUILD_CMD` in `.aide/config`
when set; otherwise detect them from what the project ships — never assume
a toolchain:

| Found in the project root       | Toolchain | Typical commands                        |
|---------------------------------|-----------|-----------------------------------------|
| `pnpm-lock.yaml`                | pnpm      | `pnpm run lint`, `pnpm run build`       |
| `package-lock.json`             | npm       | `npm run lint`, `npm run build`         |
| `yarn.lock`                     | yarn      | `yarn lint`, `yarn build`               |
| `gradlew`                       | Gradle    | `./gradlew build`                       |
| `pom.xml`                       | Maven     | `mvn verify`                            |
| `go.mod`                        | Go        | `go build ./...`                        |
| `Cargo.toml`                    | Cargo     | `cargo build`                           |

For JS/TS projects, read `package.json` `scripts` for the exact names — the
table's commands are the usual defaults, not a promise. Test runners must run
in single-run mode, never watch mode (see the testing rules).

**When to run what:**

- New files created → Run `git add <file>` automatically
- Implementation done → Run the tests covering the change, the type check
  and lint automatically; the whole suite as the project's rules say

---

## Per-project configuration (.aide/config)

Optional file in the project root: `.aide/config`, plain `KEY=value` lines
with `#` comments. Recognized keys:

| Key                   | Purpose                                                                                                          |
|-----------------------|------------------------------------------------------------------------------------------------------------------|
| `AIDE_LINT_CMD`       | Overrides the detected lint command                                                                              |
| `AIDE_BUILD_CMD`      | Overrides the detected build command                                                                             |
| `AIDE_INSTALL_CMD`    | What installing this project means on THIS machine — run by the dashboard after the project's own code is merged |

The worktree links live in the project's **manifest**, not here:

```yaml
# <project>/.aide/project.yaml
worktreeLinks: .venv dashboard/node_modules
```

They exist because `aide-run-spec` gives every run a `git worktree` of
its own, and a worktree carries **tracked files only**: every gitignored
path is simply absent. In a project whose test command lives behind one
of them — pytest in `.venv`, a suite needing `node_modules` — the step
then fails for a reason that has nothing to do with its change. Each
listed path is symlinked in from the main checkout when it exists there,
and excluded from the commit. Paths are relative to the repo root; an
absolute path, or one containing `..`, is refused by name. Which paths
matter cannot be derived without guessing, so the project states them.

They are in the manifest because they hold on any machine. A project
that does not track a manifest keeps them in the dashboard's own
settings file, `checkouts/<name>/settings.yaml`, which reaches a run as
an untracked `.aide/project.yaml`; a tracked manifest wins.
`.aide/config`'s older `AIDE_WORKTREE_LINKS` is never read.

`AIDE_INSTALL_CMD` is for a project that installs itself somewhere, so
that code reaching the default branch also reaches the machine. The value
is an argv, split on whitespace and run with **no shell**, in the
project's own checkout, bounded by a timeout; a failure is reported
beside the merge and never turns a completed merge back into a failed
one. Without the key nothing is run, and the page says plainly that
deploying is still a hand step. `aide`'s own value is
`dashboard/deploy/install-after-merge.sh` — it reinstalls the shared
scripts and refreshes/restarts the dashboard where one runs.

`AIDE_INSTALL_CMD` is read from `.aide/config` alone, never from the
manifest, since an install command can differ from one machine to the
next.

Everything is optional. Shell scripts read the file via `aide_config_get KEY <project-root>` from
`_aide-spec-lib.sh`.

**The project manifest is the config's team-owned sibling:**
`.aide/project.yaml` describes what the project IS (stack, dependencies,
deployment, logging, statistics, reports, docs) and belongs in git.
`/aide-manifest` drafts and refreshes it; `/aide-analyze` reads it for
project context. Only `.aide/config` is personal and gitignored — never
ignore the whole `.aide/` directory.

---

## Spec storage

The specs root is per-project configuration: `AIDE_SPECS_PATH` in
`.aide/config` in the project root. If the key is set, specs are stored
there (not in the project's `specs/`); when the specs root lies outside
the project root, do **not** run `git add` for specs in the project's
repo (they live in another repo). Without the key, specs go to `specs/`
in the project root. There is no environment variable.
