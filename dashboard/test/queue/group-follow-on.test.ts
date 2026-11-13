import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job } from "../../src/queue/queue.ts";
import { stepDoneHandler } from "../../src/serve/runner-setup.ts";

let root: string;
let store: QueueStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aide-group-follow-on-"));
  store = new QueueStore({
    mirrorPath: join(root, "queue.json"),
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: ["1-first", "2-next"] }),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const member = (folder: string, position: number, archived = false) => {
  const dir = join(root, "specs", ...(archived ? ["archive"] : []), folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1-description.md"), `# X\n\n## Tracking info\n\n- **Created:** now\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`);
  writeFileSync(join(dir, "4-status.md"), "# Status\n");
};

test("a verified Implement queues exactly the next group member (AC-3)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first" } as Job, "implement", {
    ok: true,
    terminalReason: "completed",
    branchUrls: [{ root: "/specs", url: "https://example.test/specs" }],
  });
  await Promise.resolve();
  expect(store.list().map((job) => [job.specFolder, job.steps])).toEqual([["2-next", ["analyze", "implement"]]]);
});

test("a follow-on keeps the execution identity and shared branch (AC-5, AC-10)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: "group-1", groupBranch: "group/1-first" } as Job, "implement", {
    ok: true,
    terminalReason: "completed",
  });
  await Promise.resolve();
  expect(store.list()[0]).toMatchObject({ executionGroupId: "group-1" });
});

test("a red Implement does not queue the next group member (AC-3)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first" } as Job, "implement", { ok: false, terminalReason: "tests-red" });
  expect(store.list()).toHaveLength(0);
});

test("the last Implement leaves the execution waiting for Archive", async () => {
  member("1-first", 1);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "aide/group-1-first" });
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "implement", { ok: true, terminalReason: "completed" });
  expect(store.executionGroups.get(group.id)?.state).toBe("waiting-acceptance");
});

test("a stopped execution does not queue its next member (AC-7, AC-13, AC-15)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.stop(group.id);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "implement", { ok: true, terminalReason: "completed" });
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
});

test("an archive the runner's check stopped hands the group back to wait for Archive", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "archive", {
    ok: true,
    terminalReason: "not-implemented-yet",
  });
  await Promise.resolve();
  expect(store.executionGroups.get(group.id)?.state).toBe("waiting-acceptance");
});

test("the next member runs on the models picked on its own row", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const picking = new QueueStore({
    mirrorPath: join(root, "picking.json"),
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, modelChoices: { sonnet: {}, fable: {} } },
    resolve: () => ({ specFolders: ["1-first", "2-next"] }),
  });
  picking.pendingModels["aide/2-next"] = { analyze: "fable", implement: "fable" };
  const handle = stepDoneHandler({
    store: picking,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", model: { analyze: "sonnet", implement: "sonnet" } } as unknown as Job, "implement", { ok: true, terminalReason: "completed" });
  await Promise.resolve();
  expect(picking.list()[0]).toMatchObject({ specFolder: "2-next", model: { analyze: "fable", implement: "fable" } });
});
