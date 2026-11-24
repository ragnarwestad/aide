# Replaying specs

## Table of contents

- [What a replay is](#what-a-replay-is)
- [What it measures](#what-it-measures)
- [Running a round](#running-a-round)
  - [The login](#the-login)
  - [One spec per process](#one-spec-per-process)
  - [Following a round](#following-a-round)
- [The results](#the-results)
- [What a round costs](#what-a-round-costs)
- [Deciding from a round](#deciding-from-a-round)
- [What the rounds found](#what-the-rounds-found)
- [Measuring the review](#measuring-the-review)
  - [Planted defects and clean cases](#planted-defects-and-clean-cases)
  - [Checks for one kind of change](#checks-for-one-kind-of-change)
- [Measuring the analysis and the plan](#measuring-the-analysis-and-the-plan)
  - [The cases](#the-cases)
  - [The commands](#the-commands)
  - [The reports](#the-reports)

---

## What a replay is

`scripts/replay_specs` runs archived specs again, with another model or another
version of the skills, and compares the result with what the spec produced the
first time. It is how Aide decides which model runs a step.

For each spec it is given, the script:

1. copies the project's code repository at the commit just before the spec's code
   merged;
2. makes a specs repository holding only that spec: its description as archived,
   and the analysis, plan and status fresh from the templates;
3. runs `analyze`, and `implement` when asked, through the runner of the Aide commit
   it is given, with the tool, model, effort and advisor it is given per step;
4. measures the run, writes one table, and removes the copies.

Nothing is written to the board's queue, to the real specs repository or to any
origin. A replay does not show on the board: it is a script started by hand.

The steps run with the permission mode the queue gives them (`bypassPermissions`).
The copies keep the repositories safe, but nothing keeps a session from reaching
the rest of the machine, so replay only specs and Aide commits you trust.

The script's own help (`python3 scripts/replay_specs --help`, and the docstring in
`scripts/replay_specs/__main__.py`) lists every option.

---

## What it measures

One row per spec, and a total row:

| Column                    | What it says                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Files found               | How many of the files the original merge changed the new analysis named, and how many it named that were not changed |
| Must-fix, Should-fix      | The counts from the new plan's review                                                                                |
| Every AC placed           | Whether every acceptance criterion has a place for its test in the plan                                              |
| Green, Rounds             | Whether implement ended on a green suite, and after how many test rounds                                             |
| Original tests            | How many of the original spec's tests pass against the new code                                                      |
| Judge                     | A score from 1 (clearly worse than the original plan) to 5 (clearly better); 3 means as good                         |
| Time/tokens/cost per step | For analyze, implement and the judge                                                                                 |

The original tests run in a fresh worktree of the new code. A project with a `pnpm-lock.yaml` and no `node_modules`
there gets `pnpm install --frozen-lockfile --prefer-offline` first, through `mise exec` when it has a `mise.toml`;
a failed install is named in the row's note.

Under the table, the judge's reasons for each score. With `--repeat N` each spec is
replayed N times, and the row also says how many of its replays went green and how
far implement's cost spread: one replay cannot tell a steady result from a lucky one.

---

## Running a round

A round runs on the machine that serves the board, `rw-macmini-m2`, from
`~/develop/aide`, in a tmux session so it outlives the ssh connection. A round of
eight specs with analyze and implement takes eight to ten hours.

Check the board's queue first: a round shares the account's usage limit with the
board's own jobs.

### The login

A fresh Claude config folder has no login, so the script reads one from
`CLAUDE_CODE_OAUTH_TOKEN`. The token is made once with `claude setup-token` and kept
in `~/.aide/replay-token` (mode 600). The launcher reads it from there; never print
it or put it in a script.

### One spec per process

Start the script once per spec, each in its own process group, and try a failed
spec once more. A signal or a crash then costs one spec, not the round. The
launchers in `~/.aide/` on the serving host do this; `~/.aide/run-replay-a1.sh` is
one to copy:

```bash
perl -e "setpgrp(0,0); exec @ARGV" python3 scripts/replay_specs --project aide --specs 615 \
  --aide-commit c206cae8 --analyze claude sonnet --advisor opus --implement claude sonnet --judge opus \
  --code ~/develop/aide --specs-root ~/develop/aide-specs/aide --results ~/.aide/replays/<round>/615
```

Use `--preflight '<command>'` when a project's tests need services. The command runs
in each historical code copy, before analyze, the judge or implement. A nonzero
exit or a ten-minute timeout stops that spec without calling a model; its output
stays in `preflight.log` beside the step logs. For Skjera, use
`--preflight 'docker compose up -d --wait mailpit && curl -fsS --max-time 10 http://127.0.0.1:8025/readyz'`.
A port conflict must be resolved before replay; do not stop another service to
make room for it.

Start it with `tmux new-session -d -s <name> <launcher>`.

Keep `--aide-commit` the same across rounds that are to be compared: the runner and
the skills come from that commit.

### Following a round

- `ssh rw-macmini-m2`, then `tmux attach -t <name>` shows the launcher.
- `run.log` in the round's folder says which spec started and ended, with its exit
  code.
- `heartbeat.log` beside it gets a line a minute while the launcher lives.
- Each spec's own `replay.log` has the script's output.

---

## The results

Each spec's folder holds a run folder, `<date>-<time>-<aide commit>/`, with:

- `results.md` — the table, the original tests that failed, named per spec as `<file>::<case>`, and the judge's
  reasons;
- per spec, `analyze.log` and `implement.log`, the steps' result JSON, and the raw
  `.stream` of each session, with the test log beside implement's.

---

## What a round costs

Analyze and implement on Sonnet cost about $6–7 per spec, and analyze on Opus about
twice that. An advisor adds about $1–2 per analysis. The judge costs cents. On a
subscription, the cost counts toward the account's usage limit, and a long round can
reach the five-hour limit: a spec that hits it has no result and is run again.

---

## Deciding from a round

A step changes model only when a round shows the new choice is at least as good on
the specs the round replayed, compared with what those specs got on the board:

- implement green at least as often;
- the original tests no more than 5 percentage points lower;
- the judge's mean score not lower than 3;
- at least 25 % cheaper per step.

Two or three specs are too few to decide on; a round has eight or more.

The original tests favour the board's own runs: those runs pass their own tests by
definition, and a replay that builds the same behaviour under other names or in other
places fails some of them. A fair comparison on that criterion needs the current model
replayed on the same specs as well, as its own round.

---

## What the rounds found

Each question a round has settled, with the numbers that settled it. The results lie
on the serving host, under `~/.aide/replays/`.

**Analyze stays on Opus.** Two rounds replayed analyze on specs 615, 619, 622, 624,
634, 637, 639 and 640, at Aide commit c206cae8, with implement on Sonnet and the judge
on Opus (`analyze-model/b1` and `analyze-model/a1`):

| Analyze on               | Green | Original tests | Judge mean | Analyze cost              |
| ------------------------ | ----- | -------------- | ---------- | ------------------------- |
| Sonnet alone             | 8/8   | 87 %           | 2.4        | 51 % below Opus           |
| Sonnet with Opus advisor | 7/7   | 88.6 %         | 2.57       | 27 % above Sonnet alone   |

The second round has seven specs: 640's analysis ran out of time on a loaded host and
was left out. Neither meets the bar: the original tests are more than 5 points lower,
and the judge's mean is under 3. The judge's recurring complaint was heavier plans that
missed what the description meant. The advisor improves the plan a little, for about
$1–2 an analysis.

**A small spec needs only a short analysis.** Implement on Sonnet, run on six archived
specs with no analysis at all, was green at the first try on four of them, for less
than the original implement runs cost, and saved the analysis on Opus, $7.89 to $15.57
a spec. On the other two the implement skill refused to start, on its own judgement and
not on size: one of them was smaller than a spec that ran. 199 of the 226 original tests
passed; the round cannot tell whether the other 27 failed on behaviour or only on naming
and placing. That is why the short analysis still writes the files to change and where
the tests go, and why the runner, not the model, decides when it is taken.

## Measuring the review

`scripts/review_eval` measures implement's review and its verification, which a replay cannot: a replay reruns the
whole step, while these need fixed commits with known defects. `scripts/review_eval/cases.json` holds 23 implement
commits whose review on the board found nothing, and every finding a later review made on them, each labelled
`real`, `false` or `unclear` by reading the code at the commit. Both commands send the runner's own prompts
(`run-spec/turn/review-prompts.sh`) in a detached worktree of each commit, and read the replies by the runner's own
rule from the same file.

- `review --tool codex --model gpt-6.1-sol` runs the review on every commit, and a Claude judge matches each finding
  to a labelled one. It reports how many real defects were found and how many false ones reported, and lists the new
  ones. A new one gets a verdict, by reading the code, before it goes into `cases.json`.
- `verify --tool claude --model opus` hands each commit's labelled findings to the verification, and reports how many
  real ones it kept and how many false ones it dropped.

Results go to `~/.aide/review-eval/`. Run it on the serving host, as a round is run, with the same token.

On 26 October 2026, with 17 real, 13 false and 2 unclear findings labelled:

| What was measured                    | Result                                               |
| ------------------------------------ | ---------------------------------------------------- |
| Review on gpt-6.1-sol                | 8 real found, 7 false and 2 unclear reported         |
| Verification on Opus (32 findings)   | 14 of 17 real kept, 13 of 13 false dropped, about $7 |
| Verification on Sonnet (28 findings) | 9 of 16 real kept, 10 of 11 false dropped, $2.64     |

That is why `model.review` is gpt-6.1-sol and `model.verify` Opus. The three real defects Opus dropped each turn on
how the description is read.

### Planted defects and clean cases

`scripts/review_eval/planted.json` holds cases whose answer is known in advance. A planted case is a commit from
`cases.json` with one defect added by its patch in `scripts/review_eval/patches/`, applied uncommitted in a file the
commit changed, and described as a concrete case. Each patch passes the tests of its commit. A clean case is a commit
on which no finding is labelled `real` or `unclear`, so every finding on it is false. A person reads each planted
defect and clean case before a run is trusted.

- `check` calls no model: it says per case whether the commit, the description and the patch can be found, and
  whether the patch applies.
- `planted --tool codex --model gpt-6.1-sol --verify-tool claude --verify-model opus` runs, per case, the review, the
  verification of its findings as the runner does, and for a planted case a Claude judge asking whether a finding
  describes the planted defect. `--cases` takes a subset. The run's folder holds `results.md`, one line per case and
  the totals, and `results.json`, the same with the setup and a sha256 of each case.
- `compare <run A> <run B>` writes `comparison.md` into B's folder: the change per case and in total in planted
  defects found and kept, and in false findings raised and kept, with both setups.

A figure decided by a turn that failed or could not be read is `not measured`, never 0, and counts in no total. A
comparison leaves out of its totals, and lists apart, a case in one run only, one whose entry or patch changed
between the runs, and one with a figure not measured in either.

### Checks for one kind of change

`core/scripts/lib/run-spec/turn/review-checks/` holds checks that apply only to one kind of code, taken from defects
it has had. Each file names the code in a `paths:` frontmatter list of globs, as `dashboard/.claude/rules/` does, and
its body is the check. `review_prompt` and `verify_prompt` add the checks whose globs match a file the branch changed
since its fork, tracked or not, and none when no file matches. The runner and `planted` hand them the worktree, so a
measured review gets the checks the runner would send. A `*` in a glob matches across `/`. A new check is a new file
there; measure it with `planted` and `compare` before it is merged.

---

## Measuring the analysis and the plan

`scripts/plan_eval` measures how good the analysis and the plan that analyze writes
are, case by case, against an expected assessment a person has approved. A replay's
judge compares the new plan with the original one, and the original can itself be
wrong. Here the original is supporting material for the judge, never the answer.

Each case is run through replay's copies: the code at the commit before the spec's
code merged, a specs repository holding only its archived description, and `analyze`
through the runner of the Aide commit given. A judge then scores the analysis and the
plan on turns of their own, on four dimensions, each from 1 to 5 against anchors at
1, 3 and 5, with the reason and the evidence before the score:

- requirements coverage;
- affected code and interactions;
- test adequacy;
- soundness and simplicity.

The verdict is computed from the answer, not left to the judge. A serious omission
the judge finds missed fails the document, whatever its scores. Otherwise it passes
when the mean is at least 3.5 and no dimension is under 3. An answer that cannot be
read whole (a dimension, a reason, the evidence or an omission missing, a score that
is not a whole number from 1 to 5) is invalid, and counts neither as a pass nor in
any score.

The judge is `claude -p` or `codex exec`, with your own login, in an empty folder; no
API key is read. A claude analyze step needs `CLAUDE_CODE_OAUTH_TOKEN`, as a replay
does. Nothing is written to the board's queue, to the real repositories or to any
origin.

### The cases

One Markdown file per case in `scripts/plan_eval/cases/`, named for the spec's
number: 640, 647 and 653. Each pins the spec's folder, the commit before its code
merged, the commit that merged it and the sha256 of its archived description, then
lists, each item with its evidence in the description or the code at the pinned
commit:

- **Requirements** (R1, R2, …) a good analysis and plan cover;
- **Code and interactions** (C1, …) they find;
- **Tests** (T1, …) the change needs;
- **Serious omissions** (S1, …), each naming the documents it applies to in brackets,
  `(analysis, plan)` or one of them.

A case is read and edited by hand, and approved by setting its `Approved:` line from
`no` to the date. `run` refuses any case that is not approved, and any case whose
pinned commits or description hash no longer match the archive. A case's file hash
is recorded with every run, so an edited case is a new identity.

### The commands

```bash
python3 scripts/plan_eval check
python3 scripts/plan_eval run --aide-commit <sha> --analyze claude opus high \
  [--advisor opus] [--judge codex gpt-6.1-sol] [--repeat 3] [--cases 640,647]
python3 scripts/plan_eval compare <baseline run folder> <alternative run folder>
```

- `check` says per case `ready`, `not approved` or what does not match. It calls no
  model.
- `run` generates each case `--repeat` times, from 1 to 5, and judges every
  generation. The judge is `claude opus` unless `--judge` names another.
- `compare` refuses two runs unless they share their cases, pinned commits, rubric,
  judge and repeat count, and differ in exactly one of the Aide commit, the analyze
  step and the advisor. A skill or prompt change is a different `--aide-commit`, a
  model change a different `--analyze`.

Run it on the serving host, as a round is run, after checking the board's queue. A
run costs about what a replay round with analyze only costs: one analysis per case
and repeat, and two judge turns.

### The reports

A run's folder, `~/.aide/plan-eval/<date>-<time>-<aide commit>/`, holds:

- `run.json` — the identities: the Aide commit, the analyze step, the advisor, the
  judge, the rubric's hash, the repeat count, the commit the evaluator ran from, and
  per case its file hash, description hash and pinned commits;
- `results.json` and `results.md` — a row per case, document and attempt with its
  outcome, scores, the omissions missed, and the generation's and the judge's time,
  tokens and cost; per case and document the pass count and each dimension's range;
  the totals with how many parts measured each figure; every invalid judgment and
  attempt with no result, with why; and the judge's reasons and evidence;
- per case and attempt, the runner's log, result and stream, the two documents, and
  each judge turn's prompt, raw output and reply.

`compare` writes `comparison.md` into the alternative's folder: per case, document and
dimension, both setups' min–median–max, their pass counts and omissions missed, and
per setup the totals and the counts of invalid judgments and attempts with no result.

A figure that was not measured reads `not measured`, never 0 or $0.00. Codex reports
no cost.
