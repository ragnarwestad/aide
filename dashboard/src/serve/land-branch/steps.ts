// The four thin `Landing` descriptions each workflow step's own landing
// is built from.

import { mergeBranchRefs, type Job, type WorkflowStep } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner.ts";
import { landBranch } from "./merge.ts";
import { stampTotalDuration } from "./duration.ts";
import type { LandContext } from "./types.ts";

/** Put a newly created spec where the page can see it (spec 93).
 *
 *  This was the first merge on the dashboard that no one pressed a
 *  button for, and it is not a convenience: the spec list shows what is
 *  on disk in the main checkout, which every run is careful never to
 *  leave its default branch, so a created spec that is only pushed to
 *  a branch appears nowhere at all. A spec waiting on the page until
 *  somebody noticed and merged it by hand would not be the feature
 *  with one extra click — it would be the feature not working. */
export async function landNewSpec(ctx: LandContext, job: Job, outcome: Partial<StepOutcome>): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step: "create",
    landed: { specFolder: outcome.specFolder ?? job.specFolder },
    nothingToLand:
      "the spec was created, but the run reported no pushed branch to land it from — " +
      "merge it by hand, or check the queue's push mode",
    failedNote: (why) => `the spec was created, but landing it failed: ${why}`,
  });
}

/** Land the work a middle-of-the-workflow step produced (spec 149).
 *
 *  `analyze` writes markdown in the specs repo and
 *  nothing else — the same argument that made `create` and `archive`
 *  land themselves, word for word; it was simply never given it,
 *  and the row piled up a "ready to merge" button per step for work
 *  nobody had a reason to weigh.
 *
 *  Either one lands what its OWN run reports and nothing else — the
 *  outcome's roots, never `branchesFor` history. Reading the history
 *  instead would let a step that touched only the specs repo drag an
 *  unarchived `implement`'s code onto the default branch as a side
 *  effect, which is exactly what "archive is the one step that sends
 *  code to the default branch" rules out. The residual gap is that a
 *  run whose own catch-up merge happens to move the project's HEAD
 *  lands that code early; it is accepted, and it belonged to `resolve`
 *  until spec 171 retired that step.
 *
 *  The install is neither asked for nor refused here: `landBranch`
 *  runs it for any CODE root that lands, whichever step landed it.
 *  `analyze` never has one. */
export async function landStepBranch(
  ctx: LandContext,
  job: Job,
  step: WorkflowStep,
  outcome: Partial<StepOutcome>,
): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step,
    failedNote: (why) => `the ${step} step finished, but landing it failed: ${why}`,
  });
}

/** Land what a step wrote when it did NOT finish, but ran out of time
 *  having touched no code repo (spec 187).
 *
 *  The merge is `landBranch`, unchanged — the caller has already asked
 *  the only question this case adds (did anything outside the specs
 *  repo move?). What differs is one sentence a person reads: "the
 *  analyze step finished, but landing it failed" would state as fact
 *  the one thing that did not happen, which is exactly what a reader
 *  needs to know. `nothingToLand` stays unset for the same reason `archive`
 *  leaves it unset: a run with no branch is an ordinary outcome here,
 *  and the caller returns before this is reached anyway. */
export async function landStoppedStepBranch(
  ctx: LandContext,
  job: Job,
  step: WorkflowStep,
  outcome: Partial<StepOutcome>,
): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step,
    failedNote: (why) => `the ${step} step stopped at its time limit, and landing what it wrote failed: ${why}`,
  });
}

/** Take an archived spec out of the list it has just left (spec 136).
 *
 *  The same argument as `landNewSpec`, at the other end of a spec's
 *  life: the list reads the main checkout, so a folder moved into
 *  `archive/` on a branch is still in the ACTIVE list here, and the row
 *  asks to be merged. That made the closing step end by handing back a
 *  task — 133 was archived twice on 2026-08-20 because the first run
 *  looked like it had failed.
 *
 *  Safe to do unpressed for a reason `implement` cannot claim: a
 *  headless archive writes two markdown changes in the specs repo and
 *  nothing else (`core/skills/aide-archive/SKILL.md` forbids it to
 *  touch the project's docs or to ask), so there is no diff for a
 *  person to weigh and nothing that reaches the serving host. The
 *  judgment happened before the run — someone pressed Archive, and the
 *  skill refuses to move anything a `4-status.md` does not show as
 *  finished.
 *
 *  A merge that genuinely cannot be made still refuses by name, keeps
 *  the branch on the row and leaves the spec in the list: the old
 *  behaviour is the fallback, not the thing being removed. */
export async function landArchivedSpec(ctx: LandContext, job: Job, outcome: Partial<StepOutcome>): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step: "archive",
    // The ONE landing that reads past its own outcome (spec 149).
    // `implement` deliberately never lands, so the project's code
    // branch sits open for however many steps follow — and whether an
    // archive run's own git touches that checkout is not guaranteed:
    // `update_branch_to_base` runs for every root on every step, but
    // where the code branch is already an ancestor of the default
    // branch the `--ff-only` is a no-op, so HEAD never moves and the
    // project root never appears here. `branchesFor` is the record
    // that still has it — implement's job entry keeps its
    // `branchUrls`, because nothing ever clears them.
    repos: mergeBranchRefs(ctx.queue.branchesFor(job.project, job.specFolder), outcome.branchUrls ?? []),
    // A run that pushed nothing archived nothing new — a re-run of a
    // spec already held back for the same reason writes no commit, and
    // an error there would report a problem that is not one.
    failedNote: (why) => `the spec was archived, but landing it failed: ${why}`,
    // The one landing that records anything (spec 207). It runs only
    // once the branch is genuinely on the default branch: a spec
    // whose archive did not land is not archived, and a figure
    // written for it would outlive the row that says so.
    onLanded: () => stampTotalDuration(ctx, job),
  });
}
