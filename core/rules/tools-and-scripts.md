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
- `/aide-analyze` - Analyze the codebase
- `/aide-review-plan` - Review the plan before implementation (feasibility, scope, coherence)
- `/aide-manifest` - Draft or refresh the project manifest (.aide/project.yaml)
- `/aide-implement` - Implement with TDD
- `/aide-archive` - Archive a finished spec and feed durable knowledge back into the docs
- `/aide-resolve` - Finish a merge the Merge button refused for a conflict, and run the tests
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
| `AIDE_LINT_CMD`       | Overrides the detected lint command                                                                                           |
| `AIDE_BUILD_CMD`      | Overrides the detected build command                                                                                          |
| `AIDE_WORKTREE_LINKS` | Space-separated repo-relative paths a headless run needs but git does not carry — `.venv dashboard/node_modules` and the like |
| `AIDE_INSTALL_CMD`    | What installing this project means on THIS machine — run by the dashboard after the project's own code is merged              |

`AIDE_WORKTREE_LINKS` exists because `aide-run-spec` gives every run a
`git worktree` of its own, and a worktree carries **tracked files only**:
every gitignored path is simply absent. In a project whose test command
lives behind one of them — pytest in `.venv`, a suite needing
`node_modules` — the step then fails for a reason that has nothing to do
with its change. Each listed path is symlinked in from the main checkout
when it exists there, and excluded from the commit. Paths are relative to
the repo root; an absolute path, or one containing `..`, is refused by
name. Which paths matter cannot be derived without guessing, so the
project states them.

`AIDE_INSTALL_CMD` exists because merged is not deployed. For a project
that installs itself somewhere — aide puts its scripts in
`~/.local/bin` — code reaching the default branch changes nothing on
the machine until the install runs, and the dashboard's Merge button
said "merged" while the host went on running the old version. The value
is an argv, split on whitespace and run with **no shell**, in the
project's own checkout, bounded by a timeout; a failure is reported
beside the merge and never turns a completed merge back into a failed
one. Without the key nothing is run, and the page says plainly that
deploying is still a hand step. `aide`'s own value is
`implementations/claude-code/install.sh` — any one of the three per-tool
installers reinstalls the shared scripts, and Claude Code is this repo's
priority-1 tool.

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
