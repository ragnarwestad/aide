# The hand-paired bash/TypeScript pairs

## Table of contents

- [The pairs](#the-pairs)
- [Not a pair: where a project's specs live](#not-a-pair-where-a-projects-specs-live)
- [Not a pair: the workflow's own vocabulary](#not-a-pair-the-workflows-own-vocabulary)
- [Not a pair: the effort levels](#not-a-pair-the-effort-levels)
- [Not a pair: spec-phase transitions](#not-a-pair-spec-phase-transitions)

---

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. `CLAUDE.md` states the rule; this page
carries the detail.


## The pairs

Each pair is pinned by a test that reads both sides, so drift is caught —
but the two copies still have to be edited by hand together.

| Decision                                                                                                                                                               | bash                                                                                               | TypeScript                                                                                                       | Pinned by                                                                                                                        |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| Project readiness — the read-only prerequisites a run needs                                                                                                            | `aide-run-spec`                                                                                    | `assessProjectReadiness()` in `dashboard/src/project/project-admin/readiness.ts`                                 | `tests/fixtures/project-readiness-prerequisites.json`                                                                            |
| `worktreeLinks` precedence — manifest over `.aide/config`                                                                                                              | `aide_manifest_get` + `aide-run-spec`                                                              | `resolveWorktreeLinks` in `dashboard/src/project/discover/config.ts`                                             | `tests/fixtures/worktree-links-precedence.json`                                                                                  |
| An untracked `.aide/project.yaml` is copied into a worktree or tree, kept out of the commit and the hash; tracked, or git unable to say, is left alone                 | `carry_manifest_into_worktree` and `aide_tree_hash` (bash)                                         | `checkoutForGate` in `dashboard/src/serve/land-branch/test-gate.ts`                                              | `tests/fixtures/manifest-carry.json`, read by `test_aide_run_spec_manifest.py` and `gate-carries-manifest.test.ts`               |
| `errorReason` — `"conflict" \| "held-back" \| "tests-red" \| "unlanded"`                                                                                               | —                                                                                                  | `dashboard/src/queue/types.ts` and `dashboard/src/render/ui/job-state/types.ts`, which do not import each other  | `dashboard/test/queue/requests/parsing-schedule-and-errors.test.ts` reads both as text                                           |
| `codeLanding` — whether code is reviewed before it lands                                                                                                               | one anchored `sed` in `aide-run-spec`                                                              | `resolveCodeLanding` in `dashboard/src/project/discover/config.ts`                                               | `tests/fixtures/code-landing-precedence.json`                                                                                    |
| The status-mark rule — which Status cells count as done                                                                                                                | `status_progress_for` in `core/scripts/lib/status-progress.sh`                                     | `isDoneMark` in `dashboard/src/project/parse-status/index.ts`                                                    | `tests/fixtures/status-row-counting.json`                                                                                        |
| An error sentence says what happened AND what resolves it                                                                                                              | `refuse()`'s callers and the provider/tool-failure strings in `aide-run-spec`                      | `errorSentence()` in `dashboard/src/format/error-sentence.ts`, and every producer that follows its shape by hand | `tests/specs/unit/core/scripts/run_spec/run_spec_project_state.py`'s `BASH_ERROR_REGISTRY`, reading the bash side's source text  |
| Which terminal reason lands a step — `close` on `closed`, `archive` on `completed`                                                                                     | `terminal_reason` in `aide-run-spec` and `run-spec-result.sh`, from `aide-close-spec`'s own answer | the per-step branches in `dashboard/src/serve/runner-setup.ts`                                                   | `dashboard/test/queue/close-lands-on-the-word-bash-reports.test.ts`, reading both sides' source text                             |
| The push-retry bound — unreachable origin is retried this many times, waited this long, before it is reported                                                          | `PUSH_RETRY_WAITS` and `push_with_retry()` in `aide-run-spec`                                      | `PUSH_RETRY_WAITS_MS` and `pushWithRetry()` in `dashboard/src/git/branch-merge.ts`                               | `dashboard/test/git/merge/branch-merge-push-retry.test.ts`'s own bound-pinning test, reading both sides' source text             |
| Which archive refusals are guards, not attempts — left out of the phase's attempt count                                                                                | the `case "$terminal_reason"` arm in `core/scripts/lib/run-spec-outcome.sh`                        | `GUARD_REFUSALS` in `dashboard/src/render/pages/specs-list/phase-rows.ts`                                        | `dashboard/test/queue/guard-refusals-are-not-attempts.test.ts`, reading both sides' source text                                  |
| A wiki page's state — `current`, `changed`, `unknown` or `hand-written` — from its front matter and the project's checkout; the mark `wiki: generated` is read in both | `status` in `core/scripts/aide-wiki`                                                               | `pageStates()` and `splitPage()` in `dashboard/src/project/wiki/`                                                | `dashboard/test/project/wiki/state.test.ts`, which runs both on one repository                                                   |
| A skill-step mark — `--- Step N of X: <title> — started`, or ending `done`, `skipped:` or `stopped:` — written by the model and shown as a line of its own in the Log  | `step_log_note` in `core/scripts/lib/run-spec-invocation.sh`                                       | `STEP_MARK` and `splitMarks()` in `dashboard/src/queue/parse-stream/shared.ts`                                   | `dashboard/test/queue/requests/parse-stream-step-marks.test.ts`, which reads the prompt's text and parses every line it asks for |
| Which stop reasons end a step failed — the script's own, less the two limits and a cancel                                                                              | `terminal_reason` in `aide-run-spec` and `core/scripts/lib/run-spec-*.sh`                          | `FAILED_STOPS` in `dashboard/src/format/stop-reason.ts`                                                          | `dashboard/test/format/stop-reason.test.ts`, which reads every reason in the scripts and fails on one that is unclassified       |

Two differences in the wiki-state pair are left out of that test on purpose:

- A `files:` entry that is a folder — matches nested files in bash's pathspec and matches nothing in TypeScript (the
  schema forbids folders and `aide-wiki write` refuses them).
- Where git cannot answer the `diff` — bash prints `current` while the dashboard prints `unknown`.

The done rule accepts `✅`, `completed` and `Not verified`; `Failed` (with or without a symbol) is not done. The awk copies
need no change for it, only `spec-state.sh` flags it on the Acceptance rows. Only an Acceptance row also carries the separate
`notVerified` or `failed` flag (in `4-status.json` and on `StatusCheck`), so a reader that draws a row can tell a deferred check
from a tick while every gate keeps reading `done`.

Two known asymmetries in the readiness pair are named in that test's own
exclusion list rather than in the fixture:

- `specsRepo` — a check the dashboard makes blocking that `aide-run-spec`
  does not refuse on.
- `dashboardCheckout` — has no `aide-run-spec` counterpart at all.

## Not a pair: where a project's specs live

**A run is TOLD where its spec folders are; it does not work it out
alongside the dashboard.** The dashboard passes `--specs-root` from the
same answer its own landing uses (`machinerySpecsRoot`), and
`aide-run-spec` prefers that flag over `AIDE_SPECS_PATH` in
`.aide/config`. Left out — a run started by hand — the script reads the
config.

The run and the landing have to agree on this one answer: a create that
makes its folder somewhere the landing does not look can never be given
its number.

Each side has a test of its own, and neither reads the other:

- `tests/specs/unit/core/scripts/run_spec/test_aide_run_spec_specs_root_flag.py`
  — holds the script:
  - the flag wins;
  - the config still decides without it;
  - a root that is not there is refused by name, except for `create`,
    which makes a missing root that lies inside the project. The test
    covers a root outside the project only.
- `dashboard/test/queue-routes/runner/runner-specs-root-argv.test.ts` —
  holds `runnerArgv`: it passes on the root it is handed, ahead of
  `--command`.

Nothing tests that the root handed to it is the dashboard's own answer
(`specsRoot: ctx.machinerySpecsRoot(job.project)` in `runner-setup.ts`),
and a flag renamed on one side fails neither test.

## Not a pair: the workflow's own vocabulary

The workflow's own vocabulary is NOT one of these pairs:
`core/scripts/lib/workflow-steps.json` is the one file both sides read —
`aide-run-spec` with jq, the dashboard by import — for the steps that
exist, the steps an unarchived dependency holds back, and the four-stage
workflow arc (`create`, `analyze`, `implement`, `archive`). Only
`dashboard/src/queue/steps.ts`'s `WorkflowStep` TYPE stays hand-written,
since a JSON import cannot give TypeScript a literal union; a runtime
assertion in that file throws if it ever disagrees with the shared file.
Review is part of `analyze`, not a stage: the three-reviewer routine runs
inline in `core/skills/aide-analyze/SKILL.md`, as separate Agent
invocations blind to the analyst's own reasoning.

## Not a pair: the effort levels

**The effort levels a step may run at are also not a hand-paired pair.**
`core/scripts/lib/effort-levels.json` is the one file both
sides read — `aide-run-spec` with jq, the dashboard by import — for the
`low`/`medium`/`high`/`xhigh`/`max` levels Claude Code's `--effort` flag
accepts. `ultracode` is deliberately excluded from the list, since it
turns on multi-agent workflow orchestration rather than naming a plain
effort level. As with `workflow-steps.json`, `dashboard/src/queue/steps.ts`
carries a runtime assertion that throws if its `EffortLevel` type ever
disagrees with the shared file.

## Not a pair: spec-phase transitions

**Whether a spec may move from one phase to another is also not a
hand-paired pair.** `core/scripts/lib/transitions.json` is the
one table — every `(phase, event)` row, its next phase or refusal, and the
condition it needs — read by both:

- `core/scripts/lib/spec-transitions.sh` — `may_apply_spec_transition`
  for a read-only check, `apply_spec_transition` for the one write.
- `dashboard/src/queue/spec-transitions.ts` — `isLegalMove`, read-only,
  used in `job-actions.ts` to refuse a backward move (`analyze` requested
  on a spec that has already implemented) before it reaches the queue.

No other code writes a phase-changing stamp or
`completedPhases` entry; a guard test greps for the stamp patterns
themselves to catch a stray writer regardless of mechanism, and a second
guard test keeps `dashboard/docs/spec-lifecycle.md`'s diagram in agreement
with the table's rows.

`DEPENDENCY_GATED_STEPS` is `implement` and `archive`, and "merged" means
ARCHIVED: a dependent spec's held-back steps are released when the
dependency's `archive` step runs. The two copies decide different things:

- The dashboard's copy — whether a queued job is PARKED (left `queued`
  with the reason on its row).
- The script's copy — whether a run started by hand is REFUSED.

When origin cannot be asked — no default branch, a fetch that failed —
the two differ on purpose:

- The script — lets the run go ahead.
- The dashboard — parks the job and asks again every tick for up to
  `UNCONFIRMED_HOLD_MS` before releasing it, so a moment's failure does
  not start a job into the script's refusal.

The acceptance-criteria gate is
the script's alone: `aide-archive-spec` refuses an `archive` whose state
file has an open row, and the row's "archive held back" reads the BRANCH
copy of the state file first (`BranchFileStepsChecker`'s
`acceptanceOpen`): a tick on a spec whose `aide/<folder>` is open is
written there, and the disk copy stays unticked until archive lands.
`blockedForMissingAnalyze` reads the same branch copy first for the same
reason: a chained job's analyze is on the branch the moment the step
ends, whether or not its landing reached main.
