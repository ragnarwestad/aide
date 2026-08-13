# Roadmap

Where aide came from, what has been decided, and what comes next.
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

aide started as *melosys-aide*, an internal AI-tooling workspace for a
NAV project. In July 2026 it was extracted into this repo with a clean
history, stripped of all domain content, translated from Norwegian to
English, and slimmed down. The git history documents each step.

The repo initially carried a "doc-" prefix; it was dropped in August 2026
because the tool had outgrown documents — it installs rules, skills,
agents and hooks, and the specs are just one of its outputs.

The documents themselves were renamed from "reports" to "specs" in August
2026 (spec 72 in aide-specs), following the documents repo's rename to
aide-specs: they are specifications more than reports. The old technical
identifiers are banned by `tests/specs/unit/validation/test_spec_vocabulary.py`.

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
  imperative mood; spec files are `1-description.md`, `2-analysis.md`,
  `3-solution.md`, `4-status.md` with strict content separation.
- **Skill frontmatter is additive-only** (spec 71 in aide-specs, August
  2026): beyond the Agent Skills spec's six fields, only Claude Code extras
  whose absence costs a nicety (`effort`, `argument-hint`) — enforced by an
  allowlist test. Behavior-critical fields are banned; that class of
  divergence is what made `disable-model-invocation` block "ask the
  assistant in prose" while Copilot/Codex ignored the field entirely.

## Phase 3: Make the tool truly generic

The content is generic, but some behavior was still shaped by its origin.
Done in August 2026:

- [x] **JIRA keys need no configuration.** Skills and scripts now recognize
      any JIRA key by pattern (`[A-Z][A-Z0-9]*-[0-9]+`) instead of the
      `PROJ-` example prefix. `PROJ-` remains in illustrative examples only.
- [x] **Project-agnostic commands.** Test/lint/build commands are detected
      from what the project ships (lockfiles, gradlew, pom.xml, …) — see
      "Project commands" in `core/rules/tools-and-scripts.md`. The pnpm
      blocks in skills are labeled examples.
- [x] **Per-project setup.** Optional `.aide/config` in the project root
      (KEY=value): `AIDE_JIRA_BASE_URL` plus `AIDE_TEST_CMD`/`AIDE_LINT_CMD`/
      `AIDE_BUILD_CMD` overrides. Shell scripts read it via `aide_config_get`
      in `_aide-spec-lib.sh`. No init step — the file is created the first
      time a skill needs a value it cannot detect.

## Phase 4: Ideas borrowed from other tools

### From OpenSpec

From the comparison with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
(see its docs/overview.md for the concepts):

- [x] **Archive step that closes the loop.** Done August 2026: `/aide-archive`
      verifies `4-status.md`, feeds durable knowledge back into the project's
      living docs, stamps the date in `4-status.md` and moves the folder to
      `<specs-root>/archive/` with its name unchanged (the date lives in
      the status file, so resolution stays unambiguous). Numbers are never
      reused — `aide_next_spec_number` scans `archive/` too, and the
      pdf/html scripts fall back to `archive/` when resolving.
- [x] **Delta thinking in requirements.** Done August 2026: `3-solution.md`
      has a "Behavior delta" section — what the solution ADDS / MODIFIES /
      REMOVES in behavior relative to today, distinct from the analysis's
      file scope.
- [x] **Given/when/then acceptance criteria** in `3-solution.md`. Done
      August 2026, and the criteria moved OUT of `1-description.md` at the
      same time (the strict separation says the description is only the
      problem as reported). The RED phase writes at least one failing test
      per criterion — wired into aide-analyze and aide-implement.
- [x] **Explore step.** Done August 2026: `/aide-explore` — a thinking
      partner that creates nothing (reading the codebase is encouraged,
      writing is banned), lays out approaches with trade-offs including
      "do nothing", shrinks the scope, and ends with an offer to hand the
      sharpened conclusion to `/aide-create`.

### From whippletree

From reading [whippletree](https://github.com/larstonder/whippletree), a Go
CLI that compiles one hook contract onto Claude Code, Codex and opencode. We
are not adopting it — it distributes executable behavior, we distribute
prompts, and it carries a compiled dispatcher per bundle for what is often a
three-line shell script. Three of its ideas are worth taking anyway:

- [x] **A check step before installing.** Done August 2026:
      `core/scripts/aide-preflight` probes each CLI (version or not-found),
      reports where every piece lands and whether the target exists, and
      explains the cross-tool paths (Copilot reads skills from
      `~/.claude/skills/`; rules reach Copilot/Codex via AGENTS.md). Each
      installer runs it first; informational only, never blocks. Also ships
      to `~/.local/bin` for standalone runs.
- [x] **Fidelity levels in the support matrix.** Done August 2026: the
      matrix defines an E/H/I ladder (Enforced by the tool / Heuristic
      tool feature / Instruction the model usually follows) and grades how
      each aide piece lands per tool in "How the aide pieces land" —
      e.g. rules are E in Claude Code but I in Copilot/Codex.
- [x] **Stamp versions from probing, not by hand.** Done August 2026:
      `scripts/stamp-versions` asks each CLI and stamps the "Supported
      versions" table with what the tool actually reports; a missing tool
      keeps its old row. `/check-news` now points to the script instead of
      hand-editing.

Related gap the reading exposed — closed August 2026: the four hooks in
`implementations/claude-code/settings.json` — markdownlint on markdown, the
`git add .` block, the watch-mode block, and the Stop hook that refuses to end
a turn when code changed without tests — are ported to Codex as
`implementations/codex/hooks/` (a `hooks.json` plus five shell scripts,
installed to `~/.codex/`). The Stop guard needed a different construction:
Codex has no prompt hooks, so PostToolUse markers ("code changed" /
"tests run") are written per turn and judged by a command hook at Stop.
All four verified in live `codex exec` sessions against 0.147.0.

## Known quirks

- `specs/` is gitignored; only `specs/README.md` is force-tracked.
- `scripts/generate-toc.py` and `scripts/normalize-specs.py` emit
  "Table of contents" but still *detect* the legacy Norwegian heading
  ("Innholdsfortegnelse") for old specs.
- `AIDE_SPECS_PATH` (optional) redirects spec output to an external
  directory/repo — aide's equivalent of OpenSpec's "Stores" idea.
- The daily cron job `0 8 * * * ~/.local/bin/upgrade-ai-tools`
  upgrades Copilot/Codex/opencode via mise and Claude Code via
  `claude update`.
