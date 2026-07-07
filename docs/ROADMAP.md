# Roadmap

Where doc-aide came from, what has been decided, and what comes next.
New contributors (human or AI): read this first.

## Table of contents

- [Background](#background)
- [Architecture decisions](#architecture-decisions)
- [Phase 3: Make the tool truly generic](#phase-3-make-the-tool-truly-generic)
- [Phase 4: OpenSpec-inspired improvements](#phase-4-openspec-inspired-improvements)
- [Known quirks](#known-quirks)

---

## Background

doc-aide started as *melosys-aide*, an internal AI-tooling workspace for a
NAV project. In July 2026 it was extracted into this repo with a clean
history, stripped of all domain content, translated from Norwegian to
English, and slimmed down. The git history documents each step.

The frozen original lives at `~/develop/nav/melosys-aide` (local reference
only — do not develop there).

## Architecture decisions

- **Three supported tools, via shared standards:** Claude Code and GitHub
  Copilot both read the skills in `~/.claude/skills/`; Copilot and Codex
  both read the generated `core/AGENTS.md` (installed as
  `~/.copilot/copilot-instructions.md` and `~/.codex/AGENTS.md`).
  Priority: Claude Code > Copilot > Codex. Gemini support and all
  per-tool extras (JetBrains templates, VS Code tasks, Codex CLI wrappers)
  were deliberately dropped — hand-maintained per-tool adapters were the
  main maintenance cost. Inspired by OpenSpec's engine/adapter split.
- **`core/` is the product.** Skills, rules, scripts and templates live
  there once. `implementations/` holds only thin install scripts.
- **`core/AGENTS.md` is generated** by `core/scripts/build-agents-md.sh`
  from `core/agents-intro.md` + `core/rules/`. Never edit it by hand.
- **Individual uninstallers keep the shared `~/.local/bin` scripts.**
  Only `uninstall-all.sh` removes them (learned the hard way — removing
  one tool used to break the others and the daily cron job).
- **Conventions:** English throughout; commit messages in English
  imperative mood; report files are `1-description.md`, `2-analysis.md`,
  `3-solution.md`, `4-status.md` with strict content separation.

## Phase 3: Make the tool truly generic

The content is generic, but some behavior is still shaped by its origin:

- [ ] **Configurable JIRA prefix.** Skills and scripts detect JIRA issues
      by a `PROJ-` example prefix. Make the prefix (and JIRA base URL)
      per-project configuration instead of hardcoded examples.
- [ ] **Project-agnostic commands.** Test/lint/build commands in skills
      assume a pnpm/Vitest frontend or Kotlin backend. Detect or configure
      per project.
- [ ] **Per-project setup.** Consider a small init step (or convention)
      for project-level config: JIRA prefix, test commands, reports path.

## Phase 4: OpenSpec-inspired improvements

From the comparison with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
(see its docs/overview.md for the concepts):

- [ ] **Archive step that closes the loop.** OpenSpec's key trick: when a
      change is done, its delta merges back into a persistent source of
      truth (`specs/`), and the change folder is archived with a date
      stamp. doc-aide reports are write-only today — nothing feeds back
      into living documentation. Design an `aide-archive` step.
- [ ] **Delta thinking in requirements.** Describe what a change ADDS /
      MODIFIES / REMOVES relative to current behavior, not just which
      files change.
- [ ] **Given/when/then acceptance criteria** in `3-solution.md` —
      testable scenarios map directly to the TDD cycle we already require.
- [ ] **Explore step.** A no-stakes thinking-partner mode before
      `/aide-create` (OpenSpec's `/opsx:explore`).

## Known quirks

- `reports/` is gitignored; only `reports/README.md` is force-tracked.
- `scripts/generate-toc.py` and `scripts/normalize-reports.py` emit
  "Table of contents" but still *detect* the legacy Norwegian heading
  ("Innholdsfortegnelse") for old reports.
- `AIDE_REPORTS_PATH` (optional) redirects report output to an external
  directory/repo — doc-aide's equivalent of OpenSpec's "Stores" idea.
- The daily cron job `0 8 * * * ~/.local/bin/mise-upgrade-ai-tools`
  upgrades Copilot/Codex/Junie/opencode via mise and Claude Code via
  `claude update`.
