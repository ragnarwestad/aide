import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionGroupStore, groupBranchForJob } from "../../../src/queue/execution-groups";
import { groupBranch } from "../../../src/project/spec-names.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function specsRoot(members: { folder: string; position: number; archived?: boolean }[]): string {
  const root = mkdtempSync(join(tmpdir(), "aide-group-branch-"));
  dirs.push(root);
  for (const { folder, position, archived } of members) {
    const dir = join(root, ...(archived ? ["archive"] : []), folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1-description.md"), `# X\n\n## Tracking info\n\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`);
  }
  return root;
}

test("a group's job runs on the branch its record names, after its first member is archived", () => {
  const root = specsRoot([{ folder: "1-first", position: 1, archived: true }, { folder: "2-next", position: 2 }]);
  const groups = new ExecutionGroupStore();
  const group = groups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first-release" });
  expect(groupBranchForJob(groups, root, { project: "aide", specFolder: "2-next", executionGroupId: group.id })).toBe("aide/group-1-first-release");
});

test("a grouped spec's job outside any record runs on the branch named for its first active member", () => {
  const root = specsRoot([{ folder: "1-first", position: 1 }, { folder: "2-next", position: 2 }]);
  expect(groupBranchForJob(new ExecutionGroupStore(), root, { project: "aide", specFolder: "2-next" })).toBe(groupBranch("1-first", "Release"));
});
