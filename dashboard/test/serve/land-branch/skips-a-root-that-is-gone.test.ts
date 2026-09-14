// A landing carries every root the spec's older jobs ever named
// (`branchesFor`), and a root recorded before the dashboard's files moved
// is not on disk any more. That record failed the whole landing of 453
// and 454 (2026-09-14) after their work was in order. With another root
// still to land, the gone one is skipped and said so; a landing whose ONLY
// root is gone still fails, since nothing at all would land.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landBranch } from "../../../src/serve/land-branch/merge.ts";
import { BRANCH, landCtx, landingGit } from "./landing-fixtures.ts";

const JOB = { id: "job-1", project: "aide", specFolder: "150-spec" };
const GONE = "/Users/nobody/aide-dashboard/checkouts/aide/code";

async function land(repos: { root: string; url: string }[], defaultBranch: (root: string) => Promise<string>) {
  const updates: Record<string, unknown>[] = [];
  const logged: string[] = [];
  const { ctx } = landCtx(landingGit().run, {
    queue: {
      get: () => undefined,
      update: (_id: string, patch: Record<string, unknown>) => void updates.push(patch),
      transition: (_id: string, event: string, patch?: Record<string, unknown>) => {
        updates.push({ event, ...(patch ?? {}) });
        return { ok: true };
      },
      branchesFor: () => [],
    },
    branchStatus: { defaultBranch, invalidate: () => {}, forgetOpenSpecBranch: () => {} },
  });
  const real = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    await landBranch(
      ctx as unknown as Parameters<typeof landBranch>[0],
      JOB as unknown as Parameters<typeof landBranch>[1],
      { branch: BRANCH },
      {
        step: "analyze" as const,
        repos,
        failedNote: (why: string) => ({ key: "landing.analyzeLandingFailed" as const, values: { why } }),
      } as unknown as Parameters<typeof landBranch>[3],
    );
  } finally {
    console.error = real;
  }
  return { updates, logged };
}

describe("a landing with a root that is no longer on disk", () => {
  test("skips the gone root, says so, and lands the one that is there", async () => {
    const here = mkdtempSync(join(tmpdir(), "aide-landing-root-"));
    const { updates, logged } = await land(
      [{ root: GONE, url: "" }, { root: here, url: "" }],
      async (root) => (root === here ? "master" : ""),
    );
    expect(logged.some((l) => l.includes(`skips ${GONE}`) && l.includes("no such directory"))).toBe(true);
    expect(JSON.stringify(updates)).not.toContain("landing.cannotWorkOutDefaultBranch");
    expect(JSON.stringify(updates)).not.toContain("landing-failed");
  });

  test("a root that exists but has no default branch is still the failure it was", async () => {
    const here = mkdtempSync(join(tmpdir(), "aide-landing-root-"));
    const { updates } = await land([{ root: here, url: "" }, { root: GONE, url: "" }], async () => "");
    expect(JSON.stringify(updates)).toContain("landing.cannotWorkOutDefaultBranch");
  });

  test("the only root being gone still fails the landing", async () => {
    const { updates } = await land([{ root: GONE, url: "" }], async () => "");
    expect(JSON.stringify(updates)).toContain("landing.cannotWorkOutDefaultBranch");
  });
});
