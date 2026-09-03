---
name: tools-and-scripts
description: >-
  aide's skills, the per-project .aide/config keys, how a project's own
  test/lint/build commands are detected, and where specs are stored.
  Use when: running a project's test, lint or build command; looking up
  which aide skill does what; reading or writing .aide/config; deciding
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

Available skills:

- `/aide-explore` - No-stakes thinking partner before a spec exists (creates nothing)
- `/aide-create` - Create JIRA/TODO documentation
- `/aide-analyze` - Analyze the codebase, then review the plan (feasibility, scope, coherence)
- `/aide-manifest` - Draft or refresh the project manifest (.aide/project.yaml)
- `/aide-implement` - Implement with TDD
- `/aide-archive` - Resolve any merge conflict on the branch, then archive the spec and feed durable knowledge back into the docs
- `/aide-to-pdf` - Render the specs to PDF
- `/tdd-coach` - Test-Driven Development methodology

---

## Project commands

Run the project's own test/lint/build commands **automatically** without asking
the user. Detect them — never assume a toolchain:

1. **Config first:** if `.aide/config` in the project root sets `AIDE_TEST_CMD`,
   `AIDE_LINT_CMD` or `AIDE_BUILD_CMD`, use those.
2. **Otherwise detect** from what the project ships:

| Found in the project root       | Toolchain | Typical commands                                        |
|---------------------------------|-----------|---------------------------------------------------------|
| `pnpm-lock.yaml`                | pnpm      | `pnpm test -- --run`, `pnpm run lint`, `pnpm run build` |
| `package-lock.json`             | npm       | `npm test`, `npm run lint`, `npm run build`             |
| `yarn.lock`                     | yarn      | `yarn test`, `yarn lint`, `yarn build`                  |
| `gradlew`                       | Gradle    | `./gradlew test`, `./gradlew build`                     |
| `pom.xml`                       | Maven     | `mvn test`, `mvn verify`                                |
| `pytest.ini` / `pyproject.toml` | pytest    | `python -m pytest` (prefer the project's venv)          |
| `go.mod`                        | Go        | `go test ./...`, `go build ./...`                       |
| `Cargo.toml`                    | Cargo     | `cargo test`, `cargo build`                             |

For JS/TS projects, read `package.json` `scripts` for the exact names — the
table's commands are the usual defaults, not a promise. Test runners must run
in single-run mode, never watch mode (see the testing rules).

**A subdirectory with its own toolchain: `testScopes`.** Detection reads the
project ROOT, so it finds ONE command for the whole repository. A project
whose subdirectory has a toolchain of its own says so in its manifest:

```yaml
# <project>/.aide/project.yaml
testScopes:
  - path: dashboard
    command: cd dashboard && make test
```

Given the files a change touches, sort them into buckets and run every
bucket's command that has at least one file in it:

- A file matches a scope when it **is** the scope's `path` or lies under it
  as a directory — `dashboard` itself, or `dashboard/src/serve.ts`. It is a
  directory boundary, never a bare string prefix: `dashboard-notes.md` at
  the root matches nothing and belongs to the root command.
- When a file could match more than one scope, the **first** entry in the
  manifest's own list order wins.
- A file matching no scope belongs to the **root** command — whatever
  `AIDE_TEST_CMD` or the table above resolves to.
- An absent `testScopes:` list changes nothing: one command covers
  everything, exactly as before.

A change reaching both halves runs both commands. Nothing is skipped for
being slow — only for covering nothing the change touched.

**When to run what:**

- New files created → Run `git add <file>` automatically
- Implementation done → Run the project's test/typecheck/lint commands automatically

---

## Per-project configuration (.aide/config)

Optional file in the project root: `.aide/config`, plain `KEY=value` lines
with `#` comments. Recognized keys:

| Key                   | Purpose                                                                                                                       |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------|
| `AIDE_JIRA_BASE_URL`  | JIRA root, e.g. `https://jira.mycompany.com` — issue links become `<url>/browse/<KEY>`                                        |
| `AIDE_TEST_CMD`       | Overrides the detected test command                                                                                           |
| `AIDE_TEST_SCOPE_PATHS_N` | Space-separated repo-relative directories of scope `N` (1-based) — the config-file form of the manifest's `testScopes:` rule, matched on directory boundaries. With scope 1 declared, `aide-resolve-test-cmd` runs the scopes a change's files fall under and only those; a change under no scope runs every scope's command |
| `AIDE_TEST_SCOPE_CMD_N`   | The full test command for scope `N` — the pair replaces `AIDE_TEST_CMD` for the archive gate and `/aide-implement`'s own run |
| `AIDE_LINT_CMD`       | Overrides the detected lint command                                                                                           |
| `AIDE_BUILD_CMD`      | Overrides the detected build command                                                                                          |
| `AIDE_WORKTREE_LINKS` | LEGACY. Read only when `.aide/project.yaml` has no `worktreeLinks:` — see below                                    |
| `AIDE_INSTALL_CMD`    | What installing this project means on THIS machine — run by the dashboard after the project's own code is merged              |

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

They are in the manifest rather than in `.aide/config` because they are
true of the project on ANY machine, while `.aide/config` is kept out of
git — so the answer was lost every time the project met a new machine.
`.aide/config`'s older `AIDE_WORKTREE_LINKS` is still read
when the manifest names none; the manifest wins where both do, and the
run's own output says which file it read.

`AIDE_INSTALL_CMD` exists because merged is not deployed. For a project
that installs itself somewhere — aide puts its scripts in
`~/.local/bin` — code reaching the default branch changes nothing on
the machine until the install runs. The value
is an argv, split on whitespace and run with **no shell**, in the
project's own checkout, bounded by a timeout; a failure is reported
beside the merge and never turns a completed merge back into a failed
one. Without the key nothing is run, and the page says plainly that
deploying is still a hand step. `aide`'s own value is
`dashboard/deploy/install-after-merge.sh` — it reinstalls the shared
scripts and refreshes/restarts the dashboard where one runs.

`AIDE_INSTALL_CMD` and `AIDE_TEST_CMD` are also readable from the
project's **manifest** (`installCmd:` / `testCmd:`), with
`.aide/config` overriding per machine when it sets the key —
**the reverse of `worktreeLinks`'s precedence**: an install or test
command can legitimately differ on one machine (a `PATH` prefix a shell
needs, say), while a worktree link cannot. A project whose value never
changes between machines can commit it once in the manifest and skip
configuring `.aide/config` for it on every clone. Shell scripts resolve
this precedence with `aide_resolve_override CONFIG_KEY MANIFEST_KEY
<project-root>` in `_aide-spec-lib.sh`; the dashboard resolves it with
`resolveInstallCmd()`/`resolveTestCmd()` in
`dashboard/src/project/discover/config.ts`.

Everything is optional: commands fall back to detection, and without
`AIDE_JIRA_BASE_URL` the skills ask the user for the URL instead of guessing.
Shell scripts read the file via `aide_config_get KEY <project-root>` from
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
