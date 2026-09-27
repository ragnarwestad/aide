# Sources on writing specs for AI agents

## Table of contents

- [Articles and guides](#articles-and-guides)
- [Spec formats and methods](#spec-formats-and-methods)
- [Spec-driven workflows](#spec-driven-workflows)
- [Already compared](#already-compared)

---

Sources on what a spec for an AI coding agent should say and how it should be written, gathered to be analysed
before Aide's spec files and skills are changed. Each entry is described from its own page or from the list it was
found in; none has been analysed against Aide yet. Tools that only sit around a spec — boards, editors, MCP
servers — are left out; [awesome-spec-driven-development](https://github.com/Engineering4AI/awesome-spec-driven-development)
and [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) list those.

---

## Articles and guides

- [How to write a good spec for AI agents](https://www.oreilly.com/radar/how-to-write-a-good-spec-for-ai-agents/)
  (Addy Osmani, O'Reilly) — six areas a spec covers: commands, testing, project structure, code style, git
  workflow and boundaries. Boundaries in three tiers: always do, ask first, never do. Context fed in modules,
  self-checks against the spec, conformance tests derived from it, and the agent's actions logged to find where
  the spec was misread.
- [What Is Spec-Driven Development? A Practitioner's Guide](https://felipefontoura.com/articles/what-is-spec-driven-development)
  (Felipe Fontoura) — what a spec is, four pillars, the EARS requirement format, a full worked spec, and when to
  skip writing one.
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices) (Anthropic) — the agentic loop,
  CLAUDE.md, and working patterns.

## Spec formats and methods

- [lean-spec](https://github.com/codervisor/lean-spec) — a spec kept under 2,000 tokens, for people and agents
  alike.
- [MySpec](https://myspec.dev) — a discovery interview compiled into four files: constitution, requirements,
  solution and tasks.
- [agents.md](https://github.com/agentsmd/agents.md) — the shared markdown format for instructions to agents.
- [fspec](https://github.com/sengac/fspec) — Gherkin specs that generate tests and link code to business rules.
- [Kibi](https://github.com/Looted/kibi) — requirements linked to code and tests, with missing links reported as
  agents work.
- [reqlan](https://github.com/littletuna4/reqlan) — a requirements graph beside the code, linked to symbols and
  tests.
- [spec-driver](https://github.com/davidlee/spec-driver) — evergreen specs that emit deltas for the code to
  conform to.
- [quint-code](https://github.com/m0n0x41d/quint-code) — hypothesis-driven specs with records of the design
  rationale.
- [adversarial-spec](https://github.com/zscole/adversarial-spec) — several models debate a spec until it holds.
- [THROUGHLINE](https://github.com/hellomyoh/throughline) — personas debate each spec before code, and an
  append-only record carries decisions across sessions.
- [Squelette](https://github.com/JyMinet/squelette) — a work item names the paths it may touch, a pre-commit gate
  refuses anything else, and a task closes only on evidence checked against what it delivered.
- [Upkeep](https://github.com/wei18/Upkeep) — reports drift between docs or specs and the code, and changes
  nothing.
- [AI Research Skills](https://github.com/WenyuChiou/ai-research-skills) — each stage hands the next a deliverable
  in a fixed schema, and a claim with nothing behind it is marked as a gap.
- [Fullstack Dev Skills](https://github.com/jeffallan/claude-skills) — `/common-ground` has the agent state its
  hidden assumptions about the project before it starts.

## Spec-driven workflows

- [agent-skills](https://github.com/addyosmani/agent-skills) (Addy Osmani) — spec, plan and build as skills, with
  quality gates between them.
- [pi-sdd-kit](https://github.com/felipefontoura/pi-sdd-kit) (Felipe Fontoura) — PRD, spec, tasks and review, each
  approved before the next; steering documents as lasting memory; EARS requirements.
- [cc-sdd](https://github.com/gotalab/cc-sdd) — requirements, design and tasks written alongside the code.
- [mattpocock/skills](https://github.com/mattpocock/skills) — PRD, planning, TDD and architecture skills.
- [Superpowers](https://github.com/obra/superpowers) — brainstorm, a written plan, then execution with TDD and
  review.
- [Claude CodePro](https://github.com/maxritter/claude-codepro) — spec-driven, with TDD enforced and quality hooks.
- [AB Method](https://github.com/ayoubben18/ab-method) — a large problem cut into small, incremental missions.
- [Claude Code PM](https://github.com/automazeio/ccpm) — PRD, epic and tasks, with GitHub issues as the record.
- [RIPER](https://github.com/tony/claude-code-riper-5) — research, innovate, plan, execute and review, each phase
  kept strictly apart.
- [awesome-ralph](https://github.com/snwfdhmp/awesome-ralph) — agents run in a loop until the spec is met.
- [gstack](https://github.com/garrytan/gstack) — from idea to production as one workflow.

## Already compared

[COMPARISON.md](COMPARISON.md) compares Aide with OpenSpec, GitHub Spec Kit, AWS Kiro, BMAD-METHOD, GSD, Tessl,
Cursor's Plan Mode and Augment Code as tools. What their specs themselves contain is part of the analysis these
sources are gathered for.
