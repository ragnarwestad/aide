// A spec's own claims as committed on its own open `aide/<folder>` branch
// (spec 298), and what a spec's files claim in general (spec 362) — the
// file half of `stepsFileDisagreesOn`'s comparison in `workflow-history.ts`,
// which re-exports everything here.

import { branchAcCoverage, type AcTest } from "../project/ac-coverage.ts";
import type { GitRunner } from "./branch-status.ts";
import { readStatusFromBranch, type OpenBranchTarget } from "./branch-file.ts";
import { acceptanceCriteriaUnticked, acceptanceRowsOf, parseStatus, type StatusCheck } from "../project/parse-status";
import { parseSpecStateText } from "../project/parse-spec-state.ts";

/** How long one answer stands, for this checker and `WorkflowHistoryChecker` alike. */
export const DEFAULT_TTL_MS = 30_000;

/** What a spec's own files claim, kept apart by source (spec 362) — the
 *  prose's own line, and the state file's `completedPhases` when this
 *  copy of the spec (disk or branch) has one. */
export interface FileStepsAnswer {
  /** What `4-status.md`'s own `Workflow steps completed` line claims. */
  proseSteps: string[];
  /** `4-status.json`'s own `completedPhases` — `undefined` when this
   *  copy of the spec's files has no state file yet (spec 355 REQ-10),
   *  the cue to keep comparing `proseSteps` against git (REQ-2). */
  stateSteps: string[] | undefined;
  /** Whether the file has an acceptance row nobody has ticked — read
   *  off the same branch copy as the steps, since a tick on a spec
   *  with an open branch is written THERE (spec-edit.ts, REQ-4) and the
   *  default branch's copy stays unticked until archive lands. The
   *  row's "archive held back" and the queue's archive hold-back read
   *  this before the disk copy; absent when the answer came off disk. */
  acceptanceOpen?: boolean;
  /** The Acceptance section's rows off that same file, for the Specs
   *  list's unfold — the row draws them without reading git. */
  acceptance?: StatusCheck[];
  /** Which test covers which criterion, off the same branch: the
   *  default branch has it only once archive lands. */
  acCoverage?: Record<string, AcTest[]>;
  /** When the disk scan read this copy, epoch ms. Set by `targets()` on the disk answer only — the branch
   *  copy's read time is `peekFileSteps().checkedAt` — so an answer that came from the branch has none. */
  readAt?: number;
}

export interface BranchFileStepsOptions {
  run: GitRunner;
  ttlMs?: number;
  now?: () => number;
}

/** A spec's own claims as committed on its own open `aide/<folder>`
 *  branch (spec 298) — the file half of `stepsFileDisagreesOn`'s
 *  comparison, read from the same point in the graph the history half
 *  (`WorkflowHistoryChecker`, `git log --all`) already answers from,
 *  rather than from the default branch's stale copy. Both
 *  `4-status.md`'s prose and, alongside it, `4-status.json`'s own
 *  `completedPhases` when the branch has one (spec 362) — the state
 *  file is what a gate reads there too, and a branch mid-`implement`
 *  must not keep comparing it against git once it exists. Shaped
 *  exactly like `WorkflowHistoryChecker`: async `read`, TTL-cached, and
 *  a `peekFileSteps` a render may call without ever spawning git.
 *
 *  `null` means "no open branch, or the branch's copy could not be
 *  read" — the caller's own cue to fall back to the disk read, which is
 *  what every spec without an open branch keeps doing unchanged
 *  (REQ-3). */
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
          // spec 362: the branch's own sibling `4-status.json`, at the
          // same place `4-status.md` sits — read alongside the prose,
          // never in its place, so `stateSteps` can stay `undefined` for
          // a branch that has none yet (REQ-2).
          const jsonPath = relPath.replace(/4-status\.md$/, "4-status.json");
          const jsonFile = await readStatusFromBranch(this.run, target.root, target.branch, jsonPath);
          const state = jsonFile ? parseSpecStateText(jsonFile.text) : null;
          const acCoverage = await branchAcCoverage(this.run, target, relPath);
          steps = {
            proseSteps: parseStatus(file.text).workflowSteps,
            stateSteps: state?.completedPhases,
            acceptanceOpen: state
              ? state.acceptanceCriteria.some((row) => !row.done)
              : acceptanceCriteriaUnticked(file.text),
            acceptance: acceptanceRowsOf(file.text),
            ...(acCoverage ? { acCoverage } : {}),
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

  /** Drop one spec's cached answer, so the next `read` goes to git.
   *  The Checks tab's tick writes the very file this caches, onto the
   *  same branch it reads: without this the row went on saying "held
   *  back: the Acceptance criteria are not all ticked yet" for the rest
   *  of the TTL after a Save that ticked the last row (337,
   *  2026-09-04). */
  forget(dir: string, specFolder: string): void {
    // Marked due for a fresh read, NOT dropped: the row keeps answering
    // from it until `read` has replaced it. Dropped, the row fell back
    // to the default branch's copy of the file for as long as the
    // re-read took, and that copy still says what it said before
    // implement ran — so a tick on the Checks tab made the row announce
    // that the files disagree (425, 2026-09-09).
    const key = JSON.stringify([dir, specFolder]);
    const hit = this.cache.get(key);
    if (hit) this.cache.set(key, { ...hit, stale: true });
  }

  /** No git spawn, ever — what `withFreshness` calls. `steps: null`
   *  covers two different truths the caller does not need to tell
   *  apart: no open branch, and "not warmed yet" — both mean "fall back
   *  to the disk read" (REQ-3's own behavior, unchanged). */
  peekFileSteps(
    dir: string,
    specFolder: string,
  ): { steps: FileStepsAnswer | null; checkedAt: number | null; stale?: boolean } {
    const hit = this.cache.get(JSON.stringify([dir, specFolder]));
    return hit ? { steps: hit.steps, checkedAt: hit.at, stale: hit.stale } : { steps: null, checkedAt: null };
  }
}
