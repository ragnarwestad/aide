# Aide — Shared instructions

Instructions for AI-assisted development focused on:
- Specs with a 4-file documentation structure
- Test-Driven Development (TDD: RED → GREEN → VERIFY)
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
- [File renaming and conversion](#file-renaming-and-conversion)
- [Commit messages](#commit-messages)
  - [Format](#format)
  - [No Co-Authored-By lines](#no-co-authored-by-lines)
  - [No tool in a project's history](#no-tool-in-a-projects-history)
  - [Structure](#structure)
- [Pushing and push status](#pushing-and-push-status)

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

---

## File renaming and conversion

Use `git mv` to rename or convert a file, so its history carries over — `git mv country.js
country.ts` first, then the conversion, then the commit.

Why: `git mv` tells git it's the same file under a new name, so `git blame`, `git log`, and the
history shown in the IDE and on GitHub keep working. Deleting the old file and creating a new one
in its place loses that history.

---

## Commit messages

### Format

Write commit messages in English, in the imperative mood: "Add unit tests for country.ts", not
"Added unit tests" or "La til enhetstester".

### No Co-Authored-By lines

Do not add `Co-Authored-By` lines to commit messages, for any variant (`Claude`, `Copilot`, `GPT`,
etc.).

### No tool in a project's history

A commit message and a pull request's title and description describe the change, as a developer
on the project would. They name no tool: not Aide, not the AI assistant or its model, not a spec,
a workflow step or a slash command. The project may have nothing to do with any of them.

The one exception is a repository whose own rules say otherwise — its `CLAUDE.md`, `AGENTS.md`,
`CONTRIBUTING.md` or the like. The specs repository is such a place: there the
`Run /aide-<step> for <spec-folder>` subject is how a step is recorded, and the skills say when to
write it.

### Structure

A subject line saying what the change does, then, when it helps, a blank line and a body saying
why, with the context a reader needs.

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

# Testing rules for AI-assisted development

## Table of contents

- [Every change ships with its test](#every-change-ships-with-its-test)
- [Replaced behaviour takes its tests with it](#replaced-behaviour-takes-its-tests-with-it)
- [Core rule](#core-rule)
- [Test commands](#test-commands)
  - [Unit tests](#unit-tests)
  - [E2E tests (Playwright)](#e2e-tests-playwright)
- [Red, green, refactor](#red-green-refactor)
- [Single-run mode, never watch mode](#single-run-mode-never-watch-mode)

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
- **One place per rule.** A rule is proven where it lives — the store, the parser, the helper. A
  route or page test proves only that it is wired to that rule, once, not every case again.
- **No layout tests.** A test does not check how a page looks or where a component sits: no markup,
  no CSS, no class names, no element order, no widths or positions, in unit tests or browser tests
  alike. What a page computes — which state a row is in, which action it offers — is logic, and is
  tested on the function that decides it, not on the HTML it renders. A browser test is for
  behaviour that only a browser has: a click that starts an action, a live update that arrives.
- **No wording pins.** A test does not assert a sentence of a rule, skill, doc or help text. It
  asserts what code depends on: a name a script calls, a format a parser reads, a copy that must
  equal its source.
- **One language proves the catalogue.** A test that the page reads a translated word needs one
  language, not one per language.

### Prove the test is worth having

**Revert the fix temporarily and confirm that exactly that test goes red.** A test that passes both
with and without the fix is decoration. This takes thirty seconds and is not optional for a bug fix.

### When a unit test genuinely cannot reach it

Some things only exist in a browser: shadow-DOM internals, anything that depends on where the
camera is pointing, real rendering. Say so plainly, put it in the Playwright suite instead, and say
which spec — but never leave the change with nothing at all.

---

## Replaced behaviour takes its tests with it

**A change that replaces behaviour deletes the tests for the behaviour it replaced, in the same
job.** A suite only grows if nothing ever leaves it, and what is left behind is worse than noise:
a test named for a control that no longer exists tells the next reader that the control is still a
concern.

What goes:

- A test whose subject is gone — the removed heading, the replaced field, the deleted page.
- A check that something removed is still absent, once the thing that replaced it is checked in the
  same test. `expect(html).not.toContain('<h3>Config</h3>')` beside an assertion on the tab that
  replaced the heading proves nothing the positive one does not.
- The comment that only dates the removal. Git says when; the test says what holds now.

What stays: a check where the absence IS the rule, with nothing having replaced it — no colour
literal outside the token block, no confirm field on a form that asks in a sentence, no English
label on a Norwegian page.

A test left red by the change is not covered by this: fix it or delete it deliberately, and say
which in the summary.

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

### A red full run is fixed file by file

The full run finds what broke; it does not confirm each fix.

1. When it comes back red, list the failing files from that run's own output.
2. Fix them running only the file at hand (`bun test <file>`, `pytest <file>`) until each is green.
3. Run the full suite again once, when every file on the list is green — never between fixes.

A test that fails in the full run and passes on its own is the machine's load, not a fault: name it,
and do not run the full suite again for it.

---

## Test commands

### Unit tests

Use the project's own test command: `AIDE_TEST_CMD` in `.aide/project.yaml`, and nothing else (see
"Project commands" in the tools-and-scripts rules). Without it the project has no test command —
say so rather than guessing one. Always run it in single-run mode.

### E2E tests (Playwright)

**Run the e2e suite where the project's own run is quick and reliable. Keep that list explicit —
on this machine it is currently Atlasaurus (since 3 August 2026), PaceUp and Aide (since 27
September 2026). Elsewhere, ask the user to run it.**

**Aide: run `cd dashboard && make test-e2e` before every push to main**, whatever the change
touched — about 20 seconds. Otherwise only a landing runs it, and a browser test broken on main
stops the next spec's archive as if that spec had broken it. The one exception is a push that
changes only markdown files: no browser test reads them, and `scripts/check-docs` is their check.

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

## Red, green, refactor

New functionality is written test first: a test that fails because the behaviour is missing
(red), then the least code that makes it pass (green), then the whole suite, to see nothing else
broke (refactor).

---

## Single-run mode, never watch mode

Run tests so the process exits when they are done: `vitest --run`, not `vitest`, and the same for
any runner with a watch or interactive mode (Jest, `gradle --continuous`, `cargo watch`, …). An AI
assistant cannot answer a watch mode, so the process stays open, has to be killed by hand, and
nobody can tell when the tests finished.

Kill only test processes you started yourself: find them with `ps aux | grep "[v]itest"` (or the
runner's own name) and `kill <PID>` — never `pkill -f node` or `pkill -f vitest`, which take every
matching process with them.

---

# Communication rules

Rules for how the AI assistant presents text in the conversation with the user.

## Table of contents

- [Plain Norwegian — no invented or stilted words](#plain-norwegian--no-invented-or-stilted-words)
- [Answering "do we have anything outstanding?"](#answering-do-we-have-anything-outstanding)
- [Lead with the outcome](#lead-with-the-outcome)
- [Who fixes it: the dashboard, or me](#who-fixes-it-the-dashboard-or-me)
- [Handing over a spec](#handing-over-a-spec)
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

## Handing over a spec

**A spec agreed in the conversation is handed over as text, and it ends
there.** The user creates it from the dashboard. Never create it
yourself — not with `/aide-create`, not by hand — and never write,
commit or push anything in the specs repo on your own initiative.

1. **Ask first.** Raise the choices the spec depends on — thresholds,
   scope, dependencies on other specs — before writing the text, not as
   a list of open questions after it.
2. **Hand over three parts:** a title line, the description (what goes
   in `1-description.md`, with its `- **AC-n:**` lines), and a
   `Depends on:` line when there is one.
3. **Plain text between `---` lines**, as in the section below — no
   blockquotes.
4. **No number.** The number is assigned when the spec is created, not
   by whoever writes the text; don't call it "spec 02".

Don't offer to create it afterwards either. The same goes for an
existing spec's files: the aide commands write them, never a hand edit
proposed in the conversation.

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
