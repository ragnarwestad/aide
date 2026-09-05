# The hand-paired bash/TypeScript pairs

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. `CLAUDE.md` states the rule; this page
carries the detail.

## Table of contents

- [The pairs](#the-pairs)
- [Not a pair: the workflow's own vocabulary](#not-a-pair-the-workflows-own-vocabulary)
- [Not a pair: the effort levels](#not-a-pair-the-effort-levels)
- [Not a pair: spec-phase transitions](#not-a-pair-spec-phase-transitions)

---

## The pairs

Each pair is pinned by a test that reads both sides, so drift is caught —
but the two copies still have to be edited by hand together.

| Decision                                                                                                                                                     | bash                                                                          | TypeScript                                                                                                          | Pinned by                                                                                                                                                                                          |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Project readiness — the read-only prerequisites a run needs                                                                                                  | `aide-run-spec`                                                               | `assessProjectReadiness()` in `dashboard/src/project/project-admin/readiness.ts`                                    | `tests/fixtures/project-readiness-prerequisites.json`                                                                                                                                              |
| `worktreeLinks` precedence — manifest over `.aide/config`                                                                                                    | `aide_manifest_get` + `aide-run-spec`                                         | `resolveWorktreeLinks` in `dashboard/src/project/discover/config.ts`                                                | `tests/fixtures/worktree-links-precedence.json`                                                                                                                                                    |
| `errorReason` — `"conflict" \| "unlanded" \| "tests-red"`                                                                                                    | —                                                                             | `dashboard/src/queue/types.ts` and `dashboard/src/render/ui/job-state/types.ts`, which do not import each other     | `dashboard/test/queue/requests/parsing-schedule-and-errors.test.ts` reads both as text                                                                                                             |
| `codeLanding` — whether code is reviewed before it lands                                                                                                     | one anchored `sed` in `aide-run-spec`                                         | `resolveCodeLanding` in `dashboard/src/project/discover/config.ts`                                                  | `tests/fixtures/code-landing-precedence.json`                                                                                                                                                      |
| `AIDE_INSTALL_CMD`/`AIDE_TEST_CMD` precedence — `.aide/config` over the manifest's `installCmd`/`testCmd` (spec 345, the reverse order from `worktreeLinks`) | `aide_resolve_override` in `_aide-spec-lib.sh`                                | `resolveInstallCmd`/`resolveTestCmd` in `dashboard/src/project/discover/config.ts`                                  | `tests/fixtures/config-cmd-precedence.json`                                                                                                                                                        |
| The status-mark rule — which Status cells count as done                                                                                                      | `total_progress_for` in `aide-run-spec`                                       | `isDoneMark` in `dashboard/src/project/parse-status.ts`                                                             | `tests/fixtures/status-row-counting.json`                                                                                                                                                          |
| An error sentence says what happened AND what resolves it (spec 352)                                                                                         | `refuse()`'s callers and the provider/tool-failure strings in `aide-run-spec` | `errorSentence()` in `dashboard/src/render/ui/error-sentence.ts`, and every producer that follows its shape by hand | `dashboard/test/render/ui/error-sentence-registry.test.ts` and `tests/specs/unit/core/scripts/run_spec/run_spec_project_state.py`'s `BASH_ERROR_REGISTRY`, each reading its own side's source text |
| The push-retry bound — unreachable origin is retried this many times, waited this long, before it is reported (spec 359)                                     | `PUSH_RETRY_WAITS` and `push_with_retry()` in `aide-run-spec`                 | `PUSH_RETRY_WAITS_MS` and `pushWithRetry()` in `dashboard/src/git/branch-merge.ts`                                  | `dashboard/test/git/merge/branch-merge-push-retry.test.ts`'s own bound-pinning test, reading both sides' source text                                                                               |

Two known asymmetries in the readiness pair are named in that test's own
exclusion list rather than in the fixture: `specsRepo` is a check the
dashboard makes blocking that `aide-run-spec` does not refuse on, and
`dashboardCheckout` has no `aide-run-spec` counterpart at all.

## Not a pair: the workflow's own vocabulary

The workflow's own vocabulary is NOT one of these pairs (spec 349):
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

**The effort levels a step may run at are also not a hand-paired pair**
(spec 364): `core/scripts/lib/effort-levels.json` is the one file both
sides read — `aide-run-spec` with jq, the dashboard by import — for the
`low`/`medium`/`high`/`xhigh`/`max` levels Claude Code's `--effort` flag
accepts. `ultracode` is deliberately excluded from the list, since it
turns on multi-agent workflow orchestration rather than naming a plain
effort level. As with `workflow-steps.json`, `dashboard/src/queue/steps.ts`
carries a runtime assertion that throws if its `EffortLevel` type ever
disagrees with the shared file.

## Not a pair: spec-phase transitions

**Whether a spec may move from one phase to another is also not a
hand-paired pair (spec 356).** `core/scripts/lib/transitions.json` is the
one table — every `(phase, event)` row, its next phase or refusal, and the
condition it needs — read by both `core/scripts/lib/spec-transitions.sh`
(`may_apply_spec_transition` for a read-only check, `apply_spec_transition`
for the one write) and `dashboard/src/queue/spec-transitions.ts`
(`isLegalMove`, read-only, used in `job-actions.ts` to refuse a backward
move — `analyze` requested on a spec that has already implemented — before
it reaches the queue). No other code writes a phase-changing stamp or
`completedPhases` entry; a guard test greps for the stamp patterns
themselves to catch a stray writer regardless of mechanism, and a second
guard test keeps `dashboard/docs/spec-lifecycle.md`'s diagram in agreement
with the table's rows.

`DEPENDENCY_GATED_STEPS` is `implement` and `archive`, and "merged" means
ARCHIVED: a dependent spec's held-back steps are released when the
dependency's `archive` step runs. The dashboard's copy decides whether a
queued job is PARKED (left `queued` with the reason on its row); the
script's copy decides whether a run started by hand is REFUSED. The
acceptance-criteria gate has the same two halves: `blockedForUntickedAcceptance`
in `dashboard/src/serve/schedules.ts` parks a queued `archive` while the
state file has an open row, and `aide-archive-spec` refuses a run that
reaches it anyway. Both that check and the row's "archive held back"
read the BRANCH copy of the state file first (`BranchFileStepsChecker`'s
`acceptanceOpen`): a tick on a spec whose `aide/<folder>` is open is
written there, and the disk copy stays unticked until archive lands.
`blockedForMissingAnalyze` reads the same branch copy first for the same
reason: a chained job's analyze is on the branch the moment the step
ends, whether or not its landing reached main.
