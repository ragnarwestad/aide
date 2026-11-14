// A spec's own claims as committed on its own open `aide/<folder>` branch
// and what a spec's files claim in general — the
// file half of `stepsFileDisagreesOn`'s comparison in `workflow-history.ts`,
// which re-exports everything here.

import { dirname, join } from "node:path";
import { branchAcCoverage, type AcTest } from "../project/ac-coverage.ts";
import type { GitRunner } from "./process/index.ts";
import { readStatusFromBranch, type OpenBranchTarget } from "./branch-file.ts";
import { acceptanceRowsOf, parseStatus, type StatusCheck } from "../project/parse-status";
import { parseSpecStateText, type SpecStateAcceptanceRow } from "../project/parse-spec-state.ts";
import { dependsOnIn } from "../project/discover/depends-on.ts";
import { groupIn, type SpecGroupMembership } from "../project/discover/group.ts";
import { createChoicesIn, type CreateChoices } from "../project/discover/create-choices.ts";
import { parseApproaches, type ApproachChoice } from "../project/approach-choice.ts";
import { DESCRIPTION_FILE, SOLUTION_FILE, STATE_FILE } from "../project/spec-names.ts";
import { DEFAULT_TTL_MS } from "./branch-status.ts";


/** What a spec's own files claim, kept apart by source — the
 *  prose's own line, and the state file's `completedPhases` when this
 *  copy of the spec (disk or branch) has one. */
export interface FileStepsAnswer {
  /** What `4-status.md`'s own `Workflow steps completed` line claims. */
  proseSteps: string[];
  /** `4-status.json`'s own `completedPhases` — `undefined` when this
   *  copy of the spec's files has no state file yet,
   *  the cue to keep comparing `proseSteps` against git. */
  stateSteps: string[] | undefined;
  /** `4-status.json`'s own acceptance rows — the one source for whether a
   *  row is open, Not verified or Failed. `undefined` when this copy has
   *  no state file, and such a copy has no open row. A tick on a spec with
   *  an open branch is written there, beside the prose, in one commit. */
  stateAcceptance?: SpecStateAcceptanceRow[];
  /** The Acceptance section's rows off that same file, for the Specs
   *  list's unfold — the row draws them without reading git. */
  acceptance?: StatusCheck[];
  /** Which test covers which criterion, off the same branch: the
   *  default branch has it only once archive lands. */
  acCoverage?: Record<string, AcTest[]>;
  /** The approaches the branch's `3-solution.md` marks, and its chosen
   *  line: the row's choice is saved onto the branch, as a tick is. */
  approaches?: ApproachChoice;
  /** The `Depends on:` line of the branch's `1-description.md`: a save of
   *  it is written onto the branch, as a tick is. Absent when the
   *  description could not be read there; empty when the branch has no line. */
  dependsOn?: string[];
  group?: SpecGroupMembership;
  /** The four settings the branch's `1-description.md` records, saved there
   *  as Depends on is; absent when the description could not be read there. */
  createChoices?: CreateChoices;
  /** When the disk scan read this copy, epoch ms. Set by `targets()` on the disk answer only — the branch
   *  copy's read time is `peekFileSteps().checkedAt` — so an answer that came from the branch has none. */
  readAt?: number;
}

/** What `peekFileSteps` hands back: the branch answer, when it was read
 *  (`null` when never), and whether a write has marked it due since. */
export interface BranchPeek {
  steps: FileStepsAnswer | null;
  checkedAt: number | null;
  stale?: boolean;
}

/** Which copy of a spec answers, and whether it is known to be the newest. */
export interface SpecCopy {
  answer: FileStepsAnswer;
  from: "branch" | "main";
  /** False while an open branch's answer is unread or marked due: main then
   *  answers, but it may not be the spec's newest copy. */
  settled: boolean;
}

/** The one rule for which copy of a spec every reader reads: the branch copy
 *  once it has been read and no write has marked it due, however long ago
 *  that read was — the schedule refills every few minutes, so most answers
 *  are past their window — and the copy on main otherwise. */
export function specCopy(branch: BranchPeek, disk: FileStepsAnswer): SpecCopy {
  const read = branch.checkedAt !== null && !branch.stale;
  if (read && branch.steps) return { answer: branch.steps, from: "branch", settled: true };
  return { answer: disk, from: "main", settled: read };
}

export interface BranchFileStepsOptions {
  run: GitRunner;
  ttlMs?: number;
  now?: () => number;
}

/** A spec's own claims as committed on its own open `aide/<folder>`
 *  branch — the file half of `stepsFileDisagreesOn`'s
 *  comparison, read from the same point in the graph the history half
 *  (`WorkflowHistoryChecker`, `git log --all`) already answers from,
 *  rather than from the default branch's stale copy. Both
 *  `4-status.md`'s prose and, alongside it, `4-status.json`'s own
 *  `completedPhases` when the branch has one — the state
 *  file is what a gate reads there too, and a branch mid-`implement`
 *  must not keep comparing it against git once it exists. Shaped
 *  exactly like `WorkflowHistoryChecker`: async `read`, TTL-cached, and
 *  a `peekFileSteps` a render may call without ever spawning git.
 *
 *  `null` means "no open branch, or the branch's copy could not be
 *  read" — the caller's own cue to fall back to the disk read, which is
 *  what every spec without an open branch keeps doing unchanged
 */
export class BranchFileStepsChecker {
  private readonly run: GitRunner;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; steps: FileStepsAnswer | null; stale?: boolean }>();

  constructor(opts: BranchFileStepsOptions) {
    this.run = opts.run;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** `target` is `null` for a spec with no open branch — the caller
   *  (`warmSpec`) has already asked `resolveOpenBranchTarget`, so this
   *  class never resolves a branch itself. */
  async read(dir: string, specFolder: string, target: OpenBranchTarget | null): Promise<FileStepsAnswer | null> {
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    const at = this.now();
    if (hit && !hit.stale && at - hit.at < this.ttlMs) return hit.steps;

    let steps: FileStepsAnswer | null = null;
    if (target) {
      try {
        // Wherever the folder is ON the branch: `archive` moves it to
        // `archive/<folder>` and commits that there, so a branch whose
        // archive has run but not landed answers nothing for the active
        // path while the default branch still holds the folder in it.
        for (const relPath of [target.relPath, target.archivedRelPath]) {
          const file = await readStatusFromBranch(this.run, target.root, target.branch, relPath);
          if (!file) continue;
          // The branch's own sibling `4-status.json`, at the
          // same place `4-status.md` sits — read alongside the prose,
          // never in its place, so `stateSteps` can stay `undefined` for
          // a branch that has none yet.
          const jsonPath = join(dirname(relPath), STATE_FILE);
          const jsonFile = await readStatusFromBranch(this.run, target.root, target.branch, jsonPath);
          const state = jsonFile ? parseSpecStateText(jsonFile.text) : null;
          const acCoverage = await branchAcCoverage(this.run, target, relPath);
          const solution = await readStatusFromBranch(this.run, target.root, target.branch, join(dirname(relPath), SOLUTION_FILE));
          const description = await readStatusFromBranch(this.run, target.root, target.branch, join(dirname(relPath), DESCRIPTION_FILE));
          steps = {
            proseSteps: parseStatus(file.text).workflowSteps,
            stateSteps: state?.completedPhases,
            ...(state ? { stateAcceptance: state.acceptanceCriteria } : {}),
            acceptance: acceptanceRowsOf(file.text),
            ...(acCoverage ? { acCoverage } : {}),
            ...(solution ? { approaches: parseApproaches(solution.text) } : {}),
            ...(description ? { dependsOn: dependsOnIn(description.text), group: groupIn(description.text), createChoices: createChoicesIn(description.text) } : {}),
          };
          break;
        }
      } catch {
        steps = null;
      }
    }
    this.cache.set(key, { at, steps });
    return steps;
  }

  /** Mark one spec's cached answer due, so the next `read` goes to git
   *  even inside the window. Called through `forgetSpec` after every
   *  write to the spec's files. */
  forget(dir: string, specFolder: string): void {
    // Marked, not dropped: the peek still reports when the answer was
    // read, which the row's sources count, while `specCopy` reads main
    // until `read` has replaced it.
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    if (hit) this.cache.set(key, { ...hit, stale: true });
  }

  /** No git spawn, ever — what `withFreshness` calls. `steps: null`
   *  covers two different truths the caller does not need to tell
   *  apart: no open branch, and "not warmed yet" — both mean "fall back
   *  to the disk read" (unchanged behavior). */
  peekFileSteps(dir: string, specFolder: string): BranchPeek {
    const hit = this.cache.get(JSON.stringify([dir, specFolder]));
    return hit ? { steps: hit.steps, checkedAt: hit.at, stale: hit.stale } : { steps: null, checkedAt: null };
  }
}
