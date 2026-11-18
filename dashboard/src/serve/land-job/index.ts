import { formatSentence } from "../../messages/format.ts";
import { beginLand, checkLandStop, endLand } from "./control.ts";
import type { Job } from "../../queue/queue.ts";
import type { SpawnResult } from "../../queue/runner";
import { boardStep } from "../board-step.ts";
import { holdLanding } from "../../queue/runner/landing.ts";
import { landBranch } from "../land-branch/merge.ts";
import { removeLandedCopy } from "../../git/branch-merge/landed-copy.ts";
import type { LandContext } from "../land-branch/types.ts";

const TASKS = ["Merge branch", "Run tests", "Push default branch", "Delete source branch"];

type Land = typeof landBranch;

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
      let currentTask = 0;
      const progress = (stage: "tests" | "push" | "delete"): void => {
        checkLandStop(job.id);
        if (stage === "push") {
          ctx.queue.update(job.id, { landPushStarted: true });
        }
        const next = { tests: 1, push: 2, delete: 3 }[stage];
        if (next <= currentTask) return;
        output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, "done");
        currentTask = next;
        output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, "started");
      };
      output.note(`Merge branch: ${branch}`);
      output.mark("1 of 4", TASKS[0]!, "started");
      const work = land(ctx, { ...job, resultFile, streamFile, stepStartedAt }, {
        branch,
        branchUrls: [{ root, url: `origin/${branch}` }],
      }, {
        step: "land",
        cancelled: () => ctx.queue.get(job.id)?.state === "cancelled",
        repos: [{ root, url: `origin/${branch}` }],
        progress,
        failedNote: (why) => ({ key: "landing.stepLandingFailed", values: { step: "Merge", why, button: "Merge" } }),
      }).then(async () => {
        const settled = ctx.queue.get(job.id);
        if (settled?.state === "cancelled") return stopped();
        if (settled?.branchDeleteError) {
          const deleteError = Array.isArray(settled.branchDeleteError) ? settled.branchDeleteError[0] : settled.branchDeleteError;
          output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, "stopped: branch delete failed");
          output.failed("branch-delete-failed", "Merge left the source branch on origin", deleteError);
          return;
        }
        if (settled?.landingError || settled?.errorReason === "conflict" || settled?.errorReason === "tests-red") {
          const cause = settled.landingError ?? settled.error;
          const reason = formatSentence("en", cause) || settled.errorReason || "landing failed";
          output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, `stopped: ${reason}`);
          output.failed(settled.errorReason ?? "landing-failed", `${TASKS[currentTask]}: ${reason}`, Array.isArray(cause) ? cause[0] : cause);
          return;
        }
        output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, "done");
        if (job.landFrom) await cleanUpSessionCopy(job.landFrom, branch);
        output.done();
      }).catch((error) => ctx.queue.get(job.id)?.state === "cancelled" ? stopped() : output.failed("landing-failed", String(error)))
        .finally(() => endLand(job.id));
      async function cleanUpSessionCopy(checkout: string, landed: string): Promise<void> {
        const base = await ctx.branchStatus.defaultBranch(root);
        if (!base) return;
        const { removed, kept } = await removeLandedCopy(ctx.gitRun, checkout, landed, base);
        for (const what of removed) output.note(`Removed ${what} in ${checkout}`);
        for (const what of kept) output.note(`Kept ${what}`);
      }
      function stopped(): void {
        output.mark(`${currentTask + 1} of 4`, TASKS[currentTask]!, "stopped: cancelled by user");
        output.failed("cancelled", "Merge stopped by user");
      }
      const held = holdLanding(ctx.queue, job.id, work);
      ctx.queue.update(job.id, held.patch);
      void held.settled;
      return { pid: process.pid, pgid: 0 };
    },
  };
}
