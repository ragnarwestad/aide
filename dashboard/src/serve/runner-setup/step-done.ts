// What the runner does the moment a step ends: the landing the step's
// policy names, the follow-on rounds a step's ending asks for, and
// moving its execution group on.
import { DEFAULT_SCHEDULE_OUTPUT_ROOT } from "../../queue/schedule.ts";
import { proposeSpecs } from "../../queue/propose-specs.ts";
import { scheduleRunPath } from "../../render";
import type { Job, WorkflowStep } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner";
import { noChangeNeeded } from "../../queue/runner/types.ts";
import { logRefusal } from "../serve-helpers";
import { enqueueRequest, followOnRequest } from "../../queue/request/index.ts";
import { moveGroupOn } from "../../queue/execution-groups/move-on.ts";
import { specsLiveInside } from "../land-branch/handed-to-merge.ts";
import { landingPolicy, STOPPED_ENDINGS_THAT_LAND, type LandingKind } from "../land-branch/policy/index.ts";
import { forgetSpecCachesFor, rereadSpecCachesFor, type RunnerSetupContext } from "./context.ts";

type Landing = Promise<unknown> | undefined;

/** What the runner does the moment a step ends: mark the spec's cached
 *  answers due, start the landing the step needs, and — for a step that
 *  needs none — read those answers again, since nothing else will until
 *  the schedule's next pass. */
export function stepDoneHandler(
  ctx: RunnerSetupContext,
): (job: Job, step: WorkflowStep | undefined, outcome: Partial<StepOutcome>) => void | Promise<unknown> {
  return (job, step, outcome) => {
    forgetSpecCachesFor(ctx, job);
    const landing = landingFor(ctx, job, step, outcome);
    if (!landing) rereadSpecCachesFor(ctx, job);
    if (step === "analyze" && outcome.terminalReason === "shared-files" && ctx.handleSharedFiles) {
      handleSharedFilesAfter(ctx, job, outcome, landing);
    }
    if (step === "implement" && outcome.terminalReason === "sent-back") {
      queueFullAnalysisRound(ctx, job, ["analyze", "implement"], landing, "sent back");
    }
    if (step === "analyze" && outcome.terminalReason === "short-analysis-over-limit" && !overLimitBefore(ctx, job)) {
      queueFullAnalysisRound(ctx, job, job.steps.slice(job.stepIndex), landing, "short analysis over a limit");
    }
    // An Analyze that found no change needed ends its member's job (runner/index.ts).
    const noChange = step === "analyze" && noChangeNeeded(outcome.noChangeNeeded) !== undefined;
    const completedGroupMember = outcome.ok && outcome.terminalReason === "completed" &&
      (step === "implement" || noChange || (step === "analyze" && step === job.steps?.filter((phase) => phase !== "archive").at(-1)));
    if (completedGroupMember) {
      const continueGroup = () => continueExecutionGroup(ctx, job, step!, noChange);
      if (landing) return landing.then(continueGroup);
      continueGroup();
    }
    if (step === "archive" && job.executionGroupId) settleArchivedGroup(ctx, job, landing);
    return landing;
  };
}

/** Hands the spec's shared files on once its landing has settled. */
function handleSharedFilesAfter(ctx: RunnerSetupContext, job: Job, outcome: Partial<StepOutcome>, landing: Landing): void {
  void Promise.resolve(landing).then(() => {
    setTimeout(() => void ctx.handleSharedFiles!(job, outcome)
      .catch((error) => logRefusal("dependencies", `${job.project}/${job.specFolder}`, String(error))), 0);
  }, (error) => logRefusal("dependencies", `${job.project}/${job.specFolder}`, String(error)));
}

/** Starts the group's next member, unless this job or its group stopped. */
function continueExecutionGroup(ctx: RunnerSetupContext, job: Job, step: WorkflowStep, noChange: boolean): void {
  const settled = ctx.store.get(job.id);
  const group = job.executionGroupId ? ctx.store.executionGroups.get(job.executionGroupId) : undefined;
  if (settled && (settled.error || settled.landingError || ["failed", "waiting", "cancelled"].includes(settled.state))) return;
  if (group?.stoppedByUser || group?.state === "stopped") return;
  moveGroupOn({ store: ctx.store, job, step, noChange, specsRoot: ctx.machinerySpecsRoot?.(job.project),
    whenSpecsScanned: ctx.whenSpecsScanned ?? ((next) => next()), log: logRefusal });
}

/** Once an archive's landing has settled: stops its group when the job
 *  was cancelled, and records how the archive ended otherwise. */
function settleArchivedGroup(ctx: RunnerSetupContext, job: Job, landing: Landing): void {
  void Promise.resolve(landing).then(() => {
    const settled = ctx.store.get(job.id);
    if (settled && settled.state === "cancelled")
      ctx.store.executionGroups.stop(job.executionGroupId!);
    else ctx.store.executionGroups.archiveSettled(job.executionGroupId!, !landing ? "held-back" : settled && !settled.error && !settled.landingError ? { prUrl: settled.prUrl } : "failed");
  });
}

/** Whether another job for the spec already has an analyze that ended
 *  `short-analysis-over-limit`: the analyze after it was not offered a short
 *  analysis and wrote one anyway, and another round would loop. */
function overLimitBefore(ctx: RunnerSetupContext, job: Job): boolean {
  return ctx.store.list().some(
    (j) =>
      j.id !== job.id &&
      j.project === job.project &&
      j.specFolder === job.specFolder &&
      j.results.some((r) => r.step === "analyze" && r.terminalReason === "short-analysis-over-limit"),
  );
}

/** A full analysis round for a spec whose analysis was found too small:
 *  `steps` on the models and effort the stopped job ran with. Queued on
 *  a timer once the landing has settled: until the runner has moved the
 *  job to `stopped` or `failed` and cleared its `landing`, the store refuses
 *  a job for the same spec (`clashing`, `landingJob`). */
function queueFullAnalysisRound(
  ctx: RunnerSetupContext,
  job: Job,
  steps: string[],
  landing: Landing,
  label: string,
): void {
  void Promise.resolve(landing)
    .catch(() => undefined)
    .then(() => {
      setTimeout(() => {
        const made = enqueueRequest(
          ctx.store,
          followOnRequest(job.project, job.specFolder, steps, job),
          "automatic",
        );
        if (!made.ok) logRefusal(label, `${job.project}/${job.specFolder}`, made.error);
      }, 0);
    });
}

function proposeScheduledSpecs(ctx: RunnerSetupContext, job: Job): void {
  proposeSpecs({
    store: ctx.store,
    outputRoot: ctx.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT,
    specsRoot: ctx.machinerySpecsRoot,
    reportPath: (name, runId) => scheduleRunPath(job.project, name, runId),
    now: () => new Date().toISOString(),
    log: logRefusal,
  }, job);
}

/** Starts the landing a step's policy names (`land-branch/policy/`). */
function startLanding(ctx: RunnerSetupContext, kind: LandingKind, job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>): Promise<unknown> {
  switch (kind) {
    case "new-spec": return ctx.landNewSpec(job, outcome);
    case "step": return ctx.landStepBranch(job, step, outcome);
    case "archive": return ctx.landArchivedSpec(job, outcome);
    case "close": return ctx.landClosedSpec(job, outcome);
    case "schedule": return ctx.landScheduleRun(job, outcome);
  }
}

function landingFor(ctx: RunnerSetupContext, job: Job, step: WorkflowStep | undefined, outcome: Partial<StepOutcome>): Landing {
  const policy = landingPolicy(step);
  if (outcome.ok) {
    // A reopen that reset the files discarded the round, and the phases
    // ticked for it go with it: the row's boxes and button start over
    // from Analyze rather than from whatever was ticked for the round
    // just discarded. A reopen that kept the files keeps the choice.
    if (step === "reopen" && job.resetFiles) ctx.store.forgetPendingSteps(job.project, job.specFolder);
    // A green scheduled run may have left proposed specs beside its
    // report: queue a Create job for each. Independent of landing —
    // the report and any proposed specs live outside every repository
    // ($AIDE_SCHEDULE_OUTPUT_DIR), so this runs whether or not the
    // same job also committed anything.
    if (step === "schedule") proposeScheduledSpecs(ctx, job);
    const ok = policy.onOk;
    if (!step || !ok) return undefined;
    if (ok.endings !== "any" && !ok.endings.includes(outcome.terminalReason ?? "")) return undefined;
    if (ok.onlyWhenPushed && (outcome.branchUrls ?? []).length === 0) return undefined;
    return startLanding(ctx, ok.landing, job, step, outcome);
  }
  // A step stopped after the runner committed and pushed its work lands
  // what it wrote: left on the branch, that work is readable only by
  // checking it out by hand. Only where no code root was pushed, since
  // code waits on its branch for `archive` — unless the ending is one
  // the policy lands past the code root, where the specs live inside it:
  // the landing then copies the spec's folder and leaves the code.
  if (!step || !policy.landsWhenStopped || !STOPPED_ENDINGS_THAT_LAND.includes(outcome.terminalReason ?? "")) {
    return undefined;
  }
  // The line the over-limit analyze recorded must reach the main checkout
  // the next prompt is read from, also where the specs live inside the code
  // root: `landStepBranch` lands the spec's own folder there and no code.
  if (outcome.terminalReason === "short-analysis-over-limit") return ctx.landStepBranch(job, step, outcome);
  const codeRoot = ctx.machineryProjectDir(job.project);
  const pushed = outcome.branchUrls ?? [];
  if (pushed.length === 0) return undefined;
  const pastCode = policy.stoppedPastCode.includes(outcome.terminalReason ?? "")
    && specsLiveInside(codeRoot, ctx.machinerySpecsRoot(job.project));
  if (pushed.some((r) => r.root === codeRoot) && !pastCode) return undefined;
  return ctx.landStoppedStepBranch(job, step, outcome);
}
