// What the process that starts after a deploy's restart does about the job:
// it checks the commit it runs and writes the result file, which the boot's
// `Runner.reconcile` then ends the job on. The old process fired the restart
// and is gone; this is the only one left to say whether it took.

import type { Sentence } from "../../i18n/message.ts";
import { isDeployJob, type Job, type QueueStore } from "../../queue/queue.ts";
import { stepLogLine } from "../land-branch/test-gate.ts";
import { DEPLOY_RESTART_WAIT_MS } from "../serve-helpers";
import { deployMark, type DeployMark, type DeployStep } from "./plan.ts";
import { writeDeployDone, writeDeployFailed } from "./result.ts";

export interface AfterRestartDeps {
  queue: Pick<QueueStore, "list">;
  /** The checkout this process runs from. */
  dashboardRoot: string;
  /** Runs git in `root`, to completion. */
  git: (root: string, args: string[]) => { code: number; stdout: string };
  setFault: (fault: Sentence | null) => void;
  now?: () => number;
  restartWaitMs?: number;
  /** When this process booted: a job its own process fired is not its to finish. */
  startedAt?: string;
}

/** The commit this process runs, or undefined when git cannot say. */
function runningCommit(deps: AfterRestartDeps): string | undefined {
  const head = deps.git(deps.dashboardRoot, ["rev-parse", "HEAD"]);
  return head.code === 0 && head.stdout.trim() ? head.stdout.trim() : undefined;
}

/** Whether `served` is the fetched commit or a later one containing it: a
 *  landing into the checkout moves it on while the restart waits. */
function containsFetched(deps: AfterRestartDeps, served: string, fetched: string): boolean {
  if (served === fetched) return true;
  return deps.git(deps.dashboardRoot, ["merge-base", "--is-ancestor", fetched, served]).code === 0;
}

function finish(deps: AfterRestartDeps, job: Job & { resultFile: string }): void {
  const mark = (step: DeployStep, ending: DeployMark): void => stepLogLine(job, deployMark(step, ending), ending.startsWith("stopped"));
  const fail = (step: DeployStep, sentence: Sentence): void => {
    mark(step, `stopped: ${writeDeployFailed(job.resultFile, sentence)}`);
  };
  const waited = (deps.now ?? Date.now)() - Date.parse(job.deploy?.restartedAt ?? "");
  if (waited > (deps.restartWaitMs ?? DEPLOY_RESTART_WAIT_MS)) return fail("wait", { key: "landing.deployNoAnswer" });
  mark("wait", "done");
  mark("check", "started");
  const fetched = job.deploy?.commit;
  if (!fetched) {
    mark("check", "done");
    return writeDeployDone(job.resultFile);
  }
  const served = runningCommit(deps);
  if (!served) return fail("check", { key: "landing.deployNoAnswer" });
  if (containsFetched(deps, served, fetched)) {
    mark("check", "done");
    return writeDeployDone(job.resultFile);
  }
  const older: Sentence = { key: "landing.deployServiceOlder", values: { served: served.slice(0, 7), head: fetched.slice(0, 7) } };
  deps.setFault(older);
  fail("check", older);
}

/** Finish every deploy job the last process left running after its restart. */
export function finishDeployAfterRestart(deps: AfterRestartDeps): void {
  for (const job of deps.queue.list()) {
    if (job.state !== "running" || !isDeployJob(job) || !job.deploy?.restartedAt || !job.resultFile) continue;
    if (deps.startedAt && job.deploy.leaving === deps.startedAt) continue;
    finish(deps, job as Job & { resultFile: string });
  }
}
