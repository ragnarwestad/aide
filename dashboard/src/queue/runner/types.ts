// The Runner's own types: what a spawn produces, what a finished step
// reports, and the options the scheduler is built from.

import type { NotifyEvent } from "../../integrations/notify.ts";
import type { BranchRef, Job, QueueStore, TokenUsage, WorkflowStep } from "../queue.ts";

export interface SpawnResult {
  pid: number;
  pgid: number;
}

// The session id and the stream file are decided HERE and handed down,
// not learned from the result afterwards: by the time a result exists
// the step is over, and there is nothing left to watch.
export type Spawner = (
  job: Job,
  step: WorkflowStep,
  resultFile: string,
  sessionId: string,
  streamFile: string,
) => SpawnResult;

export interface StepOutcome {
  ok: boolean;
  /** Absent for a step whose tool publishes no dollar figure at all —
   *  a Codex step, always (spec 125). Absent is not zero: zero would be
   *  summed into the job's spend as if the step had been free. */
  costUsd?: number;
  costMeasured: boolean;
  /** Which CLI `aide-run-spec` actually started. */
  tool?: "claude" | "codex" | "fake-claude";
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** The compare or PR page for the branch this step wrote to, when the
   *  push mode produced one. One link: `aide-run-spec`'s own "single
   *  most interesting one". */
  branchUrl?: string;
  /** Every repo the step pushed to, one entry each. `aide-run-spec`
   *  emits this right beside `branchUrl` in the same object; reading
   *  only the singular neighbour is what left a two-repo job showing
   *  one link and one merge state for both. */
  branchUrls?: BranchRef[];
  /** The pull request `--push pr` opened for this step's branch (spec
   *  220). `aide-run-spec` has emitted it since spec 81 and nothing on
   *  this side read it: the value was dropped the moment the result was
   *  parsed, so there was no way to see from the dashboard that a
   *  request had been opened at all. It matters now that a project can
   *  ask for its code to be LEFT for one. */
  prUrl?: string;
  /** Why `gh` opened none. Its own field rather than `error`, because
   *  the step still SUCCEEDED — `gh` on an unattended machine needs an
   *  interactive re-auth only a person can do, and a run that failed
   *  over it would throw away the work it had already done. Spec 220
   *  gives that failure teeth: a project whose code is deliberately left
   *  unmerged has nothing describing the branch when this is set. */
  prError?: string;
  /** Why the branch itself did not reach origin (spec 328). `aide-run-spec`
   *  never fails a run over this — the step's own work is already
   *  committed — so a step can report `completed` with its branch
   *  stranded on the machine that ran it. `prError`'s sibling: same
   *  best-effort shape, its own field rather than folded into `error`
   *  for the same reason. */
  pushError?: string;
  /** The branch this step's work is on. `aide-run-spec` has emitted it
   *  in every result since spec 81 and nothing read it until spec 93 —
   *  a create job's branch is named after a provisional key, so it
   *  cannot be re-derived from the spec folder the way every other
   *  job's can. */
  branch?: string;
  /** The spec folder a `create` step turned out to make. Reported only
   *  when exactly one appeared; absent means the run would have had to
   *  guess, and it did not. */
  specFolder?: string;
  /** What the step metered (spec 118). Absent whenever the run could not
   *  measure it — there is no over-charge rule for tokens the way there
   *  is for cost, so absent is the only other answer. */
  tokens?: TokenUsage;
  error?: string;
  /** WHY it was refused, when the answer is one the page acts on (spec
   *  153). `"conflict"` — the runner could not bring the spec's branch
   *  up to date with the base before the step started — is the only one
   *  today, and it is what makes the row offer Resolve. Same field, same
   *  value, same button as a LANDING's conflict (`Job["errorReason"]`);
   *  the two discovery points differ in nothing else. Absent for every
   *  other refusal: there is no step to send at those. */
  errorReason?: "conflict";
}

export interface RunnerOptions {
  store: QueueStore;
  /** Where a project's checkout lives on this machine. */
  projectDir: (project: string) => string;
  runnerBin: string;
  resultDir: string;
  spawn: Spawner;
  isAlive: (pid: number) => boolean;
  readResult: (path: string) => unknown;
  /** Remove a previous step's result before starting the next one —
   *  otherwise poll() would read the old file and "complete" the new
   *  step the instant it starts. */
  clearResult?: (path: string) => void;
  now: () => string;
  today: () => string;
  /** The session id a step will run under. Injected like the clock, so a
   *  test can assert on the id it chose rather than on "some string". */
  newSessionId?: () => string;
  /** Every ENDING is announced: a gate, a finish, a stop, a failure. A
   *  job that parked at 02:00 must not wait for someone to open the
   *  page. Injected, so the tests spawn nothing. */
  notify?: (event: NotifyEvent) => void;
  /** Called once per FINISHED step, ok or not, with what the run
   *  reported — the injection point `notify` already established, for a
   *  caller that has to act on one step's outcome rather than merely
   *  announce it (spec 93 lands a created spec through it).
   *
   *  Returning a PROMISE means "I have started work that outlives this
   *  call, against state the queue shares": the job is marked `landing`
   *  in the same call stack as the state transition below, and no job of
   *  any kind is started until that promise settles. The window is real
   *  — `complete()` is synchronous and frees the job's slot the instant
   *  the step reports success, while the awaited git work the hook
   *  started is still switching branches in a checkout no worktree
   *  isolates.
   *
   *  The runner sets AND clears the flag, rather than trusting the hook
   *  to do both: a hook whose body happened to finish without awaiting
   *  anything would otherwise clear a flag that had not been set yet,
   *  and the queue would be held shut by nobody. A continuation on the
   *  returned promise cannot run earlier than the next microtask, so
   *  that ordering is guaranteed rather than reasoned about. */
  onStepDone?: (
    job: Job,
    step: WorkflowStep | undefined,
    outcome: Partial<StepOutcome>,
  ) => void | Promise<unknown>;
  /** How many steps may be in flight at once. 1 reproduces the
   *  behaviour every caller had before spec 91, which is what makes a
   *  rollback a config edit rather than a release. */
  maxConcurrent?: number;
}

/** The result file is another process's JSON, so this field is a
 *  question like every other one: an object with five numbers, or
 *  nothing. Anything else — a string, a partial object, a null — is
 *  dropped rather than half-carried into a figure a reader would
 *  believe. */
export function tokenUsage(raw: unknown): TokenUsage | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const keys = ["input", "output", "cacheRead", "cacheCreation", "total"] as const;
  if (keys.some((k) => typeof r[k] !== "number")) return undefined;
  return {
    input: r.input as number,
    output: r.output as number,
    cacheRead: r.cacheRead as number,
    cacheCreation: r.cacheCreation as number,
    total: r.total as number,
  };
}
