import { dispatchFor, type RootAdmission } from "../../queue/waiting/dispatch.ts";
// The deploy job's run, in the process the restart takes down: fetch the
// board's own checkout, install, and restart the service. Each step is
// marked in the job's run log, where the Running page reads it back.
//
// The run ends in one of three ways. A failure writes the result file at
// once. A service nothing restarts is checked here and ends the job. A
// restart that fired writes nothing: the process that starts after it checks
// the commit and writes the result (`after-restart.ts`).

import { deployWaitsFor, deployHold } from "./landing-hold.ts";
import { existsSync } from "node:fs";
import { fastForwardToOrigin } from "../../git/branch-merge/index.ts";
import type { BranchStatusChecker } from "../../git/branch-status.ts";
import type { GitRunner } from "../../git/process/index.ts";
import { formatSentence, type Sentence } from "../../messages/format.ts";
import { t } from "../../i18n";
import type { QueueStore } from "../../queue/queue.ts";
import { boardStep } from "../board-step.ts";
import { servedOlder, type InstallResult } from "../deployment";
import { DEPLOY_RESTART_WAIT_MS } from "../serve-helpers";
import { DEPLOY_STEPS, type DeployMark, type DeployStep } from "./plan.ts";
import { STEP_LABEL } from "../../render/pages/projects-page/deploy-dialog.ts";
import type { DeployFailure } from "../state.ts";

/** What a deploy run is given: the queue it is a job in, the checkout's git,
 *  and the hooks the landing code already offers the Deploy button. */
export interface DeployRunDeps {
  queue: Pick<QueueStore, "get" | "update" | "list"> & Partial<Pick<QueueStore, "waiting">>;
  /** Where the project's checkout lives. */
  projectRoot: (project: string) => string;
  /** Whether `root` is the checkout the board runs from. */
  isBoard: (root: string) => boolean;
  gitRun: GitRunner;
  branchStatus: Pick<BranchStatusChecker, "defaultBranch" | "commitsBehindOrigin">;
  /** A landing holds its checkout's root here for as long as it merges. */
  mergeLock: { run<T>(root: string, fn: () => Promise<T>): Promise<T>; roots(): string[] };
  installCheckout: (root: string) => Promise<InstallResult>;
  restartRegistered: () => Promise<boolean>;
  waiting?: (jobs: string[]) => void;
  restartWhenSettled: (o: { onWait: (landings: string[]) => void; beforeFire: () => void; prepare?: () => Promise<boolean>; cancelled?: () => boolean; landings?: () => string[] }) => Promise<boolean>;
  readServing: () => { sha: string | null; repoRoot: string | null };
  setFailure: (project: string, failure: DeployFailure | null) => void;
  setFault: (fault: Sentence | null) => void;
  /** When this process booted: who fired the restart. */
  startedAt: string;
  /** How often the wait for a landing's lock looks again. */
  lockPollMs?: number;
  /** How long this process waits to be replaced once it has fired the restart. */
  restartWaitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDeploy(deps: DeployRunDeps, jobId: string, resultFile: string): Promise<void> {
  // The runner writes `start` (with the step's stamp and log) once `spawn` has returned.
  await Promise.resolve();
  const first = deps.queue.get(jobId);
  if (!first) return;
  const { project } = first;
  if (!first.deployWaitForLandings) deps.queue.update(jobId, {
    deployWaitForLandings: deps.queue.list().filter((job) => job.landing && job.id !== jobId).map((job) => job.id),
  });
  const output = boardStep({ resultFile, streamFile: first.streamFile!, startedAt: first.stepStartedAt });
  const root = deps.projectRoot(project);
  let step: DeployStep = "fetch";
  const active = () => deps.queue.get(jobId)?.state === "running";

  const mark = (which: DeployStep, ending: DeployMark): void => {
    output.mark(`${DEPLOY_STEPS.indexOf(which) + 1} of ${DEPLOY_STEPS.length}`, t("en", STEP_LABEL[which]!), ending);
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
    deps.waiting?.(on ? deployWaitsFor(deps.queue.list(), jobId).map((job) => `${job.project}:${job.specFolder}`) : []);
    deps.queue.update(jobId, on ? { error: deployHold(deps.queue.list(), jobId), errorReason: "held-back" } : { error: undefined, errorReason: undefined });
  };

  const fail = (sentence: Sentence, detail?: string): void => {
    const error = [formatSentence("en", sentence) ?? "", detail ?? ""].filter(Boolean).join("\n");
    output.failed("deploy-failed", error, sentence);
    mark(step, `stopped: ${error.split("\n")[0]}`);
    deps.setFailure(project, { step, sentence, ...(detail ? { detail } : {}) });
    hold(false);
  };
  const succeed = (): void => {
    hold(false);
    output.done();
  };

  try {
    if (!deps.isBoard(root)) {
      return fail(`only the board itself is deployed as a job — ${project} deploys from its own Deploy tab`);
    }

    let installedCommit: string | undefined;
    const prepare = async (): Promise<boolean> => {
      while (active()) {
        at("fetch", "started");
        deps.setFailure(project, null);
        const waitingJobs = () => deployWaitsFor(deps.queue.list(), jobId);
        const waiting = () => deps.mergeLock.roots().includes(root) || waitingJobs().length > 0;
        if (waiting()) {
          hold(true);
          while (waiting() && active()) await sleep(deps.lockPollMs ?? 250);
          hold(false);
        }
        if (!active()) return false;
        const claim = <T>(root: string, fn: () => Promise<T>): Promise<T> => deps.queue.waiting && "tryRun" in deps.mergeLock
          ? dispatchFor(deps.queue.waiting).run({ id: `deploy:${jobId}`, jobId, project, label: project, operation: "deploy", reason: "Waiting for the repository merge lock" }, deps.mergeLock as typeof deps.mergeLock & RootAdmission, root, fn, () => !active())
          : deps.mergeLock.run(root, fn);
        const prepared = await claim(root, async () => {
          if (!active()) return false;
          if (waitingJobs().length) return "retry";
          const base = await deps.branchStatus.defaultBranch(root);
          if (!base) return fail({ key: "landing.deployNoDefaultBranch", values: { root } });
          const before = await deps.gitRun(root, ["rev-parse", "HEAD"]);
          const from = deps.queue.get(jobId)?.deploy?.from ?? (before.code === 0 ? before.stdout.trim() : "");
          const pulled = await fastForwardToOrigin(deps.gitRun, root, base);
          if (!pulled.ok) return fail(pulled.error ?? `cannot bring ${root} up to date`, pulled.detail);
          const head = await deps.gitRun(root, ["rev-parse", "HEAD"]);
          const commit = head.code === 0 ? head.stdout.trim() : undefined;
          deps.queue.update(jobId, { deploy: { root, ...(from ? { from } : {}), ...(commit ? { commit } : {}) } });
          mark("fetch", "done");
          if (commit && commit === installedCommit) return true;
          at("install", "started");
          const installed = await deps.installCheckout(root);
          await deps.branchStatus.commitsBehindOrigin(root, true);
          if (!installed.ok) {
            const older = await servedOlder(deps, root);
            if (typeof older === "object") deps.setFault({ key: "landing.deployServiceOlder", values: older });
            return fail(installed.error, installed.detail);
          }
          installedCommit = commit;
          mark("install", "done");
          return true;
        });
        if (prepared !== "retry") return prepared === true;
      }
      return false;
    };
    if (!(await prepare())) return;

    // --- restart: through the wait for landings, when anything restarts the service.
    if (await deps.restartRegistered()) {
      at("restart", "started");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fired = await deps.restartWhenSettled({
        prepare,
        landings: () => deployWaitsFor(deps.queue.list(), jobId).map((job) => `${job.project}:${job.specFolder}`),
        cancelled: () => !active() || existsSync(resultFile),
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
      if (fired || !active() || existsSync(resultFile)) return;
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
    fail({ key: "landing.deployBroke" }, err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}
