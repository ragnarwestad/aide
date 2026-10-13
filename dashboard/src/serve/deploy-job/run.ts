// The deploy job's run, in the process the restart takes down: fetch the
// board's own checkout, install, and restart the service. Each step is
// marked in the job's run log, where the Running page reads it back.
//
// The run ends in one of three ways. A failure writes the result file at
// once. A service nothing restarts is checked here and ends the job. A
// restart that fired writes nothing: the process that starts after it checks
// the commit and writes the result (`after-restart.ts`).

import { existsSync } from "node:fs";
import { fastForwardToOrigin, type RepoMergeResult } from "../../git/branch-merge.ts";
import type { BranchStatusChecker, GitRunner } from "../../git/branch-status.ts";
import type { Sentence } from "../../i18n/message.ts";
import type { QueueStore } from "../../queue/queue.ts";
import { stepLogLine } from "../land-branch/test-gate.ts";
import { servedOlder } from "../routes/deploy-steps.ts";
import type { RoutesContext } from "../routes";
import { DEPLOY_RESTART_WAIT_MS } from "../serve-helpers";
import { deployMark, type DeployMark, type DeployStep } from "./plan.ts";
import { writeDeployDone, writeDeployFailed } from "./result.ts";

/** What a deploy run is given: the queue it is a job in, the checkout's git,
 *  and the hooks the landing code already offers the Deploy button. */
export interface DeployRunDeps {
  queue: Pick<QueueStore, "get" | "update">;
  /** Where the project's checkout lives. */
  projectRoot: (project: string) => string;
  /** Whether `root` is the checkout the board runs from. */
  isBoard: (root: string) => boolean;
  gitRun: GitRunner;
  branchStatus: Pick<BranchStatusChecker, "defaultBranch" | "commitsBehindOrigin">;
  /** A landing holds its checkout's root here for as long as it merges. */
  mergeLock: { run<T>(root: string, fn: () => Promise<T>): Promise<T>; roots(): string[] };
  installCheckout: (result: RepoMergeResult) => Promise<boolean>;
  restartRegistered: () => Promise<boolean>;
  restartWhenSettled: (o: { onWait: (landings: string[]) => void; beforeFire: () => void }) => Promise<boolean>;
  readServing: RoutesContext["readServing"];
  setFailure: (project: string, failure: { step: string; error: string } | null) => void;
  setFault: (fault: Sentence | null) => void;
  /** When this process booted: who fired the restart. */
  startedAt: string;
  /** How often the wait for a landing's lock looks again. */
  lockPollMs?: number;
  /** How long this process waits to be replaced once it has fired the restart. */
  restartWaitMs?: number;
}

const HOLD = { key: "runner.landingPause" } as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDeploy(deps: DeployRunDeps, jobId: string, resultFile: string): Promise<void> {
  // The runner writes `start` (with the step's stamp and log) once `spawn` has returned.
  await Promise.resolve();
  const first = deps.queue.get(jobId);
  if (!first) return;
  const { project } = first;
  const root = deps.projectRoot(project);
  let step: DeployStep = "fetch";

  const mark = (which: DeployStep, ending: DeployMark): void => {
    const job = deps.queue.get(jobId);
    if (job) stepLogLine(job, deployMark(which, ending), ending.startsWith("stopped"));
  };
  const at = (which: DeployStep, ending: DeployMark): void => {
    step = which;
    mark(which, ending);
  };

  // The hold on the job's row, written when a wait starts and when it ends.
  let held = false;
  const hold = (on: boolean): void => {
    if (on === held) return;
    held = on;
    deps.queue.update(jobId, on ? { error: HOLD, errorReason: "held-back" } : { error: undefined, errorReason: undefined });
  };

  const fail = (sentence: Sentence): void => {
    const error = writeDeployFailed(resultFile, sentence);
    mark(step, `stopped: ${error}`);
    deps.setFailure(project, { step, error });
    hold(false);
  };
  const succeed = (): void => {
    hold(false);
    writeDeployDone(resultFile);
  };

  try {
    if (!deps.isBoard(root)) {
      return fail(`only the board itself is deployed as a job — ${project} deploys from its own Deploy tab`);
    }

    // --- fetch: after any landing that holds the checkout.
    at("fetch", "started");
    deps.setFailure(project, null);
    if (deps.mergeLock.roots().includes(root)) {
      hold(true);
      while (deps.mergeLock.roots().includes(root)) await sleep(deps.lockPollMs ?? 250);
      hold(false);
    }
    const base = await deps.branchStatus.defaultBranch(root);
    if (!base) return fail(`cannot work out the default branch in ${root}`);
    const pulled = await deps.mergeLock.run(root, () => fastForwardToOrigin(deps.gitRun, root, base));
    if (!pulled.ok) return fail(pulled.error ?? `cannot bring ${root} up to date`);
    const head = await deps.gitRun(root, ["rev-parse", "HEAD"]);
    const commit = head.code === 0 ? head.stdout.trim() : undefined;
    deps.queue.update(jobId, { deploy: { root, ...(commit ? { commit } : {}) } });
    mark("fetch", "done");

    // --- install.
    at("install", "started");
    const installed: RepoMergeResult = { root, ok: true };
    await deps.installCheckout(installed);
    // Fresh, also after a failed install: the checkout has moved.
    await deps.branchStatus.commitsBehindOrigin(root, true);
    if (installed.installError) {
      const older = await servedOlder(deps, root);
      if (typeof older === "object") deps.setFault({ key: "landing.deployServiceOlder", values: older });
      return fail(installed.installError);
    }
    mark("install", "done");

    // --- restart: through the wait for landings, when anything restarts the service.
    if (await deps.restartRegistered()) {
      at("restart", "started");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fired = await deps.restartWhenSettled({
        onWait: (landings) => hold(landings.length > 0),
        beforeFire: () => {
          hold(false);
          const current = deps.queue.get(jobId);
          deps.queue.update(jobId, {
            deploy: { ...(current?.deploy ?? { root }), restartedAt: new Date().toISOString(), leaving: deps.startedAt },
          });
          mark("restart", "done");
          at("wait", "started");
          // A process still alive when this ends was never replaced.
          timer = setTimeout(() => {
            if (deps.queue.get(jobId)?.state !== "running" || existsSync(resultFile)) return;
            fail({ key: "landing.deployNoAnswer" });
          }, deps.restartWaitMs ?? DEPLOY_RESTART_WAIT_MS);
          timer.unref?.();
        },
      });
      if (fired) return;
      clearTimeout(timer);
    }

    // --- nothing restarts the service: it is checked as it stands.
    mark("restart", "skipped");
    mark("wait", "skipped");
    at("check", "started");
    const older = await servedOlder(deps, root);
    if (typeof older === "object") {
      const fault: Sentence = { key: "landing.deployNoRestart", values: older };
      deps.setFault(fault);
      return fail(fault);
    }
    if (older === "equal") deps.setFault(null);
    mark("check", "done");
    succeed();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
