---
paths:
  - "/README.md"
  - "/DEVELOPING.md"
  - ".claude/CLAUDE.md"
  - ".claude/rules/*.md"
  - "docs/AGENTS_AND_LOOPS.md"
  - "docs/AI_SUPPORT_MATRIX.md"
  - "docs/COMPARISON.md"
  - "docs/CONFIGURATION.md"
  - "docs/GLOSSARY.md"
  - "docs/INSTALLATION.md"
  - "docs/REPLAY.md"
  - "docs/SKILL_GUIDE.md"
  - "docs/SPEC_WRITING_SOURCES.md"
  - "core/implementations/**/*.md"
  - "dashboard/README.md"
  - "dashboard/CLAUDE.md"
  - "dashboard/.claude/rules/*.md"
  - "dashboard/docs/**/*.md"
---

# Writing the development documentation

- A page covers one subject. Anything else is a link to the page that owns it.
- The text says what holds and what the user sees, not how the code achieves it. Code names appear only as
  pointers to where something lives.
- No justifications or history: git keeps those.
- Each fact lives in one place.
- What matters only to a session changing one part of the code goes in a `paths:`-scoped rule for that part, not
  on a page.
