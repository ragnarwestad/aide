// The board's own deploy as a job in the queue (the `deploy` step): started by
// the runner like any step, run inside this process by `run.ts`, and finished
// by the process that starts after its restart, `after-restart.ts`.

import type { SpawnResult } from "../../queue/runner";
import type { Job } from "../../queue/queue.ts";
import { STARTED_AT } from "../state.ts";
import { finishDeployAfterRestart, type AfterRestartDeps } from "./after-restart.ts";
import { runDeploy, type DeployRunDeps } from "./run.ts";

export interface DeployJobInputs extends Omit<DeployRunDeps, "startedAt" | "queue"> {
  queue: DeployRunDeps["queue"] & AfterRestartDeps["queue"];
  /** The checkout this process runs from; without one there is nothing to finish. */
  dashboardRoot: string | undefined;
  git?: AfterRestartDeps["git"];
}

/** Runs git in `root` and waits for it. */
const gitSync: AfterRestartDeps["git"] = (root, args) => {
  const done = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "ignore" });
  return { code: done.exitCode, stdout: done.stdout.toString() };
};

export function createDeployJob(inputs: DeployJobInputs) {
  const deps: DeployRunDeps = { ...inputs, startedAt: STARTED_AT };
  return {
    /** The runner's spawn for a `deploy` step. The run is this process, so
     *  the pid is its own and there is no group to signal (`pgid` 0 is
     *  never signalled). */
    start(job: Job, resultFile: string): SpawnResult {
      void runDeploy(deps, job.id, resultFile).catch((err) => console.error(`queue: deploy ${job.id} — ${String(err)}`));
      return { pid: process.pid, pgid: 0 };
    },
    /** At boot, right before the runner reconciles. */
    finishAfterRestart(): void {
      if (!inputs.dashboardRoot) return;
      finishDeployAfterRestart({
        queue: inputs.queue,
        dashboardRoot: inputs.dashboardRoot,
        git: inputs.git ?? gitSync,
        setFault: inputs.setFault,
        startedAt: STARTED_AT,
      });
    },
  };
}
