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

/** Runs one posted step. False when it failed, after telling `ui`. */
async function posted(io: DeployIo, ui: DeployUi, step: PostedStep): Promise<StepAnswer | null> {
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
  ui.state(step, "done");
  return answer;
}

/** Probes `/api/version` until a process other than `leaving` answers.
 *  Whether anything answered at all is what decides the step: an old
 *  process that never goes away still answers, and the check that
 *  follows reports what it runs. */
async function waitForNewProcess(io: DeployIo, leaving: string | null | undefined): Promise<boolean> {
  await io.sleep(FIRST_PROBE_AFTER_MS);
  let answered = false;
  for (let n = 0; n < PROBES; n++) {
    try {
      const { startedAt } = await io.version();
      answered = true;
      if (startedAt !== leaving) return true;
    } catch {
      // Refused or reset while the service is down: keep waiting.
    }
    await io.sleep(PROBE_EVERY_MS);
  }
  return answered;
}

export async function runDeploy(io: DeployIo, ui: DeployUi): Promise<void> {
  if (!(await posted(io, ui, "fetch"))) return;
  if (!(await posted(io, ui, "install"))) return;
  const restarted = await posted(io, ui, "restart");
  if (!restarted) return;
  // Held back by running jobs, or nothing to restart with: nothing will
  // answer anew, and the reload shows the Deploy tab's own sentence.
  if (restarted.restart !== "fired") {
    ui.close();
    io.reload();
    return;
  }
  ui.state("wait", "running");
  if (!(await waitForNewProcess(io, restarted.startedAt))) {
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
