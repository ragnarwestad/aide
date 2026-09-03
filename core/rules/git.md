# Git rules for AI-assisted development

## Table of contents

- [Pulling before new work](#pulling-before-new-work)
- [Staging new files](#staging-new-files)
  - [Example](#example)
- [File renaming and conversion](#file-renaming-and-conversion)
  - [Workflow for JS to TS conversion](#workflow-for-js-to-ts-conversion)
- [Commit messages](#commit-messages)
  - [Format](#format)
  - [No Co-Authored-By lines](#no-co-authored-by-lines)
  - [Good examples](#good-examples)
  - [Not this](#not-this)
  - [Structure](#structure)
- [Pushing and push status](#pushing-and-push-status)
- [Summary](#summary)

---

## Pulling before new work

Pull the specific repo before creating anything new in it — a file, a spec, a branch — right
before writing the first new file, not once at the start of the session. Another session, another
machine, or an automated job (a queued `/aide-analyze`, another person's IDE, a CI step) committing
to the same repo while you work is the normal case, not an edge case — specs repos especially, since
the dashboard, other sessions and the user's own IDE all write to them continuously.

1. `git pull --ff-only` (or `git fetch` + inspect, when a merge is in question) the specific repo
   you are about to add something to.
2. If the pull brings in changes to files you are about to touch, read what changed before
   proceeding.
3. If a later `git push` is still rejected despite this — a push landed in the gap between your
   pull and your push — rebase onto the new commits and push again; do not force.

Why: a pull that lands between your read and your write turns into a rejected push and an
avoidable rebase.

---

## Staging new files

Add new files you have created yourself, by explicit name, as soon as you create them.

1. When you create new files (documentation, code, tests), run `git add` for them automatically.
2. Name them explicitly — `git add specs/<NN>-PROJ-7890-slug/description.md` — rather than
   `git add .` or `git add -A`, both of which sweep in generated files, dependencies
   (`node_modules`, `vendor`), IDE files (`.idea/`, `*.swp`) and other unwanted output along with
   the ones you meant to add.
3. Add only files you wrote or created yourself. Modified files that are already tracked don't
   need `git add` — the user handles committing those in their IDE.

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

Use `git mv` to rename or convert a file, so its history carries over.

```bash
git mv src/utils/country.js src/utils/country.ts
git mv src/components/UserProfile.jsx src/components/UserProfile.tsx
```

Why: `git mv` tells git it's the same file under a new name, so `git blame`, `git log`, and the
history shown in the IDE and on GitHub keep working. Deleting the old file and creating a new one
in its place loses that history.

### Workflow for JS to TS conversion

1. `git mv old.js new.ts` first
2. Convert the contents to TypeScript
3. `git add new.ts` for the changes
4. Commit

---

## Commit messages

### Format

Write commit messages in English, in the imperative mood (not past tense).

### No Co-Authored-By lines

Do not add `Co-Authored-By` lines to commit messages, for any variant (`Claude`, `Copilot`, `GPT`,
etc.).

### Good examples

- "Add automatic git add for new files"
- "Remove user-specific paths from settings.json"
- "Update documentation with hook explanation"
- "Convert UserProfile.jsx to TypeScript"
- "Add unit tests for country.ts"

### Not this

Past tense or Norwegian:

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

Push only when the current request itself explicitly asks for it — a past "and push" isn't a
standing instruction for later requests. The user pushes from the IDE. After committing, state
what was committed and stop there.

Don't report push status unprompted, in any phrasing — "N commits ahead of origin", "husk å
pushe", "remember to push", "tre commits ligger klare", "goes out in the same deploy", or a count
of commits recalled from earlier in the conversation. The same holds for any other claim about
repository state: uncommitted changes, what another session or person has or hasn't landed,
ahead/behind, staged content. Only if the user asks directly, run `git status -sb` and
`git log origin/main..main --oneline` in the same reply and report the actual result.

Why: the user pushes continuously from the IDE and other sessions commit to the same repo, so any
claim about repo state is stale unless it comes from a command run in that same reply.

**One exception lives elsewhere, not here:** creating a spec with `/aide-create` commits and
pushes immediately, with no separate ask for either step — see that skill's own "Stage in git"
instructions (`core/skills/aide-create/SKILL.md`), which specify it precisely (message format, when
to omit the model suffix, what "nothing to stage" means) with no gap left for a general rule to
fill. Kept in the skill rather than duplicated here so the two copies cannot drift.

---

## Summary

1. Pull the repo before creating anything new in it
2. Add new files with explicit file names
3. Use `git mv` when renaming files, to preserve history
4. Write commit messages in English, in the imperative mood
5. Push only on explicit request, and report push status only from a command run in the same
   reply — except `/aide-create`'s own commit, per that skill's instructions
