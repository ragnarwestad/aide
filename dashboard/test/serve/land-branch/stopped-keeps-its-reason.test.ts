// A step that stopped — at its own time limit, or on a provider's usage
// limit — still lands the work it did. Its `error` is the reason it
// stopped: the row's one full account of it, which a successful landing
// has not resolved. A landing that cleared it left the row reading only
// the short word from the commit subject, ten seconds after it had said
// which limit ran out and when it resets.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landBranch } from "../../../src/serve/land-branch";
import { keepLandingFailedTests } from "../../../src/serve/land-branch/stopped-reason.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { BRANCH, landCtx, landingGit } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "479-spec" };

async function landWhile(current: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const { ctx } = landCtx(landingGit().run, {
    queue: {
      get: () => ({ ...JOB, ...current }),
      update: (_id: string, patch: Record<string, unknown>) => void updates.push(patch),
      transition: (_id: string, event: string, patch?: Record<string, unknown>) => {
        updates.push({ event, ...(patch ?? {}) });
        return { ok: true };
      },
      branchesFor: () => [],
    },
    branchStatus: { defaultBranch: async () => "master", invalidate: () => {}, forgetOpenSpecBranch: () => {} },
  });
  const here = mkdtempSync(join(tmpdir(), "aide-landing-stopped-"));
  await landBranch(
    ctx as unknown as Parameters<typeof landBranch>[0],
    JOB as unknown as Parameters<typeof landBranch>[1],
    { branch: BRANCH },
    {
      step: "analyze" as const,
      repos: [{ root: here, url: "" }],
      failedNote: (why: string) => ({ key: "landing.analyzeLandingFailed" as const, values: { why } }),
    } as unknown as Parameters<typeof landBranch>[3],
  );
  // The landing's own success patch: the one that names the branch.
  return updates.find((u) => "branchUrls" in u)!;
}

describe("a landing of a step that stopped", () => {
  for (const stopReason of ["provider-limit", "timeout"] as const) {
    test(`keeps the reason a ${stopReason} stop gave`, async () => {
      const patch = await landWhile({ state: "stopped", stopReason, error: "five hour provider limit reached" });
      expect(patch).toBeDefined();
      expect("error" in patch).toBe(false);
      expect("errorReason" in patch).toBe(false);
    });
  }

  test("a step that finished still has an old error cleared", async () => {
    const patch = await landWhile({ state: "done", error: "an earlier landing failed" });
    expect(patch).toBeDefined();
    expect("error" in patch).toBe(true);
    expect(patch.error).toBeUndefined();
  });
});

/** A queue holding `jobs`, and which of them keep a list afterwards. */
function queueOf(jobs: Partial<Job>[], listed = true) {
  const byId = new Map(jobs.map((j) => [j.id!, { ...j } as Job]));
  return {
    list: () => (listed ? [...byId.values()] : []),
    update: (id: string, patch: Partial<Job>) => {
      const next = { ...(byId.get(id) ?? ({ id } as Job)), ...patch };
      byId.set(id, next);
      return next;
    },
    kept: () => Object.fromEntries([...byId].filter(([, j]) => j.landingFailedTests).map(([id, j]) => [id, j.landingFailedTests])),
  };
}

const A = { id: "a", project: "aide", specFolder: "479-spec" };
const B = { id: "b", project: "aide", specFolder: "479-spec" };
const OLD = [{ name: "old test", file: "t/old.test.ts", error: "old error" }];
const NEW = [{ name: "new test", file: "t/new.test.ts", error: "new error" }];

describe("the tests a spec's last landing failed", () => {
  test("a later landing's list replaces the one another job of the spec kept (AC-5)", () => {
    const queue = queueOf([{ ...A, landingFailedTests: OLD }, B]);
    keepLandingFailedTests(queue, B, NEW);
    expect(queue.kept()).toEqual({ b: NEW });
  });

  test("the same job red twice keeps the second list (AC-5)", () => {
    const queue = queueOf([{ ...A, landingFailedTests: OLD }]);
    keepLandingFailedTests(queue, A, NEW);
    expect(queue.kept()).toEqual({ a: NEW });
  });

  test("nothing, or an empty list, leaves no job of the spec a list (AC-6, AC-7)", () => {
    for (const tests of [undefined, []]) {
      const queue = queueOf([{ ...A, landingFailedTests: OLD }, { ...B, landingFailedTests: OLD }]);
      keepLandingFailedTests(queue, B, tests);
      expect(queue.kept()).toEqual({});
    }
  });

  test("another spec's list is left alone (AC-5, AC-6)", () => {
    const other = { id: "c", project: "aide", specFolder: "480-other", landingFailedTests: OLD };
    const queue = queueOf([other, A]);
    keepLandingFailedTests(queue, A, undefined);
    expect(queue.kept()).toEqual({ c: OLD });
  });

  test("the landing's own job keeps the list even when the queue does not list it (AC-1)", () => {
    const queue = queueOf([], false);
    keepLandingFailedTests(queue, A, NEW);
    expect(queue.update("a", {}).landingFailedTests).toEqual(NEW);
  });
});
