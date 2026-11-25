// What constructing the queue's `Runner` is handed, and the questions
// about a job's spec that the spawn and the step-done handler both ask.
import type { QueueStore, Job, WorkflowStep } from "../../queue/queue.ts";
import type { SpawnResult, StepOutcome } from "../../queue/runner";
import type { Notifier } from "../../integrations/notify.ts";
import { specAcceptanceNotRequired, type CodeLanding } from "../../project/discover";
import type { TestServerStore } from "../test-servers/store.ts";

export interface RunnerSetupContext {
  store: QueueStore;
  /** Handed to every step as `AIDE_QUEUE_CONFIG` and `AIDE_CHECKOUT_ROOT`,
   *  so the runner's sandbox denies writing the files this board really
   *  reads (`run-spec/setup/sandbox.sh`). Absent leaves the runner's own
   *  defaults under `~/.aide/dashboard`. */
  queueConfigFile?: string;
  dashboardCheckoutRoot?: string;
  /** Handed to every step as `AIDE_QUEUE_MIRROR`: the file this board's store
   *  writes its queue to, which the runner reads to count the steps and
   *  landings running when its test run starts. */
  queueMirrorPath?: string;
  machineryProjectDir: (project: string) => string;
  /** `machineryProjectDir`'s sibling for the specs root —
   *  `setupLand()` already takes this for the identical reason; passed
   *  here too so `Runner.tick()` can scope its landing pause to a
   *  project's actual repos rather than holding the whole board. */
  machinerySpecsRoot: (project: string) => string | undefined;
  queueRunnerBin: string | undefined;
  queueResultDir: string | undefined;
  scheduleOutputRoot: string | undefined;
  queueConcurrency: number | undefined;
  /** `Bun.serve()`'s own choice — a getter because it does not exist
   *  yet when this context is built. See `create-runner.ts`. */
  readServerPort: () => number | undefined;
  codeLanding: (project: string) => CodeLanding;
  queuePush: string | undefined;
  promptFileFor: (job: Job, step: string) => string | undefined;
  chromeFor: (job: Job, step: string) => boolean;
  noSandboxFor: (job: Job, step: string) => boolean;
  notifier: Notifier;
  landNewSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landStepBranch: (job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) => Promise<void>;
  landArchivedSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landClosedSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landStoppedStepBranch: (job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) => Promise<void>;
  handleSharedFiles?: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landScheduleRun: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  startDeploy: (job: Job, resultFile: string) => SpawnResult; startLand: (job: Job, resultFile: string, streamFile: string) => SpawnResult;
  testServerStore: TestServerStore;
  /** The spec's own on-disk folder — the same `specDir` →
   *  `peekMachinerySpecDir` chain `spec-views/spec-page.ts` already uses
   *  to reach it, added here so `analyze`'s own spawn can read the
   *  spec's RECORDED acceptance choice fresh, rather than trusting a
   *  job field that may belong to a job created long before this one. */
  specDir: (project: string, specFolder: string) => string | undefined;
  peekMachinerySpecDir: (project: string, dir: string) => string;
  /** Marks the spec's cached git answers (its workflow history, the
   *  file steps on its branch) due for a fresh read — see
   *  `forgetSpecCachesFor`. */
  forgetSpecCaches: (dir: string, specFolder: string) => void;
  /** Runs `next` once the board's first specs sweep has finished; absent, at once. */
  whenSpecsScanned?: (next: () => void) => void;
  /** Reads those answers again once the step's own result is written,
   *  and tells the page — for a step with no landing to do it. */
  rereadSpecCaches: (dir: string, specFolder: string) => void;
}

/** A step that just ended rewrote the spec's files and pushed its
 *  branch; the two answers the row is drawn from — what git history says
 *  ran, what the file on the branch claims — are cached for 30 s, and a
 *  row read from the old answers said "last run reported done, but
 *  nothing reached the files" for those seconds. */
export function forgetSpecCachesFor(
  ctx: Pick<RunnerSetupContext, "specDir" | "peekMachinerySpecDir" | "forgetSpecCaches">,
  job: Pick<Job, "project" | "specFolder">,
): void {
  const found = ctx.specDir(job.project, job.specFolder);
  if (!found) return;
  ctx.forgetSpecCaches(ctx.peekMachinerySpecDir(job.project, found), job.specFolder);
}

/** Forgetting alone leaves the old answers served until the schedule's
 *  next pass: for a step with a landing, the landing reads them again;
 *  for one without, this does. */
export function rereadSpecCachesFor(
  ctx: Pick<RunnerSetupContext, "specDir" | "peekMachinerySpecDir" | "rereadSpecCaches">,
  job: Pick<Job, "project" | "specFolder">,
): void {
  const found = ctx.specDir(job.project, job.specFolder);
  if (!found) return;
  ctx.rereadSpecCaches(ctx.peekMachinerySpecDir(job.project, found), job.specFolder);
}

/** Whether `analyze`'s own invocation of `job` should be told acceptance
 *  ticking is not required — read fresh off the
 *  spec's own `1-description.md` at spawn time, never off `job` itself:
 *  a job queued from the specs list long after `create` finished has no
 *  checkbox of its own to carry the choice on. `false`, never a throw,
 *  for a spec `specDir` cannot resolve — the same defensive shape
 *  `specAcceptanceNotRequired` already has for a missing file. */
export function acceptanceNotRequiredForAnalyze(
  ctx: Pick<RunnerSetupContext, "specDir" | "peekMachinerySpecDir">,
  job: Job,
): boolean {
  const found = ctx.specDir(job.project, job.specFolder);
  if (!found) return false;
  return specAcceptanceNotRequired(ctx.peekMachinerySpecDir(job.project, found));
}
