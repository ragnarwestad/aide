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

/** A step-done handler on this file's store and specs root; `deps` adds or replaces what a test needs. */
function handler(deps: Record<string, unknown> = {}) {
  return stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    ...deps,
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
}

test("a verified Implement queues exactly the next group member (AC-3)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = handler({ landArchivedSpec: async () => {} });
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
  const handle = handler({ landArchivedSpec: async () => {} });
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
  const handle = handler();
  await handle({ project: "aide", specFolder: "1-first" } as Job, "implement", { ok: false, terminalReason: "tests-red" });
  expect(store.list()).toHaveLength(0);
});

test("the last Implement leaves the execution waiting for Archive", async () => {
  member("1-first", 1);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first"], branch: "aide/group-1-first" });
  const handle = handler({ landArchivedSpec: async () => {}, landStepBranch: async () => {} });
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "implement", { ok: true, terminalReason: "completed" });
  expect(store.executionGroups.get(group.id)?.state).toBe("waiting-acceptance");
});

test("a stopped execution does not queue its next member (AC-7, AC-13, AC-15)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.stop(group.id);
  const handle = handler({ landArchivedSpec: async () => {}, landStepBranch: async () => {} });
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "implement", { ok: true, terminalReason: "completed" });
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
});

test("an archive the runner's check stopped hands the group back to wait for Archive", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const handle = handler();
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
  const handle = handler({ store: picking, landArchivedSpec: async () => {} });
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
  const handle = handler({ landArchivedSpec: async () => {} });
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
  const handle = handler({ landArchivedSpec: async () => {}, landStepBranch: async () => {} });
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze"] } as Job,
    "analyze", { ok: true, terminalReason: "completed" });
  expect(store.list()[0]).toMatchObject({ specFolder: "2-next", steps: ["analyze"] });
});

test("a group archive that completes leaves the group archiving and queues no member", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.update(group.id, { state: "archiving", currentMember: "1-first" });
  const handle = handler({
    // The landing is still on its way: the group is read in the middle of it.
    landArchivedSpec: () => new Promise(() => {}),
  });
  void handle({ project: "aide", specFolder: "1-first", steps: ["archive"], executionGroupId: group.id } as Job, "archive", { ok: true, terminalReason: "completed" });
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.state).toBe("archiving");
});

test("an Analyze-only member with a legacy trailing Archive queues the next member", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const handle = handler({ landStepBranch: async () => {} });
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
  const handle = handler({ landArchivedSpec: async () => { store.update(job.id, { state: "cancelled" }); } });
  await handle(job, "archive", { ok: true, terminalReason: "completed" });
  await Promise.resolve();
  expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
});

/** A handler whose board's first specs sweep the test finishes by hand. */
function handlerAwaitingSweep(scanned: boolean) {
  const waiting: (() => void)[] = [];
  const handle = handler({
    landArchivedSpec: async () => {}, landStepBranch: async () => {},
    whenSpecsScanned: (next: () => void) => { if (scanned) next(); else waiting.push(next); },
  });
  return { handle, finishSweep: () => { for (const next of waiting.splice(0)) next(); } };
}

test("before the first specs sweep, the next member is queued only once the sweep has finished (AC-2)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const { handle, finishSweep } = handlerAwaitingSweep(false);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze", "implement"] } as unknown as Job,
    "implement", { ok: true, terminalReason: "completed" });
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.completedMembers).toEqual(["1-first"]);
  // The member's job has ended meanwhile, which leaves the group idle.
  store.executionGroups.update(group.id, { state: "stopped" });
  finishSweep();
  expect(store.list().map((job) => [job.specFolder, job.executionGroupId])).toEqual([["2-next", group.id]]);
  expect(store.executionGroups.get(group.id)?.state).toBe("queued");
});

test("Stop while the next member waits for the first specs sweep cancels the move (AC-2)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const { handle, finishSweep } = handlerAwaitingSweep(false);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze", "implement"] } as unknown as Job,
    "implement", { ok: true, terminalReason: "completed" });
  store.executionGroups.stop(group.id, true);
  finishSweep();
  expect(store.list()).toHaveLength(0);
  expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
});

test("after the first specs sweep, the next member is queued at once on the finished job's steps (AC-5)", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const { handle } = handlerAwaitingSweep(true);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze", "implement"] } as unknown as Job,
    "implement", { ok: true, terminalReason: "completed" });
  expect(store.list().map((job) => [job.specFolder, job.steps])).toEqual([["2-next", ["analyze", "implement"]]]);
});

test("before the first specs sweep, a last member's Implement leaves the group waiting for Archive once it has finished (AC-2)", async () => {
  member("1-first", 1);
  const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first"], branch: "aide/group-1-first" });
  store.executionGroups.start(group.id);
  const { handle, finishSweep } = handlerAwaitingSweep(false);
  await handle({ project: "aide", specFolder: "1-first", executionGroupId: group.id } as Job, "implement", { ok: true, terminalReason: "completed" });
  store.executionGroups.update(group.id, { state: "stopped" });
  finishSweep();
  expect(store.executionGroups.get(group.id)?.state).toBe("waiting-acceptance");
});

test("manual Start's per-member plan decides the next member's phases", async () => {
  member("1-first", 1);
  member("2-next", 2);
  const group = store.executionGroups.prepare({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-release" });
  store.executionGroups.update(group.id, { state: "running", memberSteps: { "1-first": ["analyze"], "2-next": ["implement"] } });
  const handle = handler({ landStepBranch: async () => {} });
  await handle({ project: "aide", specFolder: "1-first", steps: ["analyze"], executionGroupId: group.id } as Job,
    "analyze", { ok: true, terminalReason: "completed" });
  expect(store.list()).toMatchObject([{ specFolder: "2-next", steps: ["implement"] }]);
});

for (const ending of ["success", "rejected", "recorded-failure", "cancelled", "stopped"] as const)
  test(`Analyze-only continuation waits for landing: ${ending} (AC-3)`, async () => {
    member("1-first", 1); member("2-next", 2);
    const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-release" });
    const made = store.enqueue({ project: "aide", specFolder: "1-first", executionGroupId: group.id, steps: ["analyze"] });
    if (!made.ok) throw new Error(made.error);
    store.update(made.job.id, { state: "running", landing: true });
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const landing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const handle = handler({ landStepBranch: () => landing });
    const finishing = Promise.resolve(handle(store.get(made.job.id)!, "analyze", { ok: true, terminalReason: "completed" }));
    expect(store.list().map(j => j.specFolder)).toEqual(["1-first"]);
    expect(store.executionGroups.get(group.id)?.completedMembers).toEqual([]);
    store.update(made.job.id, { state: "done", landing: true });
    const unrelated = store.enqueue({ project: "other-project", specFolder: "1-first", steps: ["analyze"] });
    if (!unrelated.ok) throw new Error(unrelated.error);
    if (ending === "recorded-failure") store.update(made.job.id, { landingError: "tests failed" });
    if (ending === "cancelled") store.update(made.job.id, { state: "cancelled" });
    if (ending === "stopped") store.executionGroups.stop(group.id, true);
    if (ending === "rejected") reject(new Error("merge failed")); else resolve();
    await finishing.catch(() => {});
    expect(store.list().filter(j => j.specFolder === "2-next")).toHaveLength(ending === "success" ? 1 : 0);
    if (ending === "success") expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([unrelated.job.id, store.list()[0]!.id]);
  });
