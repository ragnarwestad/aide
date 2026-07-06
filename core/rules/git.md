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
2. Use explicit file names: `git add reports/<NN>-PROJ-7890-slug/description.md` (not `git add .`)
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
git add reports/<NN>-PROJ-7890-slug/description.md
git add reports/<NN>-PROJ-7890-slug/analysis.md
git add reports/<NN>-PROJ-7890-slug/solution.md
git add reports/<NN>-PROJ-7890-slug/status.md

# Or all at once:
git add reports/<NN>-PROJ-7890-slug/*.md
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

## Summary

**Three golden rules:**
1. ✅ Use `git add` with explicit file names for NEW files you have created
2. ✅ Use `git mv` when renaming files (preserves history)
3. ✅ Write commit messages in English, in the imperative mood

**This ALWAYS applies - in commands, agents, and normal interaction alike!**
