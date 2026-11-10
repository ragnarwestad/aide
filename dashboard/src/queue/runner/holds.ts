// Holding a queued job: the reason it waits is written on its row, only
// when it changed, and taken off again by the first pass that does not
// hold it.

import type { BoardMessage } from "../../messages/types.ts";
import type { Job, QueueStore } from "../queue.ts";
import { specReference } from "../../project/spec-folder.ts";
import { landingStepIndex } from "../../format/gerund.ts";
import { takesSlot, writing } from "../steps.ts";
import { dependencyHold, NOT_CHECKED, type DependencyHolds } from "./dependency-hold.ts";

export interface HoldAnswers {
  dependencies?: DependencyHolds;
  notAnalyzed?: Map<string, BoardMessage>;
  approachChoice?: Map<string, BoardMessage>;
  deployWaitsForLanding?: Map<string, BoardMessage>;
  usageLimit?: Map<string, BoardMessage>;
  switchedOff?: Map<string, BoardMessage>;
  /** Not a hold: these archives end before the hold loop. */
  acceptanceOpen?: Set<string>;
}

export const HOLD_NAMES = [
  "retry-not-due",
  "provider-switched-off",
  "usage-limit",
  "no-free-slot",
  "own-landing",
  "same-spec-running",
  "archive-running",
  "schedule-waits-on-project",
  "deploy-waits-for-landing",
  "not-analyzed",
  "approach-choice",
  "dependency",
] as const;
export type HoldName = (typeof HOLD_NAMES)[number];

/** Skip this tick without putting a sentence on the row. */
export const WAIT = Symbol("wait");
type HoldAnswer = BoardMessage | typeof WAIT | undefined;

export interface HoldContext {
  jobs: () => readonly Job[];
  maxConcurrent: number;
  now: string;
  answers: HoldAnswers;
}

interface Hold {
  name: HoldName;
  check: (job: Job, at: HoldContext) => HoldAnswer;
}

const answer = (answers: Map<string, BoardMessage> | undefined, id: string): BoardMessage | undefined => answers?.get(id);
const stepOf = (job: Job) => job.steps[job.stepIndex];

/** Every hold in the order a queued job is checked. */
export const HOLDS: readonly Hold[] = [
  { name: "retry-not-due", check: (job, at) =>
    job.retry?.dueAt && Date.parse(job.retry.dueAt) > Date.parse(at.now) ? WAIT : undefined },
  { name: "provider-switched-off", check: (job, at) => answer(at.answers.switchedOff, job.id) },
  { name: "usage-limit", check: (job, at) => answer(at.answers.usageLimit, job.id) },
  { name: "no-free-slot", check: (job, at) => takesSlot(job) &&
    at.jobs().filter((candidate) => candidate.state === "running" && takesSlot(candidate)).length >= at.maxConcurrent
    ? WAIT : undefined },
  { name: "own-landing", check: (job) => job.landing ? WAIT : undefined },
  { name: "same-spec-running", check: (job, at) => at.jobs().some((candidate) =>
    candidate.state === "running" && candidate.project === job.project && candidate.specFolder === job.specFolder)
    ? WAIT : undefined },
  { name: "archive-running", check: (job, at) => stepOf(job) === "archive" && at.jobs().some((candidate) =>
    candidate.id !== job.id && candidate.project === job.project && stepOf(candidate) === "archive" && writing(candidate))
    ? { key: "runner.archiveRunning" } : undefined },
  { name: "schedule-waits-on-project", check: (job, at) => {
    if (stepOf(job) !== "schedule") return undefined;
    const blocking = at.jobs().find((candidate) =>
      candidate.id !== job.id && candidate.project === job.project && writing(candidate));
    if (!blocking) return undefined;
    const index = blocking.landing ? landingStepIndex(blocking.state, blocking.stepIndex) : blocking.stepIndex;
    return { key: "runner.scheduleWaitsOnJob", values: {
      doing: blocking.steps[index]!, spec: specReference(blocking.project, blocking.specFolder),
    } };
  } },
  { name: "deploy-waits-for-landing", check: (job, at) => answer(at.answers.deployWaitsForLanding, job.id) },
  { name: "not-analyzed", check: (job, at) => answer(at.answers.notAnalyzed, job.id) },
  { name: "approach-choice", check: (job, at) => answer(at.answers.approachChoice, job.id) },
  { name: "dependency", check: (job, at) => {
    const dependency = dependencyHold(at.answers.dependencies, job.id);
    if (dependency === NOT_CHECKED) return WAIT;
    return dependency === undefined ? undefined : {
      key: "runner.dependencyNotArchived",
      values: { dependency: specReference(job.project, dependency) },
    };
  } },
];

/** The first hold that applies, with a sentence when the row has one. */
export function holdFor(job: Job, at: HoldContext): { name: HoldName; reason?: BoardMessage } | undefined {
  for (const hold of HOLDS) {
    const result = hold.check(job, at);
    if (result === WAIT) return { name: hold.name };
    if (result) return { name: hold.name, reason: result };
  }
  return undefined;
}

/** Hold one job with the reason it is held for RIGHT NOW. Written
 *  only when it changed: an unconditional update would rewrite the
 *  mirror every two seconds for a job that is doing nothing. `held`
 *  collects the ids this pass held. */
export function holdJob(store: QueueStore, held: Set<string>, job: Job, reason: BoardMessage): void {
  held.add(job.id);
  // Every caller reaches this with a job that IS queued right now,
  // so the reason it holds for is always the current one — whatever
  // `errorReason` an earlier, unrelated attempt left behind (a refused
  // landing's own record lives in `landingError`,
  // which this never touches, not in `error`/`errorReason`).
  const current = job.error;
  const same = !!current && typeof current === "object" && !Array.isArray(current) &&
    current.key === reason.key && JSON.stringify(current.values) === JSON.stringify(reason.values);
  if (!same) store.update(job.id, { error: reason, errorReason: "held-back" });
}

/** Take the hold-back sentence off every queued job this pass did not
 *  hold. The reason is gone; the row must not go on naming it. Only
 *  `held-back` sentences — a stopped job's own error is its record,
 *  not a wait. */
export function clearStaleHolds(store: QueueStore, held: Set<string>): void {
  for (const job of store.list()) {
    if (job.state !== "queued" || held.has(job.id)) continue;
    if (job.errorReason !== "held-back") continue;
    store.update(job.id, { error: undefined, errorReason: undefined });
  }
}
