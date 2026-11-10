// What each step's landing does: what lands, in which order, what the
// code root gets, and what is retried. The landing reads a step's entry
// here and never tests the step's name.

/** Which landing an ok outcome starts (`steps.ts`'s builders). */
export type LandingKind = "new-spec" | "step" | "archive" | "close" | "schedule";

export interface LandingPolicy {
  /** The landing an ok outcome takes, and the endings that start it:
   *  `"any"`, or only those listed. Absent: an ok outcome lands nothing. */
  readonly onOk?: {
    readonly landing: LandingKind;
    readonly endings: "any" | readonly string[];
    /** Only when the run pushed a branch. */
    readonly onlyWhenPushed?: boolean;
  };
  /** A step stopped on one of `STOPPED_ENDINGS_THAT_LAND` lands what it
   *  wrote, as long as no code root was pushed: code waits for `archive`. */
  readonly landsWhenStopped: boolean;
  /** Stopped endings that land past a pushed code root where the specs
   *  live inside it: the landing then copies the spec's folder alone. */
  readonly stoppedPastCode: readonly string[];
  /** Code roots before the specs root, and a failed code root ends the
   *  loop, so the specs root's stamp never reaches main while the code
   *  root's own landing can still fail. Every other step lands the plan
   *  first and the code last. */
  readonly codeFirst: boolean;
  /** What the code root's branch gets: merged; merged unless the project
   *  says `codeLanding: pr`, which leaves it open for review; or deleted,
   *  never merged. */
  readonly codeRoot: "merge" | "merge-unless-pr" | "discard";
  /** Where the specs live inside the code root, the spec's own folder
   *  lands and nothing else of the branch: the branch is also the code's,
   *  and code reaches main through `archive` alone. */
  readonly specFolderOnly: boolean;
  /** The folder is numbered under the specs repo's merge lock. */
  readonly numbersSpec: boolean;
  /** Origin is asked afterwards whether a root still holds the branch;
   *  one that does is a landing that did not finish. */
  readonly checksOrigin: boolean;
  /** A landing stopped by its tests queues the step again, on the step's
   *  own retry allowance. */
  readonly retriesLate: boolean;
  /** The tests a red landing failed are kept for the spec's next implement. */
  readonly keepsFailedTests: boolean;
}

/** The endings a step stops on after the runner has committed and pushed
 *  its work, so what it wrote can land: the wall clock, a provider limit,
 *  a shared-files stop, an implement sent back to a full analysis and a
 *  short analysis over a limit. A CLI error has no such promise. */
export const STOPPED_ENDINGS_THAT_LAND: readonly string[] = [
  "timeout", "provider-limit", "shared-files", "sent-back", "short-analysis-over-limit",
];

const PLAIN: LandingPolicy = {
  landsWhenStopped: true,
  stoppedPastCode: [],
  codeFirst: false,
  codeRoot: "merge",
  specFolderOnly: false,
  numbersSpec: false,
  checksOrigin: false,
  retriesLate: false,
  keepsFailedTests: false,
};

/** One entry per workflow step (`core/scripts/lib/workflow-steps.json`). */
export const LANDING_POLICIES: Readonly<Record<string, LandingPolicy>> = {
  create: { ...PLAIN, onOk: { landing: "new-spec", endings: "any" }, numbersSpec: true },
  analyze: { ...PLAIN, onOk: { landing: "step", endings: "any" }, specFolderOnly: true },
  // A reopen lands for the reason analyze does: the un-archived folder is
  // what makes the spec active again, and the page reads the main checkout.
  reopen: { ...PLAIN, onOk: { landing: "step", endings: "any" }, specFolderOnly: true },
  // Lands nothing when it finishes: its code waits on its branch for archive.
  implement: { ...PLAIN, stoppedPastCode: ["sent-back"], specFolderOnly: true },
  // Lands on `completed` alone: a refusal from `aide-archive-spec` is ok
  // but archived nothing, and `already-landed` has nothing left to land.
  // A stopped archive never lands: its pre-check moved the folder on the
  // branch, and that move waits for a completed archive.
  archive: {
    ...PLAIN,
    onOk: { landing: "archive", endings: ["completed"] },
    landsWhenStopped: false,
    codeFirst: true,
    codeRoot: "merge-unless-pr",
    checksOrigin: true,
    retriesLate: true,
    keepsFailedTests: true,
  },
  // Lands on `closed` alone; every other ending moved nothing.
  close: { ...PLAIN, onOk: { landing: "close", endings: ["closed"] }, codeRoot: "discard", specFolderOnly: true },
  schedule: { ...PLAIN, onOk: { landing: "schedule", endings: "any", onlyWhenPushed: true }, codeFirst: true },
  // Leaves no spec branch for anyone to land.
  explore: PLAIN,
  deploy: PLAIN,
  cleanup: PLAIN,
};

const NOTHING: LandingPolicy = { ...PLAIN, landsWhenStopped: false };

/** The policy a step's landing reads. Without a step nothing lands; a
 *  name the table does not hold lands as `explore` does. */
export function landingPolicy(step: string | undefined): LandingPolicy {
  if (!step) return NOTHING;
  return Object.hasOwn(LANDING_POLICIES, step) ? LANDING_POLICIES[step]! : LANDING_POLICIES.explore!;
}
