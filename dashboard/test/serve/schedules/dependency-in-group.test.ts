// A member of an execution group waits for a dependency in the same group
// only until that dependency has finished Implement; a dependency outside
// the group still has to be archived.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedDependencies } from "../../../src/serve/schedules/blocked.ts";

/** Temp directories this suite makes for itself. */
const ownDirs: string[] = [];

afterEach(() => {
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

describe("a dependency inside an execution group", () => {
  const queued = { id: "job-group", state: "queued", project: "aide", specFolder: "81-dependent", steps: ["analyze"], stepIndex: 0 };

  function groupRoot(dependency = "80-dependency") {
    const dir = mkdtempSync(join(tmpdir(), "aide-group-dependency-"));
    ownDirs.push(dir);
    const root = join(dir, "root");
    const specs = join(root, "aide", "specs");
    mkdirSync(join(root, "aide", ".aide"), { recursive: true });
    writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
    for (const [folder, tracking] of [
      ["79-outside", ""],
      ["80-dependency", "- **Group:** `Work together`\n- **Group position:** 1\n"],
      ["81-dependent", `- **Depends on:** \`${dependency}\`\n- **Group:** \`Work together\`\n- **Group position:** 2\n`],
    ]) {
      mkdirSync(join(specs, folder), { recursive: true });
      writeFileSync(join(specs, folder, "1-description.md"), `# ${folder}\n\n## Tracking info\n\n${tracking}`);
    }
    return { root, specs };
  }

  function groupContext(root: string, specs: string, implemented: boolean, archivedCalls: string[]) {
    return {
      projectRoot: root,
      queue: { list: () => [queued] },
      targets: () => [{ project: "aide", specFolder: "81-dependent", dependsOn: ["80-dependency"] }],
      readScan: () => undefined,
      readBranchFileSteps: () => ({
        peekFileSteps: (_dir: string, folder: string) => ({
          steps: folder === "80-dependency" ? { stateSteps: implemented ? ["implement"] : [], proseSteps: [] } : undefined,
          checkedAt: 1,
          stale: false,
        }),
      }),
      specRoots: () => [specs],
      branchStatus: { archivedOnOrigin: async (_root: string, folder: string) => {
        archivedCalls.push(folder);
        return false;
      } },
    } as unknown as Parameters<typeof blockedDependencies>[0];
  }

  test("releases a member after its earlier dependency finished Implement (AC-3)", async () => {
    const { root, specs } = groupRoot();
    const archivedCalls: string[] = [];
    const holds = await blockedDependencies(groupContext(root, specs, true, archivedCalls));
    expect(holds.get("job-group")).toBeUndefined();
    expect(archivedCalls).not.toContain("80-dependency");
  });

  test("holds a member until its earlier dependency finished Implement (AC-3)", async () => {
    const { root, specs } = groupRoot();
    const holds = await blockedDependencies(groupContext(root, specs, false, []));
    expect(holds.get("job-group")).toBe("80-dependency");
  });

  test("holds a member until a dependency outside the group is archived (AC-4)", async () => {
    const { root, specs } = groupRoot("79-outside");
    const archivedCalls: string[] = [];
    const ctx = groupContext(root, specs, true, archivedCalls);
    ctx.targets = () => [{ project: "aide", specFolder: "81-dependent", dependsOn: ["79-outside"] }];
    const holds = await blockedDependencies(ctx);
    expect(holds.get("job-group")).toBe("79-outside");
    expect(archivedCalls).toContain("79-outside");
  });
});
