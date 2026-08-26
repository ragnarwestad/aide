# Development in aide

## Repo layout

**`dashboard/` came in with `git subtree add`, and its history is only
reachable through `git blame`.** `git log --follow -- dashboard/<file>`
and plain `git log -- dashboard/<file>` stop at the import commit and
show nothing older — that is how subtree boundaries work, not a sign the
move went wrong. `git blame dashboard/src/discover.ts` does attribute
every line to its original pre-merge commit and author. Measured on a
throwaway repo before the move and confirmed after (spec 85). The
standalone `aide-dashboard` repo is kept as a fallback but no longer
carries a manifest, so it is not a project in its own right anymore.

**Two toolchains, deliberately separate.** The repo root is pytest
(`pytest.ini`, no lockfile); `dashboard/` is bun + TypeScript
(`dashboard/bun.lock`). Project-command detection reads the ROOT only, so
aide's test command stays `pytest` — a `package.json` at the root would
silently redirect it, which
`tests/specs/unit/core/validation/test_dashboard_merge.py` guards
against. Run the dashboard's own suite from inside `dashboard/`:
`bunx tsc --noEmit && bun test`.

**The queue/worktree/merge/archive internals live in `dashboard/CLAUDE.md`
now** (moved 2026-08-26, /doctor check 4), not here — that content only
matters to a session actually working in `dashboard/`, and loads
automatically for one. It also documents `core/scripts/aide-run-spec`.

## Adding new functionality

### New skill

1. Read `docs/SKILL_GUIDE.md` for structure and best practices
2. Create `core/skills/<name>/SKILL.md` with frontmatter and core instructions
3. Put heavy documentation in `core/skills/<name>/references/`
4. Add it to the SKILLS list in uninstall.sh
5. Run `cd implementations/claude-code && ./install.sh`

### Updating rules

1. Edit in `core/rules/` (shared source for all AI tools)
2. Run `core/scripts/build-agents-md.sh` (regenerates `core/AGENTS.md`
   AND `core/skills/spec-structure/SKILL.md`)
3. Run `implementations/claude-code/install.sh` (rules → `~/.claude/rules/`), `implementations/copilot/install.sh` and `implementations/codex/install.sh` (new AGENTS.md → `~/.copilot/` and `~/.codex/`)

**Four of the nine rules are no longer rules (spec 147).** `workflows`,
`documentation`, `tools-and-scripts` and `markdown-linting` are skills in
`core/skills/` now, and `spec-structure` is a rule for Claude Code and a
GENERATED skill for Codex/Copilot. The reason is a byte budget: Codex
appends at most `project_doc_max_bytes` of AGENTS.md — 32768 by default —
and drops the rest silently. At 64399 bytes the file was cut mid-testing.md
and half of it never reached Codex at all, for a month, with nothing to
say so. `test_core_scripts.py::TestBuildAgentsMd::test_output_fits_codex_read_window`
is what says so now. A new rule in `core/rules/` spends that budget; a
new skill in `core/skills/` does not.

Two consequences worth knowing before editing anything here:

- `core/skills/spec-structure/SKILL.md` is generated. Edit
  `core/rules/spec-structure.md` and re-run the build script — never the
  skill directly; `test_core_scripts.py::TestSpecStructureSkillIsGenerated`
  compares the two bodies byte for byte.
- `implementations/claude-code/install.sh` excludes `spec-structure/`
  from its skill rsync by name, so it reaches Codex/Copilot only. That
  exclusion is why `test_core_skills.py::TestUninstallListsEverySkill`
  carries a one-name exception, and it is the third hand-paired list in
  this repo after `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS`.

### Changing the spec structure

The 4-file layout is written down in more places than you would guess.
Spec 82 found them the hard way: fixing the templates alone left
`/aide-analyze` instructing the model to put complexity and risk in
`2-analysis.md`, so the next run rebuilt the bug.

1. `core/rules/spec-structure.md` — the rule itself
2. `core/templates/todo/*.template` — what a new spec starts from
3. `core/skills/aide-create/references/file-templates.md`
4. `core/skills/aide-analyze/SKILL.md` and
   `core/skills/task-workflow-assistant/SKILL.md` — the instructions
   that decide where an AI actually writes what
5. `core/skills/spec-structure/SKILL.md` — generated from item 1 by
   `core/scripts/build-agents-md.sh`; the spec layout left `core/AGENTS.md`
   in spec 147, so this file is where Codex and Copilot read it now
6. `tests/specs/unit/core/validation/test_templates.py` plus the three
   e2e files, which assert the layout

`test_templates.py` enforces items 1-4, so a partial change fails the
suite rather than escaping quietly. Change all six, regenerate,
reinstall.

### install.sh and uninstall.sh

These MUST always mirror each other. When changing one, update the other.

Shared scripts (`core/scripts/` → `~/.local/bin/`) are handled by
`core/scripts/_install-bin.sh` — change the script list *there*, not in each installer.
`install-all.sh` / `uninstall-all.sh` (repo root) run all three in sequence.
