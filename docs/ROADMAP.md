# Roadmap

Where doc-aide came from, what has been decided, and what comes next.
New contributors (human or AI): read this first.

## Table of contents

- [Background](#background)
- [Architecture decisions](#architecture-decisions)
- [Phase 3: Make the tool truly generic](#phase-3-make-the-tool-truly-generic)
- [Phase 4: Ideas borrowed from other tools](#phase-4-ideas-borrowed-from-other-tools)
  - [From OpenSpec](#from-openspec)
  - [From whippletree](#from-whippletree)
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

## Phase 4: Ideas borrowed from other tools

### From OpenSpec

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

### From whippletree

From reading [whippletree](https://github.com/larstonder/whippletree), a Go
CLI that compiles one hook contract onto Claude Code, Codex and opencode. We
are not adopting it — it distributes executable behavior, we distribute
prompts, and it carries a compiled dispatcher per bundle for what is often a
three-line shell script. Three of its ideas are worth taking anyway:

- [ ] **A check step before installing.** `install.sh` installs blind today.
      Add a step (its `preflight`) that probes what is actually installed and
      reports where each piece will land: "Copilot 1.0.11 found → skills are
      read; `~/.claude/rules/` is not read by Copilot, so these rules arrive
      via AGENTS.md instead." Cheap to build, removes a whole class of silent
      misses.
- [ ] **Fidelity levels in the support matrix.** `docs/AI_SUPPORT_MATRIX.md`
      records yes/no per feature. Whippletree's T1–T4 ladder records *how
      well*: enforced by the tool, heuristic, or merely an instruction the
      model usually follows. Our rules land as an enforced hook in Claude Code
      and as plain instructions in Copilot — the matrix should say so.
- [ ] **Stamp versions from probing, not by hand.** The matrix's "last
      verified" line is maintained manually via `/check-news`. Record the
      version each tool actually reports instead.

Related gap the reading exposed: the four hooks in
`implementations/claude-code/settings.json` — markdownlint on markdown, the
`git add .` block, the watch-mode block, and the Stop hook that refuses to end
a turn when code changed without tests — only work in Claude Code. Codex has
hooks too (experimental). Porting them is a hand-written `hooks.json`, not a
reason to adopt whippletree.

## Known quirks

- `reports/` is gitignored; only `reports/README.md` is force-tracked.
- `scripts/generate-toc.py` and `scripts/normalize-reports.py` emit
  "Table of contents" but still *detect* the legacy Norwegian heading
  ("Innholdsfortegnelse") for old reports.
- `AIDE_REPORTS_PATH` (optional) redirects report output to an external
  directory/repo — doc-aide's equivalent of OpenSpec's "Stores" idea.
- The daily cron job `0 8 * * * ~/.local/bin/upgrade-ai-tools`
  upgrades Copilot/Codex/Junie/opencode via mise and Claude Code via
  `claude update`.
