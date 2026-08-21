# aide — Shared instructions

Instructions for AI-assisted development focused on:
- JIRA issues with a 4-file documentation structure
- Test-Driven Development (TDD: RED → GREEN → REFACTOR)
- Automated codebase analysis with file:line references
- API impact analysis (frontend ↔ backend)

---

# LLM coding discipline

Behavioral rules that guard against two common LLM failures: silent
assumptions and scope creep. Inspired by Andrej Karpathy's observations
on where language models fall short when writing code.

**Trade-off:** These rules favor caution over speed. On trivial tasks,
use judgment.

## Table of contents

- [Think before you code](#think-before-you-code)
- [Surgical changes](#surgical-changes)
- [See also](#see-also)

---

## Think before you code

**Don't assume. Don't hide confusion. Surface the trade-offs.**

Before implementing:

- State your assumptions explicitly. If you are unsure, ask.
- If multiple interpretations exist, lay them out — don't silently pick one.
- If a simpler approach exists, say so. Push back when there is reason to.
- If something is unclear, stop. Put the confusion into words. Ask.

---

## Surgical changes

**Touch only what you must. Clean up only your own mess.**

When modifying existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Follow the existing style, even if you would have done it differently.
- If you discover unrelated dead code, mention it — don't delete it.

When your changes leave orphaned code behind:

- Remove imports, variables, and functions that *your* changes made unused.
- Don't remove dead code that was already there, unless asked to.

Rule of thumb: every line you change should be directly traceable to what
the user asked for.

---

## See also

Two related Karpathy principles already have their own coverage here — use
them rather than duplicating:

- **Simplicity first** (minimal code, no speculative abstraction) — the `/code-review` skill
- **Goal-driven execution** (verifiable success criteria, RED → GREEN → REFACTOR) — `testing.md` and `/tdd-coach`

---

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

---

# Testing rules for AI-assisted development

## Table of contents

- [Every change ships with its test](#every-change-ships-with-its-test)
- [Core rule](#core-rule)
- [Test commands](#test-commands)
  - [Unit tests](#unit-tests)
  - [E2E tests (Playwright)](#e2e-tests-playwright)
- [Workflow](#workflow)
  - [Example of a correct workflow](#example-of-a-correct-workflow)
  - [When tests fail](#when-tests-fail)
- [TDD approach](#tdd-approach-test-driven-development)
- [Watch mode warnings](#watch-mode-warnings)

---

## Every change ships with its test

**Fix a bug or add functionality → write the test in the SAME job. Never as a suggestion afterwards,
never as an item on a list of outstanding work.**

The user has to ask for this far too often. The pattern to stop: deliver the code, then offer tests as
a separate follow-up, or list "this has no test coverage" as an outstanding action. Tests are part of
the delivery, like the code compiling.

### What to test

- **The RULE, not the rendering.** What would break silently, in a way nobody sees for weeks. Not the
  markup — a test that restates the HTML raises a number and catches nothing.
- **A bug fix gets a test for the bug.** The failure that was reported is the test case.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the camera
is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say which
spec — but never leave the change with nothing at all.

---

## Core rule

**ALWAYS run tests when you create or modify them!**

**E2E tests (Playwright) have their own rules** — see [E2E tests (Playwright)](#e2e-tests-playwright); the AI runs them only in projects on the quick-suite list kept there, and asks elsewhere. Everything below about running tests applies to UNIT tests.

### ❌ NEVER
- Create tests without running them
- Modify tests without verifying that they still work
- Assume that tests pass without checking
- Commit failing tests

### ✅ CORRECT approach
1. When you create/modify tests, **run them immediately**
2. **Verify** that all tests pass (green ✅)
3. If tests fail (red ❌):
   - Analyze the error message
   - Fix the problem (either the test or the code)
   - Re-run until everything passes
4. **Before committing:** Run the entire test suite to check for regressions

---

## Test commands

### Unit tests

Use the project's own test command — take it from `AIDE_TEST_CMD` in
`.aide/config` if set, otherwise detect it from the lockfile/build files
(see "Project commands" in the tools-and-scripts rules). Always in
single-run mode.

Example for a pnpm/Vitest project:

```bash
# All tests (ALWAYS use --run to avoid watch mode!)
pnpm test -- --run

# Specific test file
pnpm test -- --run <filename>

# With coverage report
pnpm run test:coverage
```

### E2E tests (Playwright)

**The AI may run the e2e suite where the project's own run is quick and reliable. Keep that list
explicit — on this machine it is currently Atlasaurus (since 3 August 2026) and PaceUp. Elsewhere,
ask the user to run it.**

The ban was absolute until then, for one reason: the runs hung. A suite launched by the AI blocked the
session for many minutes with nothing to show for it, and it happened often enough that the user said so
several times, with emphasis. That is what changed — the runs are fast now, not the reasoning. If a
suite in another project still crawls, the old rule stands there.

Where it is allowed:

- ✅ Say what you are starting and roughly what it costs BEFORE launching it — the same courtesy as any
  open-ended job
- ✅ Run it when a change touched INTERACTION behaviour, not as routine after every edit; the
  project's ordinary check command stays the gate
- ✅ Report the result plainly, failures included, with the output
- ❌ Never let it run unbounded: if a run overshoots what you told the user it would take, kill it, say
  so, and hand the suite back rather than sitting on it
- ❌ Never the html reporter — it spawns a server that will not exit
- ❌ Never list an e2e run as an "outstanding action": the user runs the suite on his own initiative
  too, and reports when it goes red

---

## Workflow

### Example of a correct workflow

The steps below use a pnpm/Vitest project; swap in the project's own commands.

```text
1. Created test: src/utils/country.test.ts
2. Run: pnpm test -- --run country.test.ts
3. ✅ All 5 tests pass
4. Run: pnpm test -- --run (full suite for regression check)
5. ✅ 1247 tests pass, 0 fail
6. Now it is safe to commit
```

### When tests fail
```text
1. Created test: src/components/UserForm.test.tsx
2. Run: pnpm test -- --run UserForm.test.tsx
3. ❌ 2 of 8 tests fail
4. Analyze the error message: "Expected <button> to be disabled, but was enabled"
5. Fix the code in UserForm.tsx (disabled logic)
6. Run: pnpm test -- --run UserForm.test.tsx
7. ✅ All 8 tests pass
8. Run: pnpm test -- --run (full suite)
9. ✅ 1255 tests pass, 0 fail
10. Now it is safe to commit
```

---

## TDD approach (Test-Driven Development)

**Red → Green → Refactor**

### 1. RED: Write a failing test
Prove the problem by writing a test that demonstrates the desired behavior (but fails because the code is not implemented yet).

```tsx
// Example: Test for new functionality that does not exist yet
test('getCountryName should return "Norway" for code "NO"', () => {
  expect(getCountryName('NO')).toBe('Norway');
});

// Run: pnpm test -- --run country.test.ts
// ❌ Fails (proves that the functionality is missing)
```

### 2. GREEN: Implement until the test passes
Write minimal code to make the test pass.

```typescript
// Implement the functionality
export function getCountryName(code: string): string {
  const countries = {
    'NO': 'Norway',
    'SE': 'Sweden',
    'DK': 'Denmark',
  };
  return countries[code] || 'Unknown';
}

// Run: pnpm test -- --run country.test.ts
// ✅ Passes (the functionality works)
```

### 3. REFACTOR: Run all tests
Verify that no existing functionality was broken.

```bash
# Run the entire test suite
pnpm test -- --run

# ✅ All 1255 tests pass (no regressions)
```

---

## Watch mode warnings

### CRITICAL: All tests MUST terminate after running

**IMPORTANT:** Tests must always be run so that the process exits when the tests are done.
The examples are Vitest; the rule applies to any runner with a watch or interactive mode
(Jest, `gradle --continuous`, `cargo watch`, …).

```bash
# ✅ CORRECT - Tests run and the process exits
pnpm test -- --run                    # Vitest - exits after running
pnpm test -- --run UserProfile.test.tsx  # Specific test

# ❌ WRONG - Watch mode (the process NEVER exits)
pnpm test                             # Starts in watch mode
pnpm test UserProfile.test.tsx        # Watch mode

# ❌ WRONG for the AI regardless of mode - e2e is user-run only
pnpm run test:e2e
pnpm run test:e2e:ui
```

### Why this is critical

**In AI-assisted development:**
- AI cannot interact with watch mode (requires manual input to exit)
- Processes stay open in the background and must be killed manually
- Impossible for AI to verify when tests have finished running
- Can cause resource leaks

**In CI/CD pipelines:**
- Watch mode blocks the pipeline (waits forever)
- Consumes resources unnecessarily
- Makes automated workflows impossible

**In the TDD workflow:**
- You must be able to run tests multiple times in the cycle
- Each run must exit to move on to the next phase
- Watch mode breaks the automation

### How to check whether test processes are hanging

**WARNING:** Only kill processes you started yourself, not all node processes!

```bash
# Check whether YOUR test processes are hanging (do not kill automatically!)
ps aux | grep vitest
ps aux | grep playwright

# See PID and command to identify your processes
ps aux | grep "[v]itest"    # Shows vitest processes
ps aux | grep "[p]laywright" # Shows playwright processes

# Kill ONLY processes you started yourself (use the PID from the output above)
kill <PID>                   # Replace <PID> with the process ID

# Example:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

**IMPORTANT:**
- ❌ **NEVER** use `pkill -f node` (kills all node processes!)
- ❌ **NEVER** use `pkill -f vitest` without checking first
- ✅ Use `ps aux` to identify your processes
- ✅ Use `kill <PID>` to kill specific processes

---

## Summary

**Five golden rules:**
1. ✅ **Every fix and every new feature ships with its test, in the same job** — and revert the fix once to prove the test catches it
2. ✅ Run unit tests **immediately** after creating/modifying them
3. ✅ Verify that **all tests pass** before committing
4. ✅ Use **TDD** (Red → Green → Refactor) for new features
5. ✅ **Run the e2e suite only where it is quick** (per the E2E section's list) and say so first; ask the user to run it where it is not

**This rule ALWAYS applies - testing is not optional!**

---

# Communication rules

Rules for how the AI assistant presents text in the conversation with the user.

## Table of contents

- [Plain Norwegian — no invented or stilted words](#plain-norwegian--no-invented-or-stilted-words)
- [Answering "do we have anything outstanding?"](#answering-do-we-have-anything-outstanding)
- [Suggested text the user will copy out](#suggested-text-the-user-will-copy-out)

---

## Plain Norwegian — no invented or stilted words

Write ordinary, everyday Norwegian. This is the single most repeated piece of feedback the user has
given — across projects and across many sessions — and it keeps happening, so treat it as a hard rule
and **re-read your own reply before sending it**.

**The test:** would a Norwegian colleague say this out loud in a conversation? If not, rewrite it.

**The three failure types:**

1. **Process jargon** — "paritet", "skive", "fase", "gate/gated", "lekkasje" (say "frafall"), "trakt",
   "chrome" (about UI), "bøtte" (bucket), "røret" (pipeline), "maskiner" (say "AI-assistenter").
2. **Anglicisms with Norwegian endings** — "scopet", "trigge", "pushe" (outside the git command).
3. **Stilted words where an everyday one exists** — "setet" for "hovedstaden", "senteret", and other
   "finer" synonyms. This one sneaks in when SUMMARISING work that was explained plainly a moment
   earlier.

**One word per thing, all the way through.** Having written "hovedstad" in the explanation, write
"hovedstad" in the summary too — not a variation. The same goes for the user's own words: if he wrote
"FB reels", write "FB reels", never an abstraction over it ("kortvideo-formatet").

**Every sentence must stand alone.** No phrases that assume the reader followed your reasoning
("husets egen regel", "telleren er på plass — så tallet er ekte"). Spell references out: "regelen i
docs/X sier at …".

**Don't comment on the user's time or state** ("dette kan vente til i morgen", "med friske øyne"). He
runs his own evening.

Applies to the chat. English code comments and commit messages stay English.

---

## Answering "do we have anything outstanding?"

When the user asks "har vi noe utestående?", "utestående aksjoner?" or any variation, the answer is
a **numbered list of concrete outstanding actions — nothing else**. Number the points (1., 2., 3. …)
so the user can refer to them by number in the reply.

**Each point must be:**

- A specific action that is still to be done, described so it can be picked up without more context
- Something we have actually discussed but not prioritised, or a known bug or gap
- Followed by a proposed solution — not just the problem. Say what you would do about it.

**When the point has several possible solutions the user must choose between**, list them as
sub-bullets under the point, one per option, each with its advantages, disadvantages and
consequences. Consequences means what the choice drags along with it: what else has to change, what
it costs, what it locks in. Say which one you would pick and why.

**Letter the options a, b, c …** under the point's number, so the user can name one as "3c". Write
the letter at the start of the sub-bullet — `- **a.** Dynamiske tagger.` — and keep the lettering
restarting at `a` under every point. The user's reply may then be nothing but a reference like "ta
3c"; treat that as choosing that option and get on with it.

**Never include:**

- What has been done, what was committed, or any other status
- Whether the working tree is clean, tests are green, or the build passes
- Backlog headings without content ("see docs/SPEC.md") — write out the actual points
- Preamble, summary or closing remarks around the list
- **Missing content in the user's own data** — an exercise without an illustration, a routine
  without a description, a record with an empty field. That is the user filling in his own data,
  not work on the software. It does not belong in the action list, and it does not belong in the
  project's backlog either. Note it where the data lives (an assets README or similar) if it is
  worth writing down at all.

If there is genuinely nothing outstanding, say that in one sentence — do not fill the space with a
recap.

This rule applies to ALL projects and sessions.

---

## Suggested text the user will copy out

**Do not use markdown blockquotes (`> ` in front of each line)** when suggesting text the user will copy and paste somewhere else (Slack messages, PR comments, commit messages, emails, etc.).

**Why:** Blockquotes render as a vertical bar in the left margin of the terminal, and the `>` characters come along when copying. That makes the text unusable without manual cleanup.

**How:**

- Distinguish between text that is *your reply* (may use blockquotes/headers freely) and text that is *a suggestion for external use* (plain text, do not prefix each line with `>`).
- To visually delimit the suggested text, instead use `---` above and below, or a short lead-in like "Suggestion:" on the preceding line.
- Markdown for italics/bold/lists inside the suggestion is fine — it is only the blockquote prefix that is the problem.

**Example:**

Wrong:

```text
Suggested Slack message:

> Thanks for the review.
> We have cleaned up the code now.
```

Correct:

```text
Suggested Slack message:

---

Thanks for the review.
We have cleaned up the code now.

---
```

This rule applies to ALL projects and sessions.
