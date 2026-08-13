# Guide: Writing good skills

Internal guide. Combines Anthropic's official recommendations with
practical experience from large skill collections (30+ skills in
production use).

## Table of contents

- [Official sources](#official-sources)
- [File structure and progressive disclosure](#file-structure-and-progressive-disclosure)
- [The description field](#the-description-field)
- [Skill types](#skill-types)
- [What separates good skills from mediocre ones](#what-separates-good-skills-from-mediocre-ones)
- [Anti-patterns matter most](#anti-patterns-matter-most)
- [Debugging queries](#debugging-queries)
- [Size and depth](#size-and-depth)
- [Checklist for new and existing skills](#checklist-for-new-and-existing-skills)
- [Examples to study](#examples-to-study)

---

## Official sources

Read these first — we do not repeat their content here:

- [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf) — Anthropic's complete guide (28 pages)
- [How to Create Custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) — technical requirements and best practices
- [skill-creator plugin](https://claude.com/plugins/skill-creator) — interactive tool for creating, testing and iterating on skills
- [agentskills.io](https://agentskills.io) — open standard for portable skills across AI tools

---

## File structure and progressive disclosure

Anthropic describes three levels of loading:

| Level | What | When it is loaded |
|------|-----|----------------|
| 1. Frontmatter | `name` + `description` | Always (in the system prompt) |
| 2. SKILL.md body | Core instructions | When Claude thinks the skill is relevant |
| 3. `references/` | Heavy documentation | When Claude needs details |

**Consequence:** Keep SKILL.md focused on core instructions. Move heavy
documentation (SQL queries, enum references, API mapping) to `references/`.

```text
my-skill/
├── SKILL.md              # Core instructions (max ~200 lines)
└── references/            # Detailed documentation (loaded on demand)
    ├── debugging.md
    ├── common-issues.md
    └── enum-reference.md
```

**Good examples of this:** e2e-test skills with reference files for
debugging queries and enum references in `references/`.

**Our skills that should be refactored:** aide-create, aide-analyze, aide-implement
have everything in SKILL.md (150-200 lines). Detailed prompts should be moved to
`references/`.

---

## The description field

Anthropic calls this "the most important part". The formula:

```text
[What the skill does] + [When to use it] + [Key features]
```

Max 1024 characters. No XML tags (`<` or `>`). Include concrete
trigger phrases users actually type.

**Good:**

```yaml
description: >-
  Generates detailed manual test descriptions for the UI.
  Use when: writing manual test steps, describing how to
  create a case in the UI, creating test scenarios with specific
  dropdown values.
  Do NOT use for: automated tests (Vitest/Playwright).
```

**Weak (typical pattern):**

```yaml
description: >-
  React/TypeScript development for the project.
```

Missing: trigger phrases, "Do NOT use for", key features.

---

## Skill types

We have two main types with different structures:

### Workflow skills (aide-create, tdd-coach)

Step-by-step recipes that Claude follows. The structure is:

```markdown
# Skill title

Short intro.

## When to use

Explicit triggers.

## Workflow

### Step 1: [Name]
What Claude does, with concrete commands.

### Step 2: [Name]
...

## Error handling

Common problems and solutions.
```

### Domain skills (case flow, choice of law, decisions, database)

Expert knowledge about a specific area. The structure is:

```markdown
# Skill title

Short intro (2-3 sentences).

## Quick Reference

Table of key components, services or operations.

## Domain model

Entities and relationships.

## Key services

What they do, where they live (file:line), how they fit together.

## Common errors

| Symptom | Cause | Solution |

## Pitfalls

Anti-patterns with an explanation of WHY.

## Debugging

SQL queries or investigation steps.

## Related skills
```

---

## What separates good skills from mediocre ones

**Good skills answer "what do I do when it fails".**

A skill that only explains the happy path is a reference. A skill that
documents what goes wrong, why, and how you figure it out
is a tool.

| Mediocre | Good |
|-------------|-----|
| Explains the domain model | + what happens when relationships are missing |
| Lists services | + common failure situations per service |
| Shows correct usage | + what NOT to do and why |
| General warnings | Dated, evidence-based claims |

---

## Anti-patterns matter most

Explicitly document what does **not** work and why.
The pattern is: **claim → explanation → alternative**.

**Example (from an e2e-test skill):**

```markdown
## What NOT to do

**NEVER use page.reload() as a fallback on step-transition failures.**

Why: The step wizard uses client-side state. Reload sends you
back to step 1. The test appears to continue, but you are testing
the wrong step — and the failure is masked.

Use instead: the waitForContent parameter with an element from the NEXT step.
```

**Example (from a backend skill):**

```markdown
## Pitfalls

**AFTER_COMMIT does NOT mean you have fresh objects.**

Entities fetched BEFORE the commit are still available, but may have
stale state. Re-fetch from the repository inside the AFTER_COMMIT handler.
```

**Date your claims.** "Confirmed March 2026, ~60% flake rate on
the Yrkessituasjon step" is far more useful than "this can sometimes fail".
Dated claims let future readers judge whether they are still relevant.

---

## Debugging queries

Backend skills should have ready-made SQL queries. Frontend skills should have
the equivalent (console commands, network inspection, state debugging).

Put queries in `references/debugging.md` if there are many.

**Example (from a backend skill):**

```sql
-- Find all process instances for a case
SELECT pi.ID, pi.PROSESS_TYPE, pi.STATUS, pi.OPPRETTET_TID
FROM PROSESSINSTANS pi
WHERE pi.BEHANDLING_ID = :behandlingId
ORDER BY pi.OPPRETTET_TID DESC;

-- Find stuck processes (older than 1 hour, still RUNNING)
SELECT pi.ID, pi.PROSESS_TYPE, b.FAGSAK_ID
FROM PROSESSINSTANS pi
JOIN BEHANDLING b ON b.ID = pi.BEHANDLING_ID
WHERE pi.STATUS = 'KJOERER'
AND pi.OPPRETTET_TID < SYSDATE - INTERVAL '1' HOUR;
```

---

## Size and depth

| Lines in SKILL.md | Assessment |
|--------------------|-----------|
| < 80 | Too thin — use as a router skill or expand |
| 80-200 | Good for workflow skills and focused domain skills |
| 200-350 | Good for broad domain skills — consider references/ |
| 350+ | Move details to references/, keep SKILL.md under 200 |

**Hyperspecialization works.** A skill like `pom-from-recording`
(480 lines total, split between SKILL.md + references/) solves one hard
problem thoroughly — and was the most valuable skill in its project.

One deep skill > four shallow skills.

---

## Checklist for new and existing skills

### Frontmatter

- [ ] `name` in kebab-case, matches the folder name
- [ ] `description` follows the formula: [What] + [When] + [Key features]
- [ ] `description` includes trigger phrases users actually type
- [ ] `description` has "Do NOT use for" where relevant
- [ ] `description` under 1024 characters, no XML tags

### Structure

- [ ] SKILL.md focused on core instructions (under ~200 lines)
- [ ] Heavy documentation in `references/` (not everything in SKILL.md)
- [ ] Instructions are specific and actionable, not vague

### Content quality

- [ ] Documents common errors (symptom → cause → solution)
- [ ] Has anti-patterns/pitfalls with an explanation of *why*
- [ ] Has debugging steps or queries
- [ ] Includes examples (input → output or before → after)
- [ ] Cross-references to related skills
- [ ] Dates evidence-based claims

---

## Examples to study

### Workflow skills (aide/core/skills/)

| Skill | Why it is good |
|-------|--------------------|
| `tdd-coach` | Clear formula (RED-GREEN-REFACTOR), ground rules, test commands |

### Traits of strong skills (from earlier skill collections)

| Trait | Example |
|------------|----------|
| Anti-patterns with timelines | Race conditions documented with the sequence of events |
| Evidence-based troubleshooting | Dated claims with flake rates |
| Decision trees and checklists | 13-point checklist before completion |
| Heavy details in references/ | Database queries and enum references on demand |
