# Tools and scripts

## Table of contents

- [Skills](#skills)
- [Project commands](#project-commands)
- [Per-project configuration (.aide/config)](#per-project-configuration-aideconfig)
- [Report storage](#report-storage)

---

## Skills

Skills are loaded from `~/.claude/skills/` — use the `/` syntax.

Available skills:

- `/aide-create` - Create JIRA/TODO documentation
- `/aide-analyze` - Analyze the codebase
- `/aide-implement` - Implement with TDD
- `/aide-archive` - Archive a finished report and feed durable knowledge back into the docs
- `/aide-to-pdf` - Render the reports to PDF
- `/tdd-coach` - Test-Driven Development methodology

---

## Project commands

Run the project's own test/lint/build commands **automatically** without asking
the user. Detect them — never assume a toolchain:

1. **Config first:** if `.aide/config` in the project root sets `AIDE_TEST_CMD`,
   `AIDE_LINT_CMD` or `AIDE_BUILD_CMD`, use those.
2. **Otherwise detect** from what the project ships:

| Found in the project root | Toolchain | Typical commands |
|---------------------------|-----------|------------------|
| `pnpm-lock.yaml` | pnpm | `pnpm test -- --run`, `pnpm run lint`, `pnpm run build` |
| `package-lock.json` | npm | `npm test`, `npm run lint`, `npm run build` |
| `yarn.lock` | yarn | `yarn test`, `yarn lint`, `yarn build` |
| `gradlew` | Gradle | `./gradlew test`, `./gradlew build` |
| `pom.xml` | Maven | `mvn test`, `mvn verify` |
| `pytest.ini` / `pyproject.toml` | pytest | `python -m pytest` (prefer the project's venv) |
| `go.mod` | Go | `go test ./...`, `go build ./...` |
| `Cargo.toml` | Cargo | `cargo test`, `cargo build` |

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

| Key | Purpose |
|-----|---------|
| `AIDE_JIRA_BASE_URL` | JIRA root, e.g. `https://jira.mycompany.com` — issue links become `<url>/browse/<KEY>` |
| `AIDE_TEST_CMD` | Overrides the detected test command |
| `AIDE_LINT_CMD` | Overrides the detected lint command |
| `AIDE_BUILD_CMD` | Overrides the detected build command |

Everything is optional: commands fall back to detection, and without
`AIDE_JIRA_BASE_URL` the skills ask the user for the URL instead of guessing.
Shell scripts read the file via `aide_config_get KEY <project-root>` from
`_aide-report-lib.sh`.

---

## Report storage

If `AIDE_REPORTS_PATH` is set, reports are stored there (not in the project's `reports/`).
If the variable is set — do **not** run `git add` for reports (they live in another repo).
