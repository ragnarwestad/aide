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

---

## What a replay is

`scripts/replay_specs` runs archived specs again, with another model or another
version of the skills, and compares the result with what the spec produced the
first time. It is how Aide decides which model runs a step.

For each spec it is given, the script:

1. copies the project's code repository at the commit just before the spec's code
   landed;
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

| Column                    | What it says                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Files found               | How many of the files the original landing changed the new analysis named, and how many it named that were not changed |
| Must-fix, Should-fix      | The counts from the new plan's review                                                                                  |
| Every AC placed           | Whether every acceptance criterion has a place for its test in the plan                                                |
| Green, Rounds             | Whether implement ended on a green suite, and after how many test rounds                                               |
| Original tests            | How many of the original spec's tests pass against the new code                                                        |
| Judge                     | A score from 1 (clearly worse than the original plan) to 5 (clearly better); 3 means as good                           |
| Time/tokens/cost per step | For analyze, implement and the judge                                                                                   |

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
(`run-spec/turn/review-prompts.sh`) in a detached worktree of each commit.

- `review --tool codex --model gpt-6.1-sol` runs the review on every commit, and a Claude judge matches each finding
  to a labelled one. It reports how many real defects were found and how many false ones reported, and lists the new
  ones. A new one gets a verdict, by reading the code, before it goes into `cases.json`.
- `verify --tool claude --model opus` hands each commit's labelled findings to the verification, and reports how many
  real ones it kept and how many false ones it dropped.

Results go to `~/.aide/review-eval/`. Run it on the serving host, as a round is run, with the same token.

On 26 October 2026, with 17 real, 13 false and 2 unclear findings labelled:

| What was measured                   | Result                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| Review on gpt-6.1-sol               | 8 real found, 7 false and 2 unclear reported            |
| Verification on Opus (28 findings)  | 13 of 16 real kept, 11 of 11 false dropped, $6.18       |
| Verification on Sonnet (28 findings)| 9 of 16 real kept, 10 of 11 false dropped, $2.64        |

That is why `model.review` is gpt-6.1-sol and `model.verify` Opus. The three real defects Opus dropped each turn on
how the description is read.
