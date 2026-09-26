// The Deploy button's whole sequence, with its effects handed in: three
// requests to the server, a wait for a NEW process to answer, and a
// fourth request to that process. Pure of the DOM, so a test drives it
// with fakes and no timers.

export type DeployStep = "fetch" | "install" | "restart" | "wait" | "check";
export type StepState = "waiting" | "running" | "done" | "failed";

/** The steps a request answers; `wait` is the page's own. */
export type PostedStep = "fetch" | "install" | "restart" | "check";

export const STEPS: DeployStep[] = ["fetch", "install", "restart", "wait", "check"];

/** How long "Deploy finished" stays before the dialog closes. */
export const FINISHED_STAYS_MS = 2000;
/** How long a failed step stays shown before the dialog closes. */
export const FAILED_STAYS_MS = 2000;
/** The restart script sleeps a second first, so the first probe would
 *  only ever meet the old process. */
export const FIRST_PROBE_AFTER_MS = 2000;
export const PROBE_EVERY_MS = 1500;
export const PROBES = 120;

export interface StepAnswer {
  ok: boolean;
  error?: string;
  /** The stored message at the top of every page is what says it: a
   *  reload draws it. */
  faulty?: boolean;
  restart?: "fired" | "held" | "none";
  /** The process that answered `restart: "fired"`: the one to leave. */
  startedAt?: string | null;
}

export interface DeployIo {
  /** A request that fails to reach the server or is not understood is
   *  answered `{ ok: false }`, or thrown: either way the step failed. */
  post(step: PostedStep): Promise<StepAnswer>;
  /** `GET /api/version`; throws while the service is down. */
  version(): Promise<{ startedAt?: string | null }>;
  sleep(ms: number): Promise<void>;
  reload(): void;
}

export interface DeployFailure {
  error: string;
  faulty: boolean;
  /** No probe of the wait ever answered: only the page can say so. */
  silent: boolean;
}

export interface DeployUi {
  state(step: DeployStep, state: StepState): void;
  fail(step: DeployStep, failure: DeployFailure): void;
  finished(): void;
  close(): void;
}

/** Marks the step failed, keeps it on show for a couple of seconds, then
 *  closes the dialog, which hands the failure to the page. */
async function failed(io: DeployIo, ui: DeployUi, step: DeployStep, failure: DeployFailure): Promise<void> {
  ui.fail(step, failure);
  await io.sleep(FAILED_STAYS_MS);
  ui.close();
}

/** Runs one posted step. False when it failed, after telling `ui`.
 *  `finish` false leaves the step running for the caller to finish:
 *  the restart's answer only says the restart was set off. */
async function posted(io: DeployIo, ui: DeployUi, step: PostedStep, finish = true): Promise<StepAnswer | null> {
  ui.state(step, "running");
  let answer: StepAnswer;
  try {
    answer = await io.post(step);
  } catch {
    answer = { ok: false };
  }
  if (!answer.ok) {
    await failed(io, ui, step, { error: answer.error ?? "", faulty: answer.faulty === true, silent: false });
    return null;
  }
  if (finish) ui.state(step, "done");
  return answer;
}

/** Probes `/api/version` until a process other than `leaving` answers.
 *  The restart runs until the old process stops answering or a new one
 *  answers; the wait runs from then until a new one answers. Whether
 *  anything answered at all is what decides the wait: an old process
 *  that never goes away still answers, and the check that follows
 *  reports what it runs. */
async function waitForNewProcess(io: DeployIo, ui: DeployUi, leaving: string | null | undefined): Promise<boolean> {
  let restarted = false;
  const restartDone = (): void => {
    if (restarted) return;
    restarted = true;
    ui.state("restart", "done");
    ui.state("wait", "running");
  };
  await io.sleep(FIRST_PROBE_AFTER_MS);
  let answered = false;
  for (let n = 0; n < PROBES; n++) {
    try {
      const { startedAt } = await io.version();
      answered = true;
      if (startedAt !== leaving) {
        restartDone();
        return true;
      }
    } catch {
      // Refused or reset while the service is down: the old process is
      // gone, and the wait for the new one has begun.
      restartDone();
    }
    await io.sleep(PROBE_EVERY_MS);
  }
  restartDone();
  return answered;
}

export async function runDeploy(io: DeployIo, ui: DeployUi): Promise<void> {
  if (!(await posted(io, ui, "fetch"))) return;
  if (!(await posted(io, ui, "install"))) return;
  const restarted = await posted(io, ui, "restart", false);
  if (!restarted) return;
  // Held back by running jobs, or nothing to restart with: nothing will
  // answer anew, and the reload shows the Deploy tab's own sentence.
  if (restarted.restart !== "fired") {
    ui.state("restart", "done");
    ui.close();
    io.reload();
    return;
  }
  if (!(await waitForNewProcess(io, ui, restarted.startedAt))) {
    await failed(io, ui, "wait", { error: "", faulty: false, silent: true });
    return;
  }
  ui.state("wait", "done");
  if (!(await posted(io, ui, "check"))) return;
  ui.finished();
  await io.sleep(FINISHED_STAYS_MS);
  ui.close();
  io.reload();
}
