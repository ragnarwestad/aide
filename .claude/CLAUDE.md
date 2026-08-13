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

## Important rules

**aide-* are skills (slash commands), not CLI scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. run inside Claude Code or Copilot.
Only `aide-generate-pdf` and `aide-generate-html` exist as CLI scripts (they run pandoc).

See `.claude/rules/development.md` for directory structure, installation overview
and how to add new functionality.

See `docs/ROADMAP.md` for where the project came from, the architecture
decisions, and what to work on next (phase 3: genericization, phase 4:
OpenSpec-inspired improvements).
