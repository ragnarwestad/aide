// How far one spec has got — the phases it has completed and whether its
// acceptance is still open — read by one rule for every reader: the specs
// list, the runner's holds and the Run route. The copy that answers is
// `specCopy`'s, its phases are `completedPhasesOf`'s, and its acceptance is
// that same copy's state file rows. Memory and disk only, never git: the
// schedule keeps the caches fed.

import {
  completedPhasesOf, specCopy,
  type BranchFileStepsChecker, type BranchPeek, type FileStepsAnswer, type WorkflowHistory, type WorkflowHistoryChecker,
} from "../../git/workflow-history.ts";
import { readSpecState } from "../../project/parse-spec-state.ts";
import { proseSteps } from "../../project/discover/spec-files.ts";
import { failedCount, notVerifiedCount } from "../../project/parse-status";

export interface SpecProgress {
  /** The phases the answering copy and the git history record. */
  completedPhases: string[];
  /** What the copy on main records — whether the work has reached main, which
   *  implement starts from. A question of its own, not the spec's progress. */
  onMain: string[];
  acceptanceOpen: boolean;
  notVerified: number;
  failed: number;
  from: "branch" | "main";
  /** Whether the copy that answered is known to be the spec's newest. */
  settled: boolean;
}

/** The caches the reader peeks; `ScheduleContext` is one. */
export interface SpecProgressCaches {
  readBranchFileSteps?: () => BranchFileStepsChecker | undefined;
  readWorkflowHistory?: () => WorkflowHistoryChecker | undefined;
}

/** The rule itself, for a caller that has read the copy on main already. */
export function specProgressOf(
  disk: FileStepsAnswer,
  branch: BranchPeek,
  history: Omit<WorkflowHistory, "superseded"> | null,
): SpecProgress {
  const copy = specCopy(branch, disk);
  const rows = copy.answer.stateAcceptance ?? [];
  return {
    completedPhases: completedPhasesOf(copy.answer, history),
    onMain: disk.stateSteps ?? disk.proseSteps,
    acceptanceOpen: rows.some((row) => !row.done),
    notVerified: notVerifiedCount(rows),
    failed: failedCount(rows),
    from: copy.from,
    settled: copy.settled,
  };
}

/** One spec's progress off its folder on main and the two cached answers,
 *  peeked under the same folder and reopen mark the schedule warms them under. */
export function readSpecProgress(caches: SpecProgressCaches, dir: string, specFolder: string): SpecProgress {
  const state = readSpecState(dir);
  const disk: FileStepsAnswer = {
    proseSteps: proseSteps(dir),
    stateSteps: state?.completedPhases,
    ...(state ? { stateAcceptance: state.acceptanceCriteria } : {}),
  };
  const branch = caches.readBranchFileSteps?.()?.peekFileSteps(dir, specFolder) ?? { steps: null, checkedAt: null };
  const history = caches.readWorkflowHistory?.()?.peekHistory(dir, specFolder, state?.reopened?.boundaryCommit).history ?? null;
  return specProgressOf(disk, branch, history);
}
