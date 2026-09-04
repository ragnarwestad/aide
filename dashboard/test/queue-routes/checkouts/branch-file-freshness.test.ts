// The copy read from the branch a still-open spec is on, rather than
// the default branch's own.
//
// Split out of committed-history-freshness.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { withFreshness } from "../../../src/serve/land-branch/freshness.ts";
import type { LandContext } from "../../../src/serve/land-branch/types.ts";
import type { QueueTarget } from "../../../src/render.ts";
import {
  TOKEN,
  specControls,
  phaseDone,
  listUntil,
  dated,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// Spec 154: the runner owns the record of what has run.
//
// Two incidents on 2026-08-21, in opposite directions. 147's implement
// had RED and GREEN done and every test green, and was killed by the
// step's own time limit before the model reached the part that writes
// `4-status.md` — so the row read "implement not run" about a spec
// whose code was committed on its branch. 153's four files were copied
// from a sibling whose analyze had landed, so a brand-new spec claimed
// three steps and the row offered implement first.
//
// The commits are the record now. The file's line is a claim, and a
// claim the history does not support is said out loud on the row.

// Spec 298: implement lands nothing until archive, so a finished
// implement's own rewrite of `4-status.md`'s "Workflow steps completed:"
// line sits only on `aide/<folder>` — the DEFAULT-branch checkout this
// suite's disk reads all come from never sees it, and reads as
// disagreeing with a history that (via `--all`) does. The fix reads the
// file from the branch instead, once it is still open, and falls back to
// the disk read exactly as before when it is not.
describe("spec 298: the file is read from the branch a still-open spec is on", () => {
  const FOLDER = "81-queue-and-runner";
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", FOLDER);

  /** Real git for everything (workflow history), except the branch-read
   *  calls `resolveOpenBranchTarget`/`readStatusFromBranch` make — there
   *  is no real `origin` remote in this harness, so those calls are
   *  simulated, scoped to this spec's own branch and path.
   *
   *  `rev-parse --show-toplevel` is intercepted too, the same way
   *  `branchAwareGitRunner` (`spec-checks-fixtures.ts`) already does:
   *  real git resolves macOS's `/tmp` → `/private/tmp` symlink, which
   *  makes its answer a different STRING than the literal `dir` this
   *  fixture was handed even though both name the same directory — and
   *  `relative(root, ...)` then builds a `../../..` path instead of a
   *  clean relative one. Slicing the known suffix off `d` keeps `root`
   *  in the same string family `dir` already is. */
  const branchReadingGitRun = (
    opts: { open: boolean; branchText?: string; archivedText?: string; stateText?: string },
  ): GitRunner => {
    const real = createGitRunner();
    const branch = `aide/${FOLDER}`;
    const relPath = `aide/specs/${FOLDER}/4-status.md`;
    // Where `archive` moves the folder ON THE BRANCH once it has run
    // there — the active path above then names nothing at all, and git
    // answers a `log` for it with no sha, exactly as modelled below.
    const archivedRelPath = `aide/specs/archive/${FOLDER}/4-status.md`;
    // The branch's own sibling state file (spec 362) — read alongside
    // `relPath`, at the same active-folder path `4-status.md` sits at.
    const jsonRelPath = `aide/specs/${FOLDER}/4-status.json`;
    const ref = `refs/remotes/origin/${branch}`;
    const specFolderSuffix = join("aide", "specs", FOLDER);
    return async (dir, args, timeoutMs, env) => {
      const line = args.join(" ");
      if (line === "rev-parse --show-toplevel" && dir.endsWith(specFolderSuffix)) {
        return { code: 0, stdout: `${dir.slice(0, dir.length - specFolderSuffix.length - 1)}\n` };
      }
      if (line === "ls-remote --heads origin refs/heads/aide/*") {
        return {
          code: 0,
          stdout: opts.open ? `deadbeef0000000000000000000000000000000\trefs/heads/${branch}\n` : "",
        };
      }
      if (line === `fetch --quiet origin ${branch}`) return { code: 0, stdout: "" };
      if (line === `log -1 --format=%H ${ref} -- ${relPath}`) {
        return { code: 0, stdout: opts.archivedText === undefined ? "cafebabe000000000000000000000000000000\n" : "" };
      }
      if (line === `show ${ref}:${relPath}`) return { code: 0, stdout: opts.branchText ?? "" };
      if (line === `log -1 --format=%H ${ref} -- ${archivedRelPath}`) {
        return { code: 0, stdout: opts.archivedText === undefined ? "" : "cafebabe000000000000000000000000000000\n" };
      }
      if (line === `show ${ref}:${archivedRelPath}`) return { code: 0, stdout: opts.archivedText ?? "" };
      if (opts.stateText !== undefined) {
        if (line === `log -1 --format=%H ${ref} -- ${jsonRelPath}`) {
          return { code: 0, stdout: "cafef00d000000000000000000000000000000\n" };
        }
        if (line === `show ${ref}:${jsonRelPath}`) return { code: 0, stdout: opts.stateText };
      }
      return real(dir, args, timeoutMs, env);
    };
  };

  /** Same wait as the "spec 154" suite above: the schedule has to warm
   *  this spec at least once, and the disk scan has to catch up with
   *  the fixture's own writes. */
  const listPage = async (base: string): Promise<string> => {
    await new Promise((r) => setTimeout(r, 400));
    return listUntil(base, dated);
  };

  test("REQ-1: a branch copy that matches the history clears the qualifier the stale disk copy would raise", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: true, branchText: statusSaying(["create", "analyze", "implement"]) }),
    });
    // The disk copy — the default-branch checkout's own — has not caught
    // up: implement's own commit and its own rewrite of this line sit
    // only on the branch until archive lands them.
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze", "implement"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).not.toContain("the files disagree with what has run");
  });

  test("REQ-2: a branch copy that genuinely disagrees with the history still says so", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: true, branchText: statusSaying(["create", "analyze"]) }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze", "implement"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(line).toContain("the files disagree with what has run");
  });

  // Reported live on spec 306 (2026-09-01): `archive` had already run ON
  // THE BRANCH — the folder moved to `archive/<folder>` there and the
  // status file went with it — while the branch itself had not landed,
  // so the default branch still carried the folder in its active place
  // with a status line stopping at `analyze`. The branch read asked for
  // the ACTIVE path only, found nothing, fell back to that stale copy,
  // and the row then reported implement as disagreeing with a history
  // that had it. Reading the branch means reading wherever the folder
  // is ON the branch — the same "active folder, then archive/" pair
  // `aide_resolve_spec`, `resolve_dependency_folder`, `status_file_for`
  // and `aide-run-spec` (spec 202) already resolve.
  test("a folder archive has already moved on the branch is still read from the branch", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
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
    expect(line).not.toContain("the files disagree with what has run");
  });

  test("REQ-3: no open branch falls back to the disk read, exactly as before this fix", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: branchReadingGitRun({ open: false }),
    });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base), FOLDER);
    expect(line).toContain("the files disagree with what has run");
  });

  // Spec 362 (REQ-1/REQ-5, branch path): the branch's own 4-status.json
  // is the truth once one exists there too — the five other specs still
  // on their own open branch (found during analysis) are reachable only
  // through this path, not the disk one above.
  test("REQ-1: the branch's own state file claiming a phase git has no commit for raises no qualifier (spec 362)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
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
    expect(line).not.toContain("the files disagree with what has run");
  });

  // REQ-4: `withFreshness` stays synchronous, so a render never awaits
  // the branch read. `bunx tsc --noEmit` catches a regression that made
  // it `async` at the type level; this proves it at the value level too.
  test("REQ-4: withFreshness returns synchronously, with no await anywhere in the call", () => {
    const list: QueueTarget[] = [
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
