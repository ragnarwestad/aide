// The copy read from the branch a still-open spec is on, rather than
// the default branch's own.
//
// Split out of committed-history-freshness.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createdJob, ran, statusSaying } from "../../helpers/queue-server.ts";
import type { GitRunner } from "../../../src/git/process/index.ts";
import { withFreshness } from "../../../src/serve/land-branch";
import type { LandContext } from "../../../src/serve/land-branch";
import type { SpecTarget } from "../../../src/render";
import { specControls, phaseDone, listUntil, dated, setupQueueRoutesHarness } from "../fixtures.ts";
import { branchReadingGit, type BranchReadingOpts } from "./branch-reading-fixtures.ts";

const { harness, start: startServer } = setupQueueRoutesHarness();
const start: typeof startServer = (extra, projects, specs, status, state, mirror) =>
  startServer(extra, projects, specs, status, state, mirror ?? (extra?.queueMirrorPath ? undefined : JSON.stringify([createdJob()])));

afterEach(() => harness.cleanup());

// The runner owns the record of what has run.
//
// Two incidents on 2026-08-21, in opposite directions. One implement
// had RED and GREEN done and every test green, and was killed by the
// step's own time limit before the model reached the part that writes
// `4-status.md` — so the row read "implement not run" about a spec
// whose code was committed on its branch. The other's four files were copied
// from a sibling whose analyze had landed, so a brand-new spec claimed
// three steps and the row offered implement first.
//
// The commits are the record now. The file's line is a claim, and a
// claim the history does not support is said out loud on the row.

// Implement lands nothing until archive, so a finished
// implement's own rewrite of `4-status.md`'s "Workflow steps completed:"
// line sits only on `aide/<folder>` — the DEFAULT-branch checkout this
// suite's disk reads all come from never sees it, and reads as
// disagreeing with a history that (via `--all`) does. The fix reads the
// file from the branch instead, once it is still open, and falls back to
// the disk read exactly as before when it is not.
describe("the file is read from the branch a still-open spec is on", () => {
  const FOLDER = "81-queue-and-runner";
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", FOLDER);

  /** Real git, except for the reads of this spec's open branch. */
  const branchReadingGitRun = (opts: BranchReadingOpts): GitRunner => branchReadingGit(FOLDER, opts);

  /** Same wait as the other freshness suites: the schedule has to warm
   *  this spec at least once, and the disk scan has to catch up with
   *  the fixture's own writes. */
  const listPage = async (base: string): Promise<string> => {
    await new Promise((r) => setTimeout(r, 400));
    return listUntil(base, dated, undefined, "a dated Created cell for the spec");
  };

  test("a branch copy that matches the history clears the qualifier the stale disk copy would raise", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: true, branchText: statusSaying(["create", "analyze", "implement"]) }),
    });
    // The disk copy — the default-branch checkout's own — has not caught
    // up: implement's own commit and its own rewrite of this line sit
    // only on the branch until archive lands them.
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze", "implement"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).not.toContain("disagree about whether");
  });

  test("a branch copy that genuinely disagrees with the history still says so", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: true, branchText: statusSaying(["create", "analyze"]) }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze", "implement"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(line).toContain("disagree about whether");
  });

  // Reported live: `archive` had already run ON
  // THE BRANCH — the folder moved to `archive/<folder>` there and the
  // status file went with it — while the branch itself had not landed,
  // so the default branch still carried the folder in its active place
  // with a status line stopping at `analyze`. The branch read asked for
  // the ACTIVE path only, found nothing, fell back to that stale copy,
  // and the row then reported implement as disagreeing with a history
  // that had it. Reading the branch means reading wherever the folder
  // is ON the branch — the same "active folder, then archive/" pair
  // `aide_resolve_spec`, `resolve_dependency_folder`, `status_file_for`
  // and `aide-run-spec` already resolve.
  test("a folder archive has already moved on the branch is still read from the branch", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({
        open: true,
        archivedText: statusSaying(["create", "analyze", "implement", "archive"]),
      }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    // The branch read fetches the branch, so its own commits — implement's
    // and archive's alike — are in `git log --all` by the time the history
    // half answers.
    ran(dir, ["create", "analyze", "implement", "archive"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(line).not.toContain("disagree about whether");
  });

  test("no open branch falls back to the disk read, exactly as before this fix", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({ open: false }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    // `listPage`'s own `dated` predicate is satisfied by `targets()`'s
    // FIRST scan — cached for a flat 5s (`spec-lookup.ts`) regardless of
    // how often the schedule ticks — which here ran before this test's
    // own `writeFileSync` above. Every other test in this file gives a
    // branch answer that skips the disk read entirely; this is the one
    // whose assertion needs that scan to have caught up with the
    // rewrite, so it polls for the words themselves rather than for
    // `dated` alone.
    const html = await listUntil(
      base,
      (h) => specControls(h, FOLDER).includes("disagree about whether"),
      undefined,
      "the disk scan to catch up with the rewritten status file",
    );
    expect(specControls(html, FOLDER)).toContain("disagree about whether");
  });

  // The branch path: the branch's own 4-status.json
  // is the truth once one exists there too — the five other specs still
  // on their own open branch (found during analysis) are reachable only
  // through this path, not the disk one above.
  test("the branch's own state file claiming a phase git has no commit for raises no qualifier", async () => {
    const { base, dir } = start({
      gitRun: branchReadingGitRun({
        open: true,
        branchText: statusSaying(["create", "analyze"]),
        stateText: JSON.stringify({
          completedPhases: ["create", "analyze"],
          archived: null,
          reopened: null,
          acceptanceCriteria: [],
          phaseCounts: {},
        }),
      }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).not.toContain("disagree about whether");
  });

  // `withFreshness` stays synchronous, so a render never awaits
  // the branch read. `bunx tsc --noEmit` catches a regression that made
  // it `async` at the type level; this proves it at the value level too.
  test("withFreshness returns synchronously, with no await anywhere in the call", () => {
    const list: SpecTarget[] = [
      { project: "aide", specFolder: FOLDER, dir: "/some/dir", fileSteps: { proseSteps: ["create"], stateSteps: undefined } },
    ];
    const ctx = {
      workflowHistory: { peekHistory: () => ({ history: { done: ["create"], stopped: {} }, checkedAt: 1 }) },
      specCreatedAt: { peekCreatedAt: () => ({ createdAt: null }) },
      freshness: { peekStale: () => ({ stale: false }) },
      branchFileSteps: { peekFileSteps: () => ({ steps: null, checkedAt: null }) },
    } as unknown as LandContext;
    const result = withFreshness(ctx, list);
    expect(Array.isArray(result)).toBe(true);
  });
});
