# CLAUDE.md - aide

aide is a configuration and tooling repo for AI-assisted development.
It is NOT an application in itself.

---

## Important: Two roles — do not confuse them

**Role 1 — Development environment:** We only use Claude Code to work on
this repo. The Claude Code config for this repo lives in `.claude/`.
Other AI tools (Copilot, Codex) are not used for development here.

**Role 2 — Product:** `implementations/` contains source code we build
and install into other projects. There are implementations
for Claude Code, Copilot and Codex.

**Implementation priority:**
1. **Claude Code** — most important
2. **Codex** — second
3. Copilot — PARKED since August 2026 (no subscription; the customer-provided
   one lapsed). The implementation stays but is untestable and unverified
   until a subscription exists again.

---

## Commands

Two toolchains, and each has its own gate. Neither is guessed: the repo
root is pytest and `dashboard/` is bun + TypeScript (see
`.claude/rules/development.md`, "Two toolchains, deliberately separate").

```bash
.venv/bin/pytest                    # the root's gate — the shared scripts,
                                    # the templates, the rules, the skills
cd dashboard && make test           # the dashboard's gate: tsc --noEmit, then bun test
cd dashboard && bun test test/queue.test.ts   # one suite
npx markdownlint-cli2 '**/*.md'     # markdown, from the repo ROOT (the config lives there)
```

**`bun test` transpiles; it does not type-check.** A green `bun test` says
nothing about types, and `make test` exists to stop that being mistaken for
a green build — it runs `bunx tsc --noEmit` first and fails there. Never
report the dashboard as green off `bun test` alone.

The full pytest run takes about three minutes; the dashboard's about
seventy seconds. For a change that only touches `core/`, the narrower
`.venv/bin/pytest tests/specs/unit/core/validation` takes about two seconds
and covers the rules, the templates and the skills.

The dashboard on the serving host runs as a launchd job
(`com.aide-dashboard.serve`), and code reaching `main` changes nothing
there until it is installed: that is what `dashboard/deploy/install-after-merge.sh`
does (`AIDE_INSTALL_CMD`), and it is what an `archive` step runs after it
lands code. Never restart it by hand with `pkill` + `bun run` — a
hand-started process is not the service.

---

## Reading the documentation

**Grep the long pages; do not read one whole.**
`dashboard/docs/running-specs.md` is 980 lines and `docs/AI_NEWS_LOG.md`
650; both are written to be searched. Where to look:

| Question | Page |
|---|---|
| What the dashboard is, its URLs, live runs | `dashboard/README.md` |
| How the queue, the runner, branches and landing work | `dashboard/docs/running-specs.md` |
| Tokens, components and the CSS class vocabulary | `dashboard/docs/design-system.md` |
| Serving it, HTTPS, moving it to another host | `dashboard/docs/deploying.md` |
| Installation layout, what goes where, the gotchas | `.claude/rules/development.md` |
| Where the project came from and what is next | `docs/ROADMAP.md` |
| What each AI tool supports, verified | `docs/AI_SUPPORT_MATRIX.md` |
| How to write a skill | `docs/SKILL_GUIDE.md` |

---

## Important rules

**aide-* are skills (slash commands), not CLI scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. run inside Claude Code or Copilot.
Only `aide-generate-pdf` and `aide-generate-html` exist as CLI scripts (they run pandoc).

See `.claude/rules/development.md` for the installation overview, the layout
gotchas and how to add new functionality. The `/ai-tools-reference` skill holds
the verified config reference for all three tools; `/ai-tools-upgrade` holds the
daily-upgrade setup for a machine.

See `docs/ROADMAP.md` for where the project came from, the architecture
decisions, and what to work on next (phase 3: genericization, phase 4:
OpenSpec-inspired improvements).
