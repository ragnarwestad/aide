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
import type { Job, QueueStore } from "../../queue/queue.ts";
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

/** One deploy run: where it deploys, and how it marks its steps, holds its
 *  row and ends. The current step and the hold live here, shared by every part. */
interface DeployRun {
  deps: DeployRunDeps;
  jobId: string;
  resultFile: string;
  project: string;
  root: string;
  active: () => boolean;
  mark: (which: DeployStep, ending: DeployMark) => void;
  at: (which: DeployStep, ending: DeployMark) => void;
  hold: (on: boolean) => void;
  fail: (sentence: Sentence, detail?: string) => void;
  succeed: () => void;
}

function startDeployRun(deps: DeployRunDeps, jobId: string, resultFile: string, first: Job): DeployRun {
  const { project } = first;
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
  return { deps, jobId, resultFile, project, root, active, mark, at, hold, fail, succeed };
}

/** Runs `fn` holding the checkout's merge lock, through the waiting list when the queue has one. */
function claimLock<T>(run: DeployRun, root: string, fn: () => Promise<T>): Promise<T> {
  const { deps, jobId, project } = run;
  return deps.queue.waiting && "tryRun" in deps.mergeLock
    ? dispatchFor(deps.queue.waiting).run({ id: `deploy:${jobId}`, jobId, project, label: project, operation: "deploy", reason: "Waiting for the repository merge lock" }, deps.mergeLock as typeof deps.mergeLock & RootAdmission, root, fn, () => !run.active())
    : deps.mergeLock.run(root, fn);
}

/** Fetch and install under the merge lock. `installed` remembers the commit
 *  last installed, so a second prepare of the same commit installs nothing. */
async function fetchAndInstall(run: DeployRun, installed: { commit?: string }): Promise<boolean | "retry" | void> {
  const { deps, jobId, root } = run;
  if (!run.active()) return false;
  if (deployWaitsFor(deps.queue.list(), jobId).length) return "retry";
  const base = await deps.branchStatus.defaultBranch(root);
  if (!base) return run.fail({ key: "landing.deployNoDefaultBranch", values: { root } });
  const before = await deps.gitRun(root, ["rev-parse", "HEAD"]);
  const from = deps.queue.get(jobId)?.deploy?.from ?? (before.code === 0 ? before.stdout.trim() : "");
  const pulled = await fastForwardToOrigin(deps.gitRun, root, base);
  if (!pulled.ok) return run.fail(pulled.error ?? `cannot bring ${root} up to date`, pulled.detail);
  const head = await deps.gitRun(root, ["rev-parse", "HEAD"]);
  const commit = head.code === 0 ? head.stdout.trim() : undefined;
  deps.queue.update(jobId, { deploy: { root, ...(from ? { from } : {}), ...(commit ? { commit } : {}) } });
  run.mark("fetch", "done");
  if (commit && commit === installed.commit) return true;
  run.at("install", "started");
  const result = await deps.installCheckout(root);
  await deps.branchStatus.commitsBehindOrigin(root, true);
  if (!result.ok) {
    const older = await servedOlder(deps, root);
    if (typeof older === "object") deps.setFault({ key: "landing.deployServiceOlder", values: older });
    return run.fail(result.error, result.detail);
  }
  installed.commit = commit;
  run.mark("install", "done");
  return true;
}

/** The fetch and install, waiting first for landings and the merge lock; run
 *  again by the restart when a landing came in while it waited. */
function deployPreparer(run: DeployRun): () => Promise<boolean> {
  const { deps, jobId, project, root } = run;
  const installed: { commit?: string } = {};
  return async (): Promise<boolean> => {
    while (run.active()) {
      run.at("fetch", "started");
      deps.setFailure(project, null);
      const waiting = () => deps.mergeLock.roots().includes(root) || deployWaitsFor(deps.queue.list(), jobId).length > 0;
      if (waiting()) {
        run.hold(true);
        while (waiting() && run.active()) await sleep(deps.lockPollMs ?? 250);
        run.hold(false);
      }
      if (!run.active()) return false;
      const prepared = await claimLock(run, root, () => fetchAndInstall(run, installed));
      if (prepared !== "retry") return prepared === true;
    }
    return false;
  };
}

/** The restart, through the wait for landings. True when the run has ended
 *  here — the restart fired or the job stopped — and false when nothing restarted. */
async function restartThroughLandings(run: DeployRun, prepare: () => Promise<boolean>): Promise<boolean> {
  const { deps, jobId, resultFile, root } = run;
  run.at("restart", "started");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = await deps.restartWhenSettled({
    prepare,
    landings: () => deployWaitsFor(deps.queue.list(), jobId).map((job) => `${job.project}:${job.specFolder}`),
    cancelled: () => !run.active() || existsSync(resultFile),
    onWait: (landings) => run.hold(landings.length > 0),
    beforeFire: () => {
      run.hold(false);
      const current = deps.queue.get(jobId);
      deps.queue.update(jobId, {
        deploy: { ...(current?.deploy ?? { root }), restartedAt: new Date().toISOString(), leaving: deps.startedAt },
      });
      run.mark("restart", "done");
      run.at("wait", "started");
      // A process still alive when this ends was never replaced.
      timer = setTimeout(() => {
        if (deps.queue.get(jobId)?.state !== "running" || existsSync(resultFile)) return;
        run.fail({ key: "landing.deployNoAnswer" });
      }, deps.restartWaitMs ?? DEPLOY_RESTART_WAIT_MS);
      timer.unref?.();
    },
  });
  if (fired || !run.active() || existsSync(resultFile)) return true;
  clearTimeout(timer);
  return false;
}

/** Nothing restarted the service: it is checked as it stands. */
async function checkServiceAsItStands(run: DeployRun): Promise<void> {
  run.mark("restart", "skipped");
  run.mark("wait", "skipped");
  run.at("check", "started");
  const older = await servedOlder(run.deps, run.root);
  if (typeof older === "object") {
    const fault: Sentence = { key: "landing.deployNoRestart", values: older };
    run.deps.setFault(fault);
    return run.fail(fault);
  }
  if (older === "equal") run.deps.setFault(null);
  run.mark("check", "done");
  run.succeed();
}

export async function runDeploy(deps: DeployRunDeps, jobId: string, resultFile: string): Promise<void> {
  // The runner writes `start` (with the step's stamp and log) once `spawn` has returned.
  await Promise.resolve();
  const first = deps.queue.get(jobId);
  if (!first) return;
  if (!first.deployWaitForLandings) deps.queue.update(jobId, {
    deployWaitForLandings: deps.queue.list().filter((job) => job.landing && job.id !== jobId).map((job) => job.id),
  });
  const run = startDeployRun(deps, jobId, resultFile, first);

  try {
    if (!deps.isBoard(run.root)) {
      return run.fail(`only the board itself is deployed as a job — ${run.project} deploys from its own Deploy tab`);
    }
    const prepare = deployPreparer(run);
    if (!(await prepare())) return;
    if (await deps.restartRegistered() && await restartThroughLandings(run, prepare)) return;
    await checkServiceAsItStands(run);
  } catch (err) {
    run.fail({ key: "landing.deployBroke" }, err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}
