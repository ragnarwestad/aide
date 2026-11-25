import { formatSentence } from "../../messages/format.ts";
import { beginLand, checkLandStop, endLand } from "./control.ts";
import type { Job } from "../../queue/queue.ts";
import type { SpawnResult } from "../../queue/runner";
import { boardStep } from "../board-step.ts";
import { holdLanding } from "../../queue/runner/landing.ts";
import { landBranch } from "../land-branch/merge.ts";
import type { LandContext } from "../land-branch/types.ts";

const TASKS = ["Merge branch", "Run tests", "Push default branch", "Delete source branch"];

type Land = typeof landBranch;

type StepOutput = ReturnType<typeof boardStep>;

/** The four tasks a Merge job's Log shows, and which one is running. */
interface TaskMarks {
  progress: (stage: "tests" | "push" | "delete") => void;
  /** Marks the running task with `status`. */
  mark: (status: string) => void;
  current: () => string;
}

export function createLandJob(ctx: LandContext, land: Land = landBranch) {
  return {
    start(job: Job, resultFile: string, streamFile: string): SpawnResult {
      const stepStartedAt = job.stepStartedAt ?? new Date().toISOString();
      const output = boardStep({ resultFile, streamFile, startedAt: stepStartedAt });
      const branch = job.branch;
      if (!branch) {
        output.failed("invalid-request", "the Merge job has no branch");
        return { pid: process.pid, pgid: 0 };
      }
      beginLand(job.id);
      const root = ctx.machineryProjectDir(job.project);
      const tasks = taskMarks(ctx, job, output);
      output.note(`Merge branch: ${branch}`);
      output.mark("1 of 4", TASKS[0]!, "started");
      const work = land(ctx, { ...job, resultFile, streamFile, stepStartedAt }, {
        branch,
        branchUrls: [{ root, url: `origin/${branch}` }],
      }, {
        step: "land",
        cancelled: () => ctx.queue.get(job.id)?.state === "cancelled",
        repos: [{ root, url: `origin/${branch}` }],
        progress: tasks.progress,
        failedNote: (why) => ({ key: "landing.stepLandingFailed", values: { step: "Merge", why, button: "Merge" } }),
      }).then(() => reportSettled(ctx, job, output, tasks))
        .catch((error) => ctx.queue.get(job.id)?.state === "cancelled" ? stopped(output, tasks) : output.failed("landing-failed", String(error)))
        .finally(() => endLand(job.id));
      const held = holdLanding(ctx.queue, job.id, work);
      ctx.queue.update(job.id, held.patch);
      void held.settled;
      return { pid: process.pid, pgid: 0 };
    },
  };
}

function taskMarks(ctx: LandContext, job: Job, output: StepOutput): TaskMarks {
  let currentTask = 0;
  const mark = (status: string): void => output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, status);
  const progress = (stage: "tests" | "push" | "delete"): void => {
    checkLandStop(job.id);
    if (stage === "push") {
      ctx.queue.update(job.id, { landPushStarted: true });
    }
    const next = { tests: 1, push: 2, delete: 3 }[stage];
    if (next <= currentTask) return;
    mark("done");
    currentTask = next;
    mark("started");
  };
  return { progress, mark, current: () => TASKS[currentTask]! };
}

/** What the Merge job's Log says once the landing has settled. */
function reportSettled(ctx: LandContext, job: Job, output: StepOutput, tasks: TaskMarks): void {
  const settled = ctx.queue.get(job.id);
  if (settled?.state === "cancelled") return stopped(output, tasks);
  if (settled?.branchDeleteError) {
    const deleteError = Array.isArray(settled.branchDeleteError) ? settled.branchDeleteError[0] : settled.branchDeleteError;
    tasks.mark("stopped: branch delete failed");
    output.failed("branch-delete-failed", "Merge left the source branch on origin", deleteError);
    return;
  }
  if (settled?.landingError || settled?.errorReason === "conflict" || settled?.errorReason === "tests-red") {
    const cause = settled.landingError ?? settled.error;
    const reason = formatSentence("en", cause) || settled.errorReason || "landing failed";
    tasks.mark(`stopped: ${reason}`);
    output.failed(settled.errorReason ?? "landing-failed", `${tasks.current()}: ${reason}`, Array.isArray(cause) ? cause[0] : cause);
    return;
  }
  tasks.mark("done");
  output.done();
}

function stopped(output: StepOutput, tasks: TaskMarks): void {
  tasks.mark("stopped: cancelled by user");
  output.failed("cancelled", "Merge stopped by user");
}
