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
  - [From OpenGeni](#from-opengeni)
- [Phase 5: The dashboard — toward spec-driven, observable runs](#phase-5-the-dashboard--toward-spec-driven-observable-runs)
- [Known quirks](#known-quirks)

---

## Background

aide started as an internal AI-tooling workspace for a customer
project. In July 2026 it was extracted into this repo with a clean
history, stripped of all domain content, translated from Norwegian to
English, and slimmed down. The git history documents each step.

The repo initially carried a "doc-" prefix; it was dropped in August 2026
because the tool had outgrown documents — it installs rules, skills,
agents and hooks, and the specs are just one of its outputs.

The documents themselves were renamed from "reports" to "specs" in August
2026 (spec 72 in aide-specs), following the documents repo's rename to
aide-specs: they are specifications more than reports. The old technical
identifiers are banned by `tests/specs/unit/validation/test_spec_vocabulary.py`.

A frozen copy of the original customer workspace exists locally as
reference only — do not develop there.

## Architecture decisions

- **Three supported tools, via shared standards:** Claude Code and GitHub
  Copilot both read the skills in `~/.claude/skills/`; Copilot and Codex
  both read the generated `core/AGENTS.md` (installed as
  `~/.copilot/copilot-instructions.md` and `~/.codex/AGENTS.md`).
  Priority: Claude Code > Codex > Copilot — Copilot is PARKED since
  August 2026: the customer-provided subscription lapsed, so every model
  call is refused by policy and the implementation cannot be tested or
  verified. It stays in the repo (self-contained, harmless) awaiting a
  new subscription. Gemini support and all
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
- **claude-usage is consumed, never modified** (spec 80, August 2026).
  `~/develop/claude-usage` is a pristine clone of RuneLind/claude-usage
  — an actively developed personal tool with no support promise.
  aide's dashboard reads its HTTP API (`/api/live`: session state,
  subagents, `sessionCostUSD` in one row) and keeps every aide-specific
  receiver in aide-dashboard. Patching claude-usage would be permanent
  fork drift. Two facts that bit: its server on the mini binds its
  Tailscale IP only (not localhost), and its `/api/live` advances live
  state on each poll — so poll it lazily, never on a standing timer.

## Phase 3: Make the tool truly generic

The content is generic, but some behavior was still shaped by its origin.
Done in August 2026:

- [x] **JIRA keys need no configuration.** Skills and scripts now recognize
      any JIRA key by pattern (`[A-Z][A-Z0-9]*-[0-9]+`) instead of the
      `PROJ-` example prefix. `PROJ-` remains in illustrative examples only.
- [x] **Project-agnostic commands.** Test/lint/build commands are detected
      from what the project ships (lockfiles, gradlew, pom.xml, …) — see
      "Project commands" in `core/skills/tools-and-scripts/SKILL.md`. The pnpm
      blocks in skills are labeled examples.
- [x] **Per-project setup.** Optional `.aide/config` in the project root
      (KEY=value): `AIDE_JIRA_BASE_URL`, `AIDE_SPECS_PATH` (spec 73) plus
      `AIDE_TEST_CMD`/`AIDE_LINT_CMD`/`AIDE_BUILD_CMD` overrides. Shell
      scripts read it via `aide_config_get` in `_aide-spec-lib.sh`. No init
      step — the file is created the first time a skill needs a value it
      cannot detect.

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

### From OpenGeni

From reading [OpenGeni](https://github.com/Cloudgeni-ai/opengeni), an
Apache-2.0 runtime for long-running agent sessions (durable event log in
Postgres, Temporal for orchestration, human approvals before tool use,
sessions that run on an enrolled machine of your own). It is not a tool we
would install — it is a whole product, and running it means running
Postgres, Temporal, NATS and S3 storage — but it is the closest thing we
have found to a serious answer to the problem the dashboard is circling:
what a headless agent run IS as durable state.

It is also worth knowing HOW it was built, because that is what makes its
conventions interesting. The public repo opens with "Initial OpenGeni open
source release" on 12 May 2026 and carries 2234 commits by 19 August —
roughly 1.29 million lines of TypeScript, 302 database migrations, 1180
test files — with one dominant human author and `Co-authored-by: Cursor`
on nearly every commit. The disciplines below are what a project reaches
for when a machine writes the code faster than anyone can read it, which
is the same position we are in.

- [ ] **A commit body that says what was wrong and what stays unchanged.**
      `core/rules/git.md` fixes the subject line (English, imperative) and
      then says only "Optional: why, context, or details" about the body.
      OpenGeni's bug-fix commits have a fixed shape worth copying: what the
      wrong behavior was, the mechanism that caused it, what the
      consequence was for a user, and — the part we have nothing about —
      what deliberately does NOT change. That last clause is what stops the
      next reader from undoing something that was intentional.
- [ ] **One canonical map, updated in the same change.** OpenGeni's
      `CLAUDE.md` points at a single `docs/architecture.md` and states the
      rule: if a change alters the shape of the system, the map is updated
      in that same change — "a stale map is a bug". It carries a "changing
      X, read Y first" table. We have the content of that table already, as
      prose warnings in `.claude/rules/development.md` (the two duplicated
      step lists, `repos[].root` vs `repos[].worktree`, the six places the
      spec layout is written down). Turn it into an actual table, and add
      the same-change rule.
- [ ] **A run that can ask a question and resume where it stopped.**
      `aide-run-spec` today can only guess or fail when something is
      genuinely unclear. OpenGeni lets an in-flight agent request a
      validated answer and resume that exact tool call afterwards — or on
      an allowed skip, an expiry, or a restart. The full mechanism is more
      than we need; the small version is a job that parks itself as
      `waiting` with its question on the row, and a reply field on the
      dashboard.
- [ ] **An append-only event log, not a last-state mirror.**
      `dashboard/src/queue.ts` writes the current state of every job to a
      JSON file, and `aide-emit-run` posts phase boundaries with
      `curl --max-time 1` in the background — deliberately without any
      guarantee of arrival. So there is no history to replay: a dropped
      post is gone, and reloading the page does not reconstruct what
      happened. OpenGeni appends every event to the log first and streams
      from it, so a reload, a second client and an audit all replay the
      same history. We do not need Postgres for that — a `runs/<id>.jsonl`
      appended to would do.
- [ ] **The anti-lesson: cap the file size before a barrel grows.**
      `packages/db/src/index.ts` is 62 487 lines with 1134 exports, because
      nothing enforces module boundaries and an assistant just appends at
      the end. Our largest are `dashboard/src/serve.ts` at 1778 lines and
      `queue.ts` at 744 — not a problem yet, and `serve.ts` is the one that
      grows the same way. A test that fails when a file under
      `dashboard/src/` passes a ceiling is the same mechanism that already
      pins the two duplicated step lists to each other.

## Phase 5: The dashboard — toward spec-driven, observable runs

The long-term direction (August 2026): write specifications that agents
solve over hours, and have ONE web UI with overview and control —
projects, running processes, approvals, cost. Three layers: knowledge
(what each project is), state (what is running and how far), execution
(starting and gating runs).

The plan and the backlog live as specs in aide-specs — the detail is
THERE, not here (we eat our own dog food):

- [x] Stage 0 — plan review step → spec 77 (done August 2026: `/aide-review-plan`)
- [x] Stage 1 — project manifest → spec 78 (done August 2026: `/aide-manifest` + `.aide/project.yaml`)
- [x] Stage 2 — read-only dashboard → spec 79 (done August 2026: the
      `aide-dashboard` repo — static generator on the laptop reading
      the manifests and specs roots, served on the serving host)
- [x] Stage 3 — live process events → spec 80 (done August 2026:
      `aide-emit-run` hook + the aide-dashboard server's `/live`, enriched
      read-only from claude-usage's `/api/live`)
- [x] Stage 4 — queue and runner → spec 81 (done August 2026: aide's
      `aide-run-spec` runs one workflow step headless with its guards and
      caps; the aide-dashboard `/queue` page, scheduler, gates,
      notifications and `push = none | branch | pr` drive it from the
      mac mini. `aide-emit-run --phase` reports the TDD boundaries from
      inside a run)
- [x] Stage 5 — HTTPS and one address → spec 172 (done August 2026: the
      server binds `127.0.0.1` and a `tailscale serve` proxy set up by
      `make install-serve` puts TLS in front of it, so the dashboard has
      one address and it is a secure context — which is what an
      installable app needs)

The wish list and the grounding are in spec 76 (archived).

## Known quirks

- `specs/` is gitignored; only `specs/README.md` is force-tracked.
- `scripts/generate-toc.py` and `scripts/normalize-specs.py` emit
  "Table of contents" but still *detect* the legacy Norwegian heading
  ("Innholdsfortegnelse") for old specs.
- `AIDE_SPECS_PATH` in a project's `.aide/config` (optional) redirects
  that project's spec output to an external directory/repo — aide's
  equivalent of OpenSpec's "Stores" idea, scoped per project since
  spec 73 (the global environment variable is retired). Convention when
  several projects share one specs repo: one subfolder per project
  (`aide-specs/<project>/`), each with its own number sequence and
  `archive/` — pointing every project at the repo ROOT would recreate
  the shared pool.
- The daily cron job `0 8 * * * ~/.local/bin/upgrade-ai-tools`
  upgrades Copilot/Codex/opencode via mise and Claude Code via
  `claude update`.
