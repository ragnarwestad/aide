import type { Job } from "../../queue/queue.ts";
import type { SpawnResult } from "../../queue/runner";
import { boardStep } from "../board-step.ts";
import { holdLanding } from "../../queue/runner/landing.ts";
import { landBranch } from "../land-branch/merge.ts";
import type { LandContext } from "../land-branch/types.ts";

const TASKS = ["Merge branch", "Run tests", "Push default branch", "Delete source branch"];

export function createLandJob(ctx: LandContext) {
  return {
    start(job: Job, resultFile: string, streamFile: string): SpawnResult {
      const output = boardStep({ resultFile, streamFile });
      const branch = job.branch;
      if (!branch) {
        output.failed("invalid-request", "the Land job has no branch");
        return { pid: process.pid, pgid: 0 };
      }
      const root = ctx.machineryProjectDir(job.project);
      output.mark("1 of 4", TASKS[0]!, "started");
      const work = landBranch(ctx, job, {
        branch,
        branchUrls: [{ root, url: `origin/${branch}` }],
      }, {
        step: "land",
        repos: [{ root, url: `origin/${branch}` }],
        failedNote: (why) => ({ key: "landing.stepLandingFailed", values: { step: "Land", why, button: "Land" } }),
      }).then(() => {
        const settled = ctx.queue.get(job.id);
        if (settled?.landingError || settled?.errorReason === "conflict" || settled?.errorReason === "tests-red") {
          output.mark("1 of 4", TASKS[0]!, `stopped: ${settled.errorReason ?? "landing failed"}`);
          output.failed(settled.errorReason ?? "landing-failed", "Land did not reach the default branch", Array.isArray(settled.error) ? settled.error[0] : settled.error);
          return;
        }
        output.mark("1 of 4", TASKS[0]!, "done");
        for (let i = 1; i < TASKS.length; i++) output.mark(`${i + 1} of 4`, TASKS[i]!, "done");
        output.done();
      }).catch((error) => output.failed("landing-failed", String(error)));
      const held = holdLanding(ctx.queue, job.id, work);
      ctx.queue.update(job.id, held.patch);
      void held.settled;
      return { pid: process.pid, pgid: 0 };
    },
  };
}
