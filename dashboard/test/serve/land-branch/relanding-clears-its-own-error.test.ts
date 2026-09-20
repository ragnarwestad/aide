// The other half of spec 327's rule. A landing failure is the record of
// the step it names, and that step's own successful landing resolves it:
// atlasaurus 05's row said "could not assign this spec its number —
// nothing was pushed; run the step again" while the number had been
// assigned and pushed since (2026-09-20). A LATER step's success still
// leaves the record alone, which is what spec 327 is about.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landBranch } from "../../../src/serve/land-branch";
import { BRANCH, landCtx, landingGit } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "479-spec" };

const failedAt = (step: string) => ({
  landingError: { key: "landing.stepFailed", values: { step }, inner: { key: "landing.createAssignNumberFailed" } },
  landingErrorDetail: "aide-create-spec: no readable answer",
});

async function landAnalyzeWhile(current: Record<string, unknown>) {
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
  const here = mkdtempSync(join(tmpdir(), "aide-relanding-"));
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
  return updates.find((u) => "branchUrls" in u)!;
}

describe("a landing that succeeds", () => {
  test("clears the failure recorded for its own step, detail and all", async () => {
    const landed = await landAnalyzeWhile(failedAt("analyze"));
    expect("landingError" in landed).toBe(true);
    expect(landed.landingError).toBeUndefined();
    expect(landed.landingErrorDetail).toBeUndefined();
  });

  test("leaves another step's failure alone (spec 327)", async () => {
    const landed = await landAnalyzeWhile(failedAt("create"));
    expect("landingError" in landed).toBe(false);
    expect("landingErrorDetail" in landed).toBe(false);
  });

  test("has nothing to clear when no landing failed", async () => {
    const landed = await landAnalyzeWhile({});
    expect("landingError" in landed).toBe(false);
  });
});
