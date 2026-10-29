// The view builders behind the Specs list's archived rows and a
// spec's own page (spec: split serve.ts, step 3) — pulled out of
// `createServer`'s closure the same way `handleRoutes` was in step 2:
// an explicit context object stands in for the locals these functions
// used to read directly.

import { SPEC_FILES, specFileText, type SpecRef } from "../../project/discover";
import type { SpecFileView, QueueRowView, SpecTarget } from "../../render";
import type { QueueStore, Job } from "../../queue/queue.ts";
import type { SpecCreatedAtChecker, SpecFileCommitChecker } from "../../git/description-freshness.ts";
import type { BranchStatusChecker, GitRunner } from "../../git/branch-status.ts";
import type { TestServersContext } from "../test-servers/lifecycle.ts";

/** Everything these view builders read off `createServer`'s closure,
 *  bundled the same way `RoutesContext` bundles `handleRoutes`'s.
 *  `readScan` and `readPrOpen` are getters rather than values for the
 *  same reason `RoutesContext.readScan` is: both are `let`s that
 *  `createServer`'s own scan/landing-check machinery reassigns after
 *  this context is built, and a snapshot taken at build time would
 *  never see a later refresh. */
export interface SpecViewsContext {
  projectRoot: string | undefined;
  targets: () => SpecTarget[];
  peekUnlanded: () => string[];
  peekUnlandedCheckedAt: () => number | null;
  /** Whether an archived spec's open branch is merged wherever it is
   *  still held — a peek (`spec-lookup.ts`). */
  peekMergedOnOrigin: (project: string, folder: string) => boolean;
  readPrOpen: () => string[];
  readScan: () => { archived: string[]; refs: Map<string, SpecRef> } | null;
  queue: QueueStore;
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  peekMachinerySpecDir: (project: string, dir: string) => string;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  gitRun: GitRunner;
  withFreshness: (list: SpecTarget[]) => SpecTarget[];
  jobRow: (job: Job) => Promise<QueueRowView>;
  specFileCommits: SpecFileCommitChecker;
  /** The same "is this branch open" primitive
   *  `rootsStillHolding()` already calls, reused here so the Checks
   *  section can read an active spec's real, already-committed
   *  progress off its own `aide/<folder>` branch when one is open,
   *  rather than off whatever `main`'s copy of `4-status.md` says. */
  branchStatus: BranchStatusChecker;
  specsRoot: (dir: string) => Promise<string>;
  /** The peek `archivedSpecRows` reads an archived spec's true
   *  creation date off, warmed by `refreshSpecCaches`'s own archived-dir
   *  sweep — the same "already exists at the top level, just not
   *  threaded through" gap `schedules.specCreatedAt` had before this. */
  specCreatedAt: SpecCreatedAtChecker;
  /** Whether `md-to-pdf` is resolvable on this host —
   *  the only new field `specPageView` itself reads; `pdfCacheDir`/
   *  `pdfGeneratorBin` live only on `RoutesContext`, where the
   *  route that actually spawns the script runs. */
  pdfToolAvailable: boolean;
  /** The board registry and `previewAvailable`/status-refresh primitives
   *  the only new field `specPageView` itself reads;
   *  the routes that start/stop a board live on `RoutesContext`. */
  testServers: TestServersContext;
}

export async function specFileViews(ctx: SpecViewsContext, dir: string): Promise<SpecFileView[]> {
  // Each file's stamp is asked of the cache, which runs `git log` once
  // per file and TTL. The page streams its head before the spec is
  // built, so the wait is the spec's own, and the stamp is there on the
  // first view.
  return await Promise.all(SPEC_FILES.map(async (name) => {
    const commit = await ctx.specFileCommits.commitFor(dir, name);
    return {
      label: name,
      text: specFileText(dir, name),
      sha: commit?.sha,
      at: commit?.at,
    };
  }));
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
 *  Only a spec with no stamp reaches git, which is a
 *  shrinking minority. */

// The three families that used to live here as well.
export { archivedSteps, archivedModels, archivedPhaseOutcomes, archivedSpecRows } from "./archived.ts";
export { specPageView } from "./spec-page.ts";
export { jobDetailView } from "./job-detail.ts";
