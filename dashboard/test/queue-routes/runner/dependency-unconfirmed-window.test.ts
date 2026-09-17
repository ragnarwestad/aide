// How long a job waits on a dependency origin cannot be asked about.
// Held while the answer is missing, so a fetch that fails for a moment
// does not release the job into the script's refusal; released after
// `UNCONFIRMED_HOLD_MS`, so an origin that stays unreachable does not
// park the job for good (spec 351).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNCONFIRMED_HOLD_MS, blockedDependencies } from "../../../src/serve/schedules/blocked.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function projectsRoot(): { root: string; specs: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-unconfirmed-"));
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

function context(root: string, specs: string, answer: () => boolean | null, now: () => number, jobId = "job-1") {
  return {
    projectRoot: root,
    queue: { list: () => [{ id: jobId, state: "queued", project: "aide", specFolder: "81-dependent", steps: ["implement"], stepIndex: 0 }] },
    targets: () => [{ project: "aide", specFolder: "81-dependent", dependsOn: ["80-dependency"] }],
    specRoots: () => [specs],
    branchStatus: { archivedOnOrigin: async () => answer() },
    now,
  } as unknown as Parameters<typeof blockedDependencies>[0];
}

describe("a dependency origin cannot answer for", () => {
  test("holds the job, and still holds it just inside the window", async () => {
    const { root, specs } = projectsRoot();
    let clock = 1_000_000;
    const ctx = context(root, specs, () => null, () => clock, "job-window");
    expect((await blockedDependencies(ctx)).get("job-window")).toBe("80-dependency");
    clock += UNCONFIRMED_HOLD_MS - 1;
    expect((await blockedDependencies(ctx)).has("job-window")).toBe(true);
  });

  test("releases the job once the window has passed with no answer", async () => {
    const { root, specs } = projectsRoot();
    let clock = 2_000_000;
    const ctx = context(root, specs, () => null, () => clock, "job-release");
    await blockedDependencies(ctx);
    clock += UNCONFIRMED_HOLD_MS;
    expect((await blockedDependencies(ctx)).has("job-release")).toBe(false);
  });

  test("an answer in between starts the wait over", async () => {
    const { root, specs } = projectsRoot();
    let clock = 3_000_000;
    let answer: boolean | null = null;
    const ctx = context(root, specs, () => answer, () => clock, "job-reset");
    await blockedDependencies(ctx);
    clock += UNCONFIRMED_HOLD_MS - 1;
    answer = false;
    expect((await blockedDependencies(ctx)).has("job-reset")).toBe(true);
    answer = null;
    clock += UNCONFIRMED_HOLD_MS - 1;
    expect((await blockedDependencies(ctx)).has("job-reset")).toBe(true);
  });
});
