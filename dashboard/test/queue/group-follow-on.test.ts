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
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, modelChoices: { sonnet: {} } },
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
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {}, landStepBranch: async () => {},
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
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {}, landStepBranch: async () => {},
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

test("a Run-created group shares the first job's choices with the next member (A810 AC-8)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({
    project: "aide", name: "1-first", members: ["1-first", "2-next"], branch: "aide/group-1-first", sharedChoices: true,
  });
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({
    project: "aide", specFolder: "1-first", executionGroupId: group.id,
    steps: ["analyze", "implement"], model: { analyze: "sonnet", implement: "sonnet" },
  } as unknown as Job, "implement", { ok: true, terminalReason: "completed" });
  expect(store.list()[0]).toMatchObject({ specFolder: "2-next", model: { analyze: "sonnet", implement: "sonnet" } });
});

test("a completed Analyze-only member starts the next member (A810 AC-3, A810 AC-8)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({
    project: "aide", name: "1-first", members: ["1-first", "2-next"], branch: "aide/group-1-first", sharedChoices: true,
  });
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landArchivedSpec: async () => {}, landStepBranch: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze"] } as Job,
    "analyze", { ok: true, terminalReason: "completed" });
  expect(store.list()[0]).toMatchObject({ specFolder: "2-next", steps: ["analyze"] });
});

test("a group archive that completes leaves the group archiving and queues no member", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.update(group.id, { state: "archiving", currentMember: "1-first" });
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {},
    // The landing is still on its way: the group is read in the middle of it.
    landArchivedSpec: () => new Promise(() => {}),
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  void handle({ project: "aide", specFolder: "1-first", steps: ["archive"], executionGroupId: group.id } as Job, "archive", { ok: true, terminalReason: "completed" });
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.state).toBe("archiving");
});

test("an Analyze-only member with a legacy trailing Archive queues the next member", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = stepDoneHandler({
    store, machinerySpecsRoot: () => join(root, "specs"), specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landStepBranch: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: "group-1", steps: ["analyze", "archive"] } as Job,
    "analyze", { ok: true, terminalReason: "completed" });
  expect(store.list().map((job) => job.specFolder)).toEqual(["2-next"]);
});

test("a cancelled Archive landing leaves the group stopped", async () => {
  member("1-first", 1);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.update(group.id, { state: "archiving" });
  const queued = store.enqueue({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["archive"] });
  if (!queued.ok) throw new Error(queued.error);
  store.update(queued.job.id, { state: "done" });
  const job = store.get(queued.job.id)!;
  const handle = stepDoneHandler({
    store, machinerySpecsRoot: () => join(root, "specs"), specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {}, rereadSpecCaches: () => {},
    landArchivedSpec: async () => { store.update(job.id, { state: "cancelled" }); },
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle(job, "archive", { ok: true, terminalReason: "completed" });
  await Promise.resolve();
  expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
});

test("manual Start's per-member plan decides the next member's phases", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-release" });
  store.executionGroups.update(group.id, { state: "running", memberSteps: { "1-first": ["analyze"], "2-next": ["implement"] } });
  const handle = stepDoneHandler({ store, machinerySpecsRoot: () => join(root, "specs"), specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d, forgetSpecCaches: () => {}, rereadSpecCaches: () => {}, landStepBranch: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first", steps: ["analyze"], executionGroupId: group.id } as Job,
    "analyze", { ok: true, terminalReason: "completed" });
  expect(store.list()).toMatchObject([{ specFolder: "2-next", steps: ["implement"] }]);
});
