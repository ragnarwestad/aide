// A job that has just run `create` is queued for its next step while the
// board's cached spec scan does not have the new spec yet. That is not
// "names no dependency": read that way, the analyze started into
// `aide-run-spec`'s refusal and the job failed instead of waiting.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedDependencies } from "../../../src/serve/schedules/blocked.ts";
import { dependencyHold } from "../../../src/queue/runner/dependency-hold.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function projectsRoot(): { root: string; specs: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-after-create-"));
  dirs.push(dir);
  const root = join(dir, "root");
  const specs = join(root, "aide", "specs");
  mkdirSync(join(root, "aide", ".aide"), { recursive: true });
  writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(specs, "80-dependency"), { recursive: true });
  writeFileSync(join(specs, "80-dependency", "1-description.md"), "# 80-dependency\n");
  mkdirSync(join(specs, "81-dependent"), { recursive: true });
  writeFileSync(
    join(specs, "81-dependent", "1-description.md"),
    "# 81-dependent\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n",
  );
  return { root, specs };
}

/** The queue right after `create`: the job is queued for `analyze`, and
 *  the cached scan does not hold the new spec yet. */
function context(root: string, specs: string, now: () => number, jobId: string) {
  return {
    projectRoot: root,
    queue: {
      list: () => [{ id: jobId, state: "queued", project: "aide", specFolder: "81-dependent", steps: ["create", "analyze"], stepIndex: 1 }],
    },
    targets: () => [{ project: "aide", specFolder: "80-dependency", dependsOn: [] }],
    readScan: () => undefined,
    readBranchFileSteps: () => ({ peekFileSteps: () => ({ steps: undefined, checkedAt: null, stale: false }) }),
    specRoots: () => [specs],
    branchStatus: { archivedOnOrigin: async () => false },
    now,
  } as unknown as Parameters<typeof blockedDependencies>[0];
}

describe("a job queued right after create", () => {
  test("is held for the dependency its new spec names", async () => {
    const { root, specs } = projectsRoot();
    const holds = await blockedDependencies(context(root, specs, () => 1_000_000, "job-on-disk"));
    expect(dependencyHold(holds, "job-on-disk")).toBe("80-dependency");
  });
});
