# CLAUDE.md - doc-aide

doc-aide is a configuration and tooling repo for AI-assisted development.
It is NOT an application in itself.

---

## Important: Two roles — do not confuse them

**Role 1 — Development environment:** We only use Claude Code to work on
this repo. The Claude Code config for this repo lives in `.claude/`.
Other AI tools (Copilot, Codex, Gemini) are not used for development here.

**Role 2 — Product:** `implementations/` contains source code we build
and install into other projects. There are implementations
for Claude Code, Copilot, Codex and Gemini.

**Implementation priority:**
1. **Copilot** — most important
2. **Claude Code** — second most important
3. Codex and Gemini — lower priority

---

## Important rules

**aide-* are skills (slash commands), not CLI scripts.**
`/aide-create`, `/aide-analyze`, `/aide-implement` etc. run inside Claude Code or Copilot.
Only `aide-generate-pdf` and `aide-generate-html` exist as CLI scripts (they run pandoc).

See `.claude/rules/development.md` for directory structure, installation overview
and how to add new functionality.
