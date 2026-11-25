// A scheduled job's commits reach main the way create/archive's do: the
// same shared `landBranch`, with no `repos` filter — whichever root (or
// both) the run pushed lands — and, since a schedule run has no spec
// folder of its own to scope to, `schedule`'s landing policy does not
// land the spec's folder alone, so the whole branch lands even where the
// specs live inside the code repo.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landScheduleRun } from "../../../../src/serve/land-branch";
import { BRANCH, landCtx, landingGit } from "../landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "schedule-nightly" };

// The merge runs in a worktree BESIDE the root (`mergeWorktreePath`,
// `<root>.landing.<branch>`), never inside it — `startsWith`, not `===`,
// is what tells one root's own merge calls apart from the other's.
const mergedTheBranch = (calls: { args: string[]; dir: string }[], dir: string): boolean =>
  calls.some((c) => c.dir.startsWith(dir) && c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));

/** The git answers of a merge that conflicts: no fast-forward, no merge commit. */
const CONFLICT = {
  "merge -q --ff-only": { code: 1 },
  "merge -q --no-edit": { code: 1 },
  "merge --abort": { code: 0 },
};

/** A code root and a specs root side by side in a fresh temp folder. */
function twoRoots(prefix: string) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const code = join(base, "code");
  const specs = join(base, "specs");
  mkdirSync(code);
  mkdirSync(specs);
  return { code, specs };
}

type Transition = { id: string; state: string; patch: Record<string, unknown> };

/** A queue that records the job's last transition, for `landCtx`'s `queue`. */
function recordingQueue() {
  let transitioned: Transition | undefined;
  const queue = {
    get: () => undefined,
    update: () => {},
    transition: (id: string, state: string, patch: Record<string, unknown>) => {
      transitioned = { id, state, patch };
      return { ok: true };
    },
    branchesFor: () => [],
    renamePendingModel: () => {},
  };
  return { queue, transitioned: () => transitioned };
}

/** Lands JOB's run, which pushed `BRANCH` to each of `roots` in that order. */
function land(ctx: unknown, roots: string[]) {
  return landScheduleRun(
    ctx as Parameters<typeof landScheduleRun>[0],
    JOB as unknown as Parameters<typeof landScheduleRun>[1],
    { branch: BRANCH, branchUrls: roots.map((root) => ({ root, url: "" })) },
  );
}

describe("landScheduleRun", () => {
  test("merges every root the run pushed — the specs root, no gate, and the code root's test gate", async () => {
    const { code, specs } = twoRoots("aide-schedule-land-");
    const gated: string[] = [];
    const git = landingGit();
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => specs,
      landingGate: async (root: string) => {
        gated.push(root);
        return { ok: true };
      },
    });
    await land(ctx, [specs, code]);
    expect(mergedTheBranch(git.calls, specs)).toBe(true);
    expect(mergedTheBranch(git.calls, code)).toBe(true);
    // The gate is the code root's alone — the specs root merges directly.
    expect(gated.length).toBe(1);
    expect(gated[0]!.startsWith(code)).toBe(true);
  });

  test("the code root lands first — a conflict there leaves the specs root's commit unattempted", async () => {
    const { code, specs } = twoRoots("aide-schedule-land-order-");
    const goodGit = landingGit();
    const conflictGit = landingGit(CONFLICT);
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      return (dir.startsWith(code) ? conflictGit.run : goodGit.run)(dir, args);
    };
    const { queue, transitioned } = recordingQueue();
    // Pushed specs-root FIRST in `branchUrls`, the way a run happens to
    // record it — the landing's own sort is what has to put code first,
    // not the order the outcome names the roots in.
    const { ctx } = landCtx(run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => specs,
      queue,
    });
    await land(ctx, [specs, code]);
    expect(mergedTheBranch(calls, code)).toBe(true);
    // The loop stopped on the code root's failure — the specs root's
    // merge, which would otherwise land unconditionally, never ran.
    expect(mergedTheBranch(calls, specs)).toBe(false);
    expect(transitioned()?.state).toBe("landing-failed");
    expect(transitioned()?.patch.errorReason).toBe("conflict");
  });

  test("with the specs inside the code repo, the whole branch lands — schedule does not land a spec's folder alone", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-schedule-land-inproject-"));
    mkdirSync(join(code, "specs"), { recursive: true });
    const git = landingGit();
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => join(code, "specs"),
    });
    await land(ctx, [code]);
    expect(mergedTheBranch(git.calls, code)).toBe(true);
    // Not a folder-only copy: no `diff --name-only ... specs/<folder>`,
    // the shape `analyze`/`reopen`/`close` take instead.
    expect(git.calls.some((c) => c.args[0] === "diff" && c.args.includes(`specs/${JOB.specFolder}`))).toBe(false);
  });

  test("a merge conflict ends the job failed, with nothing merged or pushed", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-schedule-land-conflict-"));
    const git = landingGit(CONFLICT);
    const { queue, transitioned } = recordingQueue();
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => undefined,
      queue,
    });
    await land(ctx, [code]);
    expect(transitioned()?.state).toBe("landing-failed");
    expect(transitioned()?.patch.errorReason).toBe("conflict");
    expect(git.calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("a thrown exception puts its first line in the visible sentence and keeps full detail (AC-3)", async () => {
    const code = "/repos/aide-code";
    const { queue, transitioned } = recordingQueue();
    const { ctx } = landCtx(landingGit().run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => undefined,
      mergeLock: {
        onRelease: () => () => {},
        tryRun: async () => { throw new Error("boom\nmore detail"); },
      },
      queue,
    });
    await land(ctx, [code]);
    expect(transitioned()?.state).toBe("landing-failed");
    expect(transitioned()?.patch.error).toEqual({
      key: "landing.scheduleLandingFailed",
      values: { why: "boom", button: "Run now" },
    });
    expect(transitioned()?.patch.errorDetail).toBe("boom\nmore detail");
  });
});
