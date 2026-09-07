// The view builders behind the Specs list's archived rows and a
// spec's own page (spec: split serve.ts, step 3) — pulled out of
// `createServer`'s closure the same way `handleQueue` was in step 2:
// an explicit context object stands in for the locals these functions
// used to read directly.

import { SPEC_FILES, specFileText, type SpecRef } from "../project/discover.ts";
import type { SpecFileView, QueueRowView, QueueTarget } from "../render.ts";
import type { QueueStore, Job } from "../queue/queue.ts";
import type { SpecCreatedAtChecker, SpecFileCommitChecker } from "../git/description-freshness.ts";
import type { BranchStatusChecker, GitRunner } from "../git/branch-status.ts";
import type { BoardsContext } from "./boards/lifecycle.ts";

/** Everything these view builders read off `createServer`'s closure,
 *  bundled the same way `HandleQueueContext` bundles `handleQueue`'s.
 *  `readScan` and `readPrOpen` are getters rather than values for the
 *  same reason `HandleQueueContext.readScan` is: both are `let`s that
 *  `createServer`'s own scan/landing-check machinery reassigns after
 *  this context is built, and a snapshot taken at build time would
 *  never see a later refresh. */
export interface SpecViewsContext {
  projectRoot: string | undefined;
  targets: () => QueueTarget[];
  peekUnlanded: () => string[];
  peekUnlandedCheckedAt: () => number | null;
  readPrOpen: () => string[];
  readScan: () => { archived: string[]; refs: Map<string, SpecRef> } | null;
  queue: QueueStore;
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  peekMachinerySpecDir: (project: string, dir: string) => string;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  dependencyFolders: (project: string, dir: string) => string[];
  gitRun: GitRunner;
  withFreshness: (list: QueueTarget[]) => QueueTarget[];
  jobRow: (job: Job) => Promise<QueueRowView>;
  queueToken: string | undefined;
  specFileCommits: SpecFileCommitChecker;
  /** REQ-1/REQ-6: the same "is this branch open" primitive
   *  `rootsStillHolding()` already calls, reused here so the Checks
   *  section can read an active spec's real, already-committed
   *  progress off its own `aide/<folder>` branch when one is open,
   *  rather than off whatever `main`'s copy of `4-status.md` says. */
  branchStatus: BranchStatusChecker;
  specsRoot: (dir: string) => Promise<string>;
  /** REQ-6: the peek `archivedSpecRows` reads an archived spec's true
   *  creation date off, warmed by `refreshSpecCaches`'s own archived-dir
   *  sweep — the same "already exists at the top level, just not
   *  threaded through" gap `schedules.specCreatedAt` had before this. */
  specCreatedAt: SpecCreatedAtChecker;
  /** Whether `md-to-pdf` is resolvable on this host (spec 358, REQ-7) —
   *  the only new field `specPageView` itself reads; `pdfCacheDir`/
   *  `pdfGeneratorBin` live only on `HandleQueueContext`, where the
   *  route that actually spawns the script runs. */
  pdfToolAvailable: boolean;
  /** The board registry and `roundAvailable`/status-refresh primitives
   *  (spec 388) — the only new field `specPageView` itself reads;
   *  the routes that start/stop a board live on `HandleQueueContext`. */
  boards: BoardsContext;
}

export function specFileViews(ctx: SpecViewsContext, dir: string): SpecFileView[] {
  return SPEC_FILES.map((name) => {
    const { sha, at, checkedAt } = ctx.specFileCommits.peekCommitFor(dir, name);
    // The one cache in this spec a sweep over the live list cannot
    // fill: an ARCHIVED spec's page is a real render path too, and
    // archived specs are not `targets()`'s business. So the fill is
    // started from the request and never waited on — bounded by how
    // many archived specs anyone actually opens, rather than by how
    // many exist, which is the unbounded cost spec 178's own plan
    // review rejected. The next view of this page has the stamp.
    if (checkedAt === null) void ctx.specFileCommits.commitFor(dir, name);
    return {
      label: name,
      text: specFileText(dir, name),
      sha: sha ?? undefined,
      at: at ?? undefined,
      // Nothing has ever asked. Not "git cannot date this file" —
      // that is a real, timestamped answer and shows no stamp at all,
      // exactly as it did before this cache existed.
      checking: checkedAt === null,
    };
  });
}

/** WHEN a spec was archived. The stamp the archive step writes into
 *  `4-status.md` first; failing that, the commit that last touched the
 *  folder — an archived spec is not edited afterwards, so the newest
 *  commit under `archive/<folder>` IS the one that moved it there.
 *
 *  `dir` is the spec's OWN folder and the pathspec is `"."`, the same
 *  dir/pathspec pairing every other `lastCommitOf` call here uses: git
 *  is run IN the directory being asked about, and a pathspec naming a
 *  path outside it would answer nothing at all.
 *
 *  `null` from both is a real answer and the page prints it in words.
 *  Only a spec with no stamp reaches git, which since spec 147 is a
 *  shrinking minority. */

// The three families that used to live here as well.
export { archivedAt, archivedSteps, archivedModels, archivedPhaseOutcomes, archivedSpecRows } from "./spec-views/archived.ts";
export { specPageView } from "./spec-views/spec-page.ts";
export { jobDetailView } from "./spec-views/job-detail.ts";
