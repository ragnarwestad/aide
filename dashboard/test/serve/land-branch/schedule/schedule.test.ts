// A scheduled job's commits reach main the way create/archive's do: the
// same shared `landBranch`, with no `repos` filter — whichever root (or
// both) the run pushed lands — and, since a schedule run has no spec
// folder of its own to scope to, `schedule` is kept out of
// `SPEC_ONLY_STEPS` so the whole branch lands even where the specs live
// inside the code repo (spec 558).

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

describe("landScheduleRun", () => {
  test("merges every root the run pushed — the specs root, no gate, and the code root's test gate (AC-1/AC-2/AC-3)", async () => {
    const base = mkdtempSync(join(tmpdir(), "aide-schedule-land-"));
    const code = join(base, "code");
    const specs = join(base, "specs");
    mkdirSync(code);
    mkdirSync(specs);
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
    await landScheduleRun(
      ctx as unknown as Parameters<typeof landScheduleRun>[0],
      JOB as unknown as Parameters<typeof landScheduleRun>[1],
      {
        branch: BRANCH,
        branchUrls: [
          { root: specs, url: "" },
          { root: code, url: "" },
        ],
      },
    );
    expect(mergedTheBranch(git.calls, specs)).toBe(true);
    expect(mergedTheBranch(git.calls, code)).toBe(true);
    // The gate is the code root's alone — the specs root merges directly.
    expect(gated.length).toBe(1);
    expect(gated[0]!.startsWith(code)).toBe(true);
  });

  test("the code root lands first — a conflict there leaves the specs root's commit unattempted (AC-4)", async () => {
    const base = mkdtempSync(join(tmpdir(), "aide-schedule-land-order-"));
    const code = join(base, "code");
    const specs = join(base, "specs");
    mkdirSync(code);
    mkdirSync(specs);
    const goodGit = landingGit();
    const conflictGit = landingGit({
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
    });
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      return (dir.startsWith(code) ? conflictGit.run : goodGit.run)(dir, args);
    };
    let transitioned: { id: string; state: string; patch: Record<string, unknown> } | undefined;
    // Pushed specs-root FIRST in `branchUrls`, the way a run happens to
    // record it — the landing's own sort is what has to put code first,
    // not the order the outcome names the roots in.
    const { ctx } = landCtx(run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => specs,
      queue: {
        get: () => undefined,
        update: () => {},
        transition: (id: string, state: string, patch: Record<string, unknown>) => {
          transitioned = { id, state, patch };
          return { ok: true };
        },
        branchesFor: () => [],
        renamePendingModel: () => {},
      },
    });
    await landScheduleRun(
      ctx as unknown as Parameters<typeof landScheduleRun>[0],
      JOB as unknown as Parameters<typeof landScheduleRun>[1],
      {
        branch: BRANCH,
        branchUrls: [
          { root: specs, url: "" },
          { root: code, url: "" },
        ],
      },
    );
    expect(mergedTheBranch(calls, code)).toBe(true);
    // The loop stopped on the code root's failure — the specs root's
    // merge, which would otherwise land unconditionally, never ran.
    expect(mergedTheBranch(calls, specs)).toBe(false);
    expect(transitioned?.state).toBe("landing-failed");
    expect(transitioned?.patch.errorReason).toBe("conflict");
  });

  test("with the specs inside the code repo, the whole branch lands — schedule is not a SPEC_ONLY_STEP", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-schedule-land-inproject-"));
    mkdirSync(join(code, "specs"), { recursive: true });
    const git = landingGit();
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => join(code, "specs"),
    });
    await landScheduleRun(
      ctx as unknown as Parameters<typeof landScheduleRun>[0],
      JOB as unknown as Parameters<typeof landScheduleRun>[1],
      { branch: BRANCH, branchUrls: [{ root: code, url: "" }] },
    );
    expect(mergedTheBranch(git.calls, code)).toBe(true);
    // Not a folder-only copy: no `diff --name-only ... specs/<folder>`,
    // the shape `analyze`/`reopen`/`close`/`wiki` take instead.
    expect(git.calls.some((c) => c.args[0] === "diff" && c.args.includes(`specs/${JOB.specFolder}`))).toBe(false);
  });

  test("a merge conflict ends the job failed, with nothing merged or pushed (AC-4)", async () => {
    const code = mkdtempSync(join(tmpdir(), "aide-schedule-land-conflict-"));
    const git = landingGit({
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1 },
      "merge --abort": { code: 0 },
    });
    let transitioned: { id: string; state: string; patch: Record<string, unknown> } | undefined;
    const { ctx } = landCtx(git.run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => undefined,
      queue: {
        get: () => undefined,
        update: () => {},
        transition: (id: string, state: string, patch: Record<string, unknown>) => {
          transitioned = { id, state, patch };
          return { ok: true };
        },
        branchesFor: () => [],
        renamePendingModel: () => {},
      },
    });
    await landScheduleRun(
      ctx as unknown as Parameters<typeof landScheduleRun>[0],
      JOB as unknown as Parameters<typeof landScheduleRun>[1],
      { branch: BRANCH, branchUrls: [{ root: code, url: "" }] },
    );
    expect(transitioned?.state).toBe("landing-failed");
    expect(transitioned?.patch.errorReason).toBe("conflict");
    expect(git.calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("a thrown exception is reported through landing.scheduleLandingFailed", async () => {
    const code = "/repos/aide-code";
    let transitioned: { id: string; state: string; patch: Record<string, unknown> } | undefined;
    const { ctx } = landCtx(landingGit().run, {
      machineryProjectDir: () => code,
      machinerySpecsRoot: () => undefined,
      mergeLock: {
        run: async () => {
          throw new Error("boom");
        },
      },
      queue: {
        get: () => undefined,
        update: () => {},
        transition: (id: string, state: string, patch: Record<string, unknown>) => {
          transitioned = { id, state, patch };
          return { ok: true };
        },
        branchesFor: () => [],
        renamePendingModel: () => {},
      },
    });
    await landScheduleRun(
      ctx as unknown as Parameters<typeof landScheduleRun>[0],
      JOB as unknown as Parameters<typeof landScheduleRun>[1],
      { branch: BRANCH, branchUrls: [{ root: code, url: "" }] },
    );
    expect(transitioned?.state).toBe("landing-failed");
    expect((transitioned?.patch.error as { key: string }).key).toBe("landing.scheduleLandingFailed");
  });
});
