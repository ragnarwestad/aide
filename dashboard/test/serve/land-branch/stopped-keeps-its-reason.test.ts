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
