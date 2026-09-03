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
- [Documentation describes now, not history](#documentation-describes-now-not-history)
- [See also](#see-also)

---

## Think before you code

**State assumptions explicitly and surface trade-offs.**

Before implementing:

- State your assumptions explicitly. If you are unsure, ask.
- Lay out multiple interpretations when they exist, rather than silently picking one.
- If a simpler approach exists, say so. Push back when there is reason to.
- If something is unclear, stop. Put the confusion into words. Ask.

---

## Surgical changes

**Touch only what the task requires. Clean up only your own mess.**

When modifying existing code:

- Leave adjacent code, comments, and formatting as they are.
- Leave working code alone rather than refactoring it.
- Follow the existing style, even if you would have done it differently.
- Leave unrelated dead code in place, and mention it.

When your changes leave orphaned code behind:

- Remove imports, variables, and functions that *your* changes made unused.
- Leave dead code that was already there, unless asked to remove it.

Rule of thumb: every line you change should be directly traceable to what
the user asked for.

---

## Documentation describes now, not history

**A README, a CLAUDE.md, or any other living doc says how the system
works TODAY — never a chronicle of how it got there.**

- Never write "spec N did X because Y" or "on DATE, Z happened" as the
  justification for a rule inside a living doc. Git history, blame and
  commit messages are where that belongs — a reader of the doc wants
  the current behavior, not its excavation.
- State the rule and, if a reason genuinely helps, the ONE-LINE
  invariant it protects — not the story of the incident that found it.
- This applies whenever a change happens to touch documentation, not
  only to a spec whose job is documentation — an implement step that
  updates a README is bound by this exactly as a dedicated doc spec is.
- A doc that keeps growing because every change appends its own
  paragraph of justification is the failure mode this guards against:
  size should track what the system does, not how many changes it took
  to get there.

---

## See also

Two related Karpathy principles already have their own coverage here — use
them rather than duplicating:

- **Simplicity first** (minimal code, no speculative abstraction) — the `/code-review` skill
- **Goal-driven execution** (verifiable success criteria, RED → GREEN → REFACTOR) — `testing.md` and `/tdd-coach`
- **Never hand-write a spec's files** — the `spec-structure` rule/skill, "Templates"

---

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
- [Watch mode](#watch-mode)

---

## Every change ships with its test

**Fix a bug or add functionality → write the test in the same job. Never as a suggestion
afterwards, never as an item on a list of outstanding work.**

The user has to ask for this far too often. The pattern to stop: deliver the code, then offer tests
as a separate follow-up, or list "this has no test coverage" as an outstanding action. Tests are
part of the delivery, like the code compiling.

### What to test

- **The rule, not the rendering.** What would break silently, in a way nobody sees for weeks. Not the
  markup — a test that restates the HTML raises a number and catches nothing.
- **A bug fix gets a test for the bug.** The failure that was reported is the test case.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the
camera is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say
which spec — but never leave the change with nothing at all.

---

## Core rule

Run a test as soon as you create or modify it, and verify it passes before moving on.

**E2E tests (Playwright) have their own rules** — see [E2E tests (Playwright)](#e2e-tests-playwright);
run them only in projects on the quick-suite list kept there, and ask the user elsewhere. Everything
below about running tests applies to unit tests.

1. Run the new or changed test immediately.
2. Verify that it passes (green ✅). If it fails (red ❌), analyze the error message, fix the
   problem — either the test or the code — and re-run until it passes.
3. Before committing, run the entire test suite to check for regressions.

### Slow tests never block the session

The job itself often takes seconds; verification must not turn that into a long wait while the
user does nothing else.

- Run in the foreground only fast, narrow test files that cover the exact change. Learn which files
  in a repo are slow before running anything broad.
- Run anything slow in the background, announced with what it is and roughly how long, while the
  job and the conversation continue. Report the result when it lands.
- Run the full suite exactly once per job, in the background, before commit — never inline, never
  repeated per iteration.
- When the user is waiting to see something, deploy or show it first and verify in the background.

---

## Test commands

### Unit tests

Use the project's own test command — take it from `AIDE_TEST_CMD` in `.aide/config` if set,
otherwise `testCmd` in the committed manifest, otherwise detect it from the lockfile/build files
(see "Project commands" in the tools-and-scripts rules). Always run it in single-run mode.

Example for a pnpm/Vitest project:

```bash
# All tests (use --run to avoid watch mode)
pnpm test -- --run

# Specific test file
pnpm test -- --run <filename>

# With coverage report
pnpm run test:coverage
```

### E2E tests (Playwright)

**Run the e2e suite where the project's own run is quick and reliable. Keep that list explicit —
on this machine it is currently Atlasaurus (since 3 August 2026) and PaceUp. Elsewhere, ask the
user to run it.**

The list stays short on purpose: a suite that hangs blocks the session for minutes with nothing to
show for it. Where a project's suite is fast, that risk is gone; where it still crawls, ask the
user to run it there instead.

Where it is allowed:

- Say what you are starting and roughly what it costs before launching it — the same courtesy as
  any open-ended job.
- Run it when a change touched interaction behaviour, not as routine after every edit; the
  project's ordinary check command stays the gate.
- Report the result plainly, failures included, with the output.
- Don't let it run unbounded: if a run overshoots what you told the user it would take, kill it,
  say so, and hand the suite back rather than sitting on it.
- Don't use the html reporter — it spawns a server that will not exit.
- Don't list an e2e run as an "outstanding action": the user runs the suite on their own
  initiative too, and reports when it goes red.

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

Prove the problem by writing a test that demonstrates the desired behavior (but fails because the
code is not implemented yet).

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

## Watch mode

Run tests so the process exits when they're done. The examples are Vitest; the rule applies to any
runner with a watch or interactive mode (Jest, `gradle --continuous`, `cargo watch`, …).

```bash
# ✅ Runs and exits
pnpm test -- --run                    # Vitest - exits after running
pnpm test -- --run UserProfile.test.tsx  # Specific test

# ❌ Watch mode - the process never exits
pnpm test
pnpm test UserProfile.test.tsx

# ❌ e2e is user-run only, regardless of mode
pnpm run test:e2e
pnpm run test:e2e:ui
```

Why: an AI assistant can't interact with watch mode (it needs manual input to exit), so a process
left in watch mode stays open in the background, has to be killed by hand, and leaves no way to
tell when the tests actually finished. The same failure blocks a CI pipeline, which waits forever,
and breaks the TDD cycle, which needs each run to exit before the next one starts.

### Checking whether test processes are hanging

Kill only processes you started yourself, not every process with a matching name.

```bash
# Check whether your test processes are hanging (do not kill automatically)
ps aux | grep vitest
ps aux | grep playwright

# See PID and command to identify your processes
ps aux | grep "[v]itest"    # Shows vitest processes
ps aux | grep "[p]laywright" # Shows playwright processes

# Kill only processes you started yourself (use the PID from the output above)
kill <PID>                   # Replace <PID> with the process ID

# Example:
# ps aux | grep vitest
# > ragnar  12345  ... node .../vitest/...
# kill 12345
```

Don't use `pkill -f node` (kills every node process) or `pkill -f vitest` without checking first —
use `ps aux` to identify your own processes, then `kill <PID>` for those specifically.

---

## Summary

1. Every fix and every new feature ships with its test, in the same job — revert the fix once to
   confirm the test catches it
2. Run unit tests immediately after creating or modifying them
3. Verify that all tests pass before committing
4. Use TDD (Red → Green → Refactor) for new features
5. Run the e2e suite only where it's quick (per the E2E section's list), say so first, and ask the
   user to run it elsewhere

---

# Communication rules

Rules for how the AI assistant presents text in the conversation with the user.

## Table of contents

- [Plain Norwegian — no invented or stilted words](#plain-norwegian--no-invented-or-stilted-words)
- [Answering "do we have anything outstanding?"](#answering-do-we-have-anything-outstanding)
- [Lead with the outcome](#lead-with-the-outcome)
- [Who fixes it: the dashboard, or me](#who-fixes-it-the-dashboard-or-me)
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

---

## Lead with the outcome

Lead a reply with the outcome, and leave out detail that would not change what the reader does next.

---

## Who fixes it: the dashboard, or me

Every proposed fix says, in its first sentence, which of the two it is.

**It can be done in the dashboard.** Describe it in the dashboard's own
words — the page, the row, the tab, the button — and stop there. No file
paths, no function names, no git. The user does it, and wants to; an
explanation loaded with implementation detail takes that away by making a
button press look like an operation.

**It cannot be done in the dashboard.** Say so plainly, say why in one
line, and state that this one is mine to do. Then the details belong in
the answer, because they describe work the user is not being asked to
perform.

Never blur the two. A fix described half in dashboard terms and half in
git terms leaves the user unsure whether he is being handed a task or
told what happened.

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
