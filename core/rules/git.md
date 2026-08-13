# Git rules for AI-assisted development

## Table of contents

- [Staging new files](#staging-new-files)
  - [Core rule](#core-rule)
  - [Example](#example)
- [File renaming and conversion](#file-renaming-and-conversion)
  - [Core rule](#core-rule-1)
  - [Workflow for JS to TS conversion](#workflow-for-js-to-ts-conversion)
- [Commit messages](#commit-messages)
  - [Format](#format)
  - [Good examples](#good-examples)
- [Pushing and push status](#pushing-and-push-status)
- [Summary](#summary)

---

## Staging new files

### Core rule
**Automatically add new files YOU have created, but NEVER any other files!**

### ❌ FORBIDDEN
- `git add .` (adds ALL files, including generated/unwanted ones)
- `git add -A` (adds ALL files, including generated/unwanted ones)
- Adding files you did NOT create yourself (node_modules, build output, generated files, etc.)

### ✅ CORRECT approach
1. When you have created NEW files (documentation, code, tests), run `git add` **automatically** for them
2. Use explicit file names: `git add specs/<NN>-PROJ-7890-slug/description.md` (not `git add .`)
3. Only add files YOU wrote/created yourself
4. NEVER add:
   - Generated files (build output, coverage reports)
   - Dependencies (node_modules, vendor)
   - IDE files (.idea/, *.swp)
   - Temporary files

### Note
Modified files (already tracked) do not need `git add` - the user handles committing in their IDE.

### Example
```bash
# You have created 4 new markdown files
git add specs/<NN>-PROJ-7890-slug/description.md
git add specs/<NN>-PROJ-7890-slug/analysis.md
git add specs/<NN>-PROJ-7890-slug/solution.md
git add specs/<NN>-PROJ-7890-slug/status.md

# Or all at once:
git add specs/<NN>-PROJ-7890-slug/*.md
```

---

## File renaming and conversion

### Core rule
**ALWAYS use `git mv` to preserve git history when renaming files!**

### ❌ FORBIDDEN (loses history)
```bash
# Deleting the old file and creating a new one
rm src/utils/country.js
# create new src/utils/country.ts
git add src/utils/country.ts
```

### ✅ CORRECT (preserves history)
```bash
# Use git mv to preserve commit history
git mv src/utils/country.js src/utils/country.ts
git mv src/components/UserProfile.jsx src/components/UserProfile.tsx
```

### Why this matters
- Preserves the entire commit history (who changed what, when, why)
- Git understands that it is the same file, just with a new name
- `git blame` and `git log` work correctly
- The history shows up in the IDE and on GitHub

### Workflow for JS to TS conversion
1. `git mv old.js new.ts` (first!)
2. Convert the contents to TypeScript
3. `git add new.ts` (the changes)
4. Commit

**This rule ALWAYS applies to JS→TS/JSX→TSX conversion!**

---

## Commit messages

### Format
**Always English, always in the imperative mood (not past tense).**

### ❌ NEVER Co-Authored-By
- NEVER add `Co-Authored-By` lines to commit messages
- This applies to all variants (`Claude`, `Copilot`, `GPT`, etc.)

### Good examples
- "Add automatic git add for new files"
- "Remove user-specific paths from settings.json"
- "Update documentation with hook explanation"
- "Convert UserProfile.jsx to TypeScript"
- "Add unit tests for country.ts"

### ❌ Wrong (past tense/Norwegian)
- "Added automatic git add for new files"
- "Removed user-specific paths"
- "Updated documentation"
- "Konverterte UserProfile.jsx til TypeScript"
- "La til enhetstester for country.ts"

### Structure

```text
<What the change does, in the imperative mood>

<Optional: why, context, or details>
```

**Example:**

```text
Add unit tests for country.ts

Test getCountryName(), getCountryCode(), and edge cases.
Preparation before the JS to TS conversion.
```

---

## Pushing and push status

### Core rule
**Never push, and never talk about push/deploy status. The user pushes from the IDE.**

### ❌ NEVER
- Run `git push` unless the current request itself explicitly asks for it («og push» once is not a standing instruction)
- Report push status after a commit: no «N commits ahead of origin», no «husk å pushe», no «remember to push»
- Rephrasings of the same claim: «tre commits ligger klare», «goes out in the same deploy», «when you push these»
- Count commits from memory of what was pushed earlier — the user pushes continuously from the IDE, so any mental model of origin is stale

### ✅ CORRECT approach
1. After committing: state what was committed — full stop
2. Only if the user asks directly about push status: run `git status -sb` + `git log origin/main..main --oneline` **in the same reply** and report the actual result

### Why
The AI repeatedly reported stale push status computed from memory (four separate incidents in July 2026), and the user had to correct it each time. Any statement implying what is or is not on origin requires running git first — and unprompted, it should simply not be made.

A sixth incident (2026-08-06) shows the sneakiest form: mid-explanation of a production issue, the
phrase «fiksen ligger nå i en lokal commit, og bygges … når den er pushet» — not an answer to a
status question, just a subordinate clause implying the commit was not on origin. It was wrong (the
user had already pushed from the IDE, as always) and derailed the whole answer. The trigger for
running git is not "the user asked about push" — it is **any sentence about to contain the words
lokal/pushet/origin or their meaning**.

### The rule generalizes to ALL git state
A fifth incident (2026-07-27) was the same error outside push status: the AI warned that "another
session has uncommitted changes in these files right now", based on file-change notifications seen
minutes earlier — the other session had committed half an hour before. **Every claim about repository
state — uncommitted changes, what another session/person has or hasn't landed, ahead/behind, staged
content — requires running `git status`/`git log` in the same reply the claim is made.** Observations
from earlier in the conversation are history, not current state.

---

## Summary

**Four golden rules:**
1. ✅ Use `git add` with explicit file names for NEW files you have created
2. ✅ Use `git mv` when renaming files (preserves history)
3. ✅ Write commit messages in English, in the imperative mood
4. ❌ Never push, and never mention push/deploy status — the user pushes from the IDE

**This ALWAYS applies - in commands, agents, and normal interaction alike!**
