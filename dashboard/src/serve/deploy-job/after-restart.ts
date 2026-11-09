// What the process that starts after a deploy's restart does about the job:
// it checks the commit it runs and writes the result file, which the boot's
// `Runner.reconcile` then ends the job on. The old process fired the restart
// and is gone; this is the only one left to say whether it took.

import { renderSentence, type Sentence } from "../../i18n/message.ts";
import { t } from "../../i18n";
import { jobKind, type Job, type QueueStore } from "../../queue/queue.ts";
import { boardStep } from "../board-step.ts";
import { DEPLOY_RESTART_WAIT_MS } from "../serve-helpers";
import { DEPLOY_STEPS, type DeployMark, type DeployStep } from "./plan.ts";
import { STEP_LABEL } from "../../render/pages/projects-page/deploy-dialog.ts";

export interface AfterRestartDeps {
  queue: Pick<QueueStore, "list" | "update">;
  /** The checkout this process runs from. */
  dashboardRoot: string;
  /** Runs git in `root`, to completion. */
  git: (root: string, args: string[]) => { code: number; stdout: string };
  setFault: (fault: Sentence | null) => void;
  now?: () => number;
  restartWaitMs?: number;
  /** When this process booted: a job its own process fired is not its to finish. */
  startedAt?: string;
  restartWhenSettled?: (o: {
    onWait: (landings: string[]) => void;
    beforeFire: () => void;
  }) => Promise<boolean>;
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
  const output = boardStep({ resultFile: job.resultFile, streamFile: job.streamFile!, startedAt: job.stepStartedAt });
  const mark = (step: DeployStep, ending: DeployMark): void =>
    output.mark(`${DEPLOY_STEPS.indexOf(step) + 1} of ${DEPLOY_STEPS.length}`, t("en", STEP_LABEL[step]!), ending);
  const fail = (step: DeployStep, sentence: Sentence): void => {
    const error = renderSentence("en", sentence) ?? "deploy failed";
    output.failed("deploy-failed", error, sentence);
    mark(step, `stopped: ${error}`);
  };
  const waited = (deps.now ?? Date.now)() - Date.parse(job.deploy?.restartedAt ?? "");
  if (waited > (deps.restartWaitMs ?? DEPLOY_RESTART_WAIT_MS)) return fail("wait", { key: "landing.deployNoAnswer" });
  mark("wait", "done");
  mark("check", "started");
  const fetched = job.deploy?.commit;
  if (!fetched) {
    mark("check", "done");
    return output.done();
  }
  const served = runningCommit(deps);
  if (!served) return fail("check", { key: "landing.deployNoAnswer" });
  if (containsFetched(deps, served, fetched)) {
    mark("check", "done");
    return output.done();
  }
  const older: Sentence = {
    key: "landing.deployServiceOlderAfterTwoRestarts",
    values: { served: served.slice(0, 7), head: fetched.slice(0, 7) },
  };
  if ((job.deploy?.restartAttempts ?? 1) < 2 && deps.restartWhenSettled) {
    const restartedAt = new Date((deps.now ?? Date.now)()).toISOString();
    deps.queue.update(job.id, {
      pid: process.pid,
      pgid: 0,
      deploy: {
        ...job.deploy!,
        restartAttempts: 2,
        restartedAt,
        leaving: deps.startedAt,
      },
    });
    void deps.restartWhenSettled({
      onWait: () => undefined,
      beforeFire: () => undefined,
    });
    return;
  }
  deps.setFault(older);
  fail("check", older);
}

/** Finish every deploy job the last process left running after its restart. */
export function finishDeployAfterRestart(deps: AfterRestartDeps): void {
  for (const job of deps.queue.list()) {
    if (job.state !== "running" || jobKind(job) !== "deploy" || !job.deploy?.restartedAt || !job.resultFile) continue;
    if (deps.startedAt && job.deploy.leaving === deps.startedAt) continue;
    finish(deps, job as Job & { resultFile: string });
  }
}
