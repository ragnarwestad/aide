# CLAUDE.md - Aide

Aide is a configuration and tooling repo for AI-assisted development.
It is NOT an application in itself.

---

## Important: Two roles — keep them apart

**Role 1 — Development environment:** We only use Claude Code to work on
this repo. The Claude Code config for this repo lives in `.claude/`.
Other AI tools (Copilot, Codex) are not used for development here.

**Role 2 — Product:** `implementations/` contains source code we build
and install into other projects. There are implementations
for Claude Code, Codex, OpenCode and Copilot.

**Implementation priority:**
1. **Claude Code** — most important
2. **Codex** — second
3. **OpenCode** — third. It brings no model of its own: every model is a
   provider's, named `provider/model`, and none is reachable until a
   provider is logged in. Its implementation is thin because it scans
   `~/.agents/skills` and `~/.claude/skills` for skills itself.
4. **Copilot** — fourth.

---

## Commands

Two toolchains, and each has its own gate. Neither is guessed: the repo
root is pytest and `dashboard/` is bun + TypeScript (see
`.claude/rules/development.md`, "Two toolchains, deliberately separate").

```bash
.venv/bin/pytest                    # the root's gate — the shared scripts,
                                    # the templates, the rules, the skills
cd dashboard && make test           # the dashboard's gate: tsc --noEmit, then bun test
cd dashboard && bun test test/queue/schedule-store.test.ts   # one suite
npx markdownlint-cli2 '**/*.md'     # markdown, from the repo ROOT (the config lives there)
scripts/check-bash                  # shellcheck over core/scripts and the round's bash — run it when a bash script changed
scripts/check-docs                  # the tests that read the documentation, about ten seconds — run it when a page changed
```

**`bun test` transpiles; it does not type-check.** A green `bun test` says
nothing about types, and `make test` exists to stop that being mistaken for
a green build — it runs `bunx tsc --noEmit` first and fails there. Report
the dashboard as green only once `make test` is, since `bun test` alone
says nothing about types.

`scripts/check-bash` needs shellcheck (`brew install shellcheck`); CI (on a
pull request only) runs the same script, so a bash change that passes it
locally passes there.

Both full runs take minutes, not seconds, and grow with the suites. Run
the full suite ONCE, before the commit, in the background; while working,
run only the narrow files that cover the change (`bun test <file>`, or for
`core/` alone `.venv/bin/pytest tests/specs/unit/core/validation`, which
covers the rules, the templates and the skills in seconds).

The dashboard on the serving host runs as a launchd job
(`com.aide-dashboard.serve`), and code reaching `main` changes nothing
there until it is installed: that is what `dashboard/deploy/install-after-merge.sh`
does (`AIDE_INSTALL_CMD`), and it is what an `archive` step runs after it
lands code. Restart it through launchd (`launchctl kickstart -k`), since a
process started by hand with `pkill` + `bun run` is not the service.

---

## Reading the documentation

**Grep the long pages; do not read one whole.** `docs/AI_NEWS_LOG.md` is 800 lines and the dashboard's docs
pages run to 550; they are written to be searched. Where to look:

| Question                                                  | Page                                          | Who it's for      |
|-----------------------------------------------------------|-----------------------------------------------|-------------------|
| What the dashboard is, its URLs, live runs                | `dashboard/README.md`                         | Both              |
| How the queue runs specs, and what it tells you           | `dashboard/docs/running-specs.md`             | Both              |
| What a run does to the repositories and its checkouts     | `dashboard/docs/the-runner.md`                | Changing the code |
| What a row on the specs list says, the spec page          | `dashboard/docs/the-specs-list.md`            | Changing the code |
| Adding a project, whether a run can start there           | `dashboard/docs/projects.md`                  | Both              |
| A job's states and every transition between them          | `dashboard/docs/job-states.md`                | Changing the code |
| The four phases, what moves a spec between them           | `dashboard/docs/spec-lifecycle.md`            | Using the board   |
| How a step's branch is merged, conflicts, unlanded work   | `dashboard/docs/landing.md`                   | Changing the code |
| The one rule every error the board shows follows          | `dashboard/docs/error-sentences.md`           | Changing the code |
| Tokens, components and the CSS class vocabulary           | `dashboard/docs/design-system.md`             | Changing the code |
| Every HTTP route: method, read or action, what it takes   | `dashboard/docs/http-routes.md`               | Changing the code |
| The decisions made twice, in bash and TypeScript          | `dashboard/docs/bash-typescript-decisions.md` | Changing the code |
| The dashboard's own tests, and running it from a checkout | `dashboard/docs/developing.md`                | Changing the code |
| Serving it, HTTPS, moving it to another host              | `dashboard/docs/hosting.md`                   | Running the board |
| Reaching the board from a phone or another computer       | `dashboard/docs/tailscale.md`                 | Running the board |
| The test server a held-back spec offers                   | `dashboard/docs/test-server.md`               | Using the board   |
| Installation layout, what goes where, the gotchas         | `.claude/rules/development.md`                | Changing the code |
| Where the project came from and what is next              | `docs/ROADMAP.md`                             | Both              |
| How Aide compares with other spec-driven tools            | `docs/COMPARISON.md`                          | Both              |
| What each AI tool supports, verified                      | `docs/AI_SUPPORT_MATRIX.md`                   | Changing the code |
| How to write a skill                                      | `docs/SKILL_GUIDE.md`                         | Changing the code |

---

## Important rules

**The workflow steps are skills (slash commands), not CLI scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. run inside the AI tool.
`core/scripts/` holds the helper scripts (`aide-*`) those skills and the runner call.

See `.claude/rules/development.md` for the installation overview, the layout
gotchas and how to add new functionality. The `/ai-tools-reference` skill holds
the verified config reference for Claude Code, Codex and Copilot (not OpenCode); `/ai-tools-upgrade` holds the
daily-upgrade setup for a machine.

See `docs/ROADMAP.md` for where the project came from, the architecture
decisions, and what to work on next (phase 3: genericization, phase 4:
OpenSpec-inspired improvements).
