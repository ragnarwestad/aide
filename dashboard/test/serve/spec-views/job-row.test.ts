// Queue rows project the coordinator’s global waiting facts.

import { describe, expect, test } from "bun:test";
import { QueueStore } from "../../../src/queue/queue.ts";
import { validateWaitingArchives } from "../../../src/queue/waiting/jobs.ts";
import { AideRunStore } from "../../../src/queue/aide-run-store.ts";
import { jobRow } from "../../../src/serve/job-row.ts";

const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["a", "b", "c", "d"] } : null;

function makeStore(providers?: Record<string, { name: string; tool: "claude" | "codex" | "opencode" }>): QueueStore {
  return new QueueStore({
    mirrorPath: undefined,
    defaults: {
      timeoutSec: { default: 1200 },
      permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
      model: { implement: "opus", default: "sonnet" },
      ...(providers ? { providers, modelChoices: { opus: {}, sonnet: {}, codex: { tool: "codex" } } } : {}),
    },
    resolve,
  });
}

test("job rows include blocked entries and project the saved global order", async () => {
  const store = makeStore();
  const a = store.enqueue({ project: "aide", specFolder: "a", steps: ["implement"] });
  const b = store.enqueue({ project: "aide", specFolder: "b", steps: ["implement"] });
  if (!a.ok || !b.ok) throw new Error("enqueue failed");
  store.update(a.job.id, { error: "Waiting for a prerequisite", errorReason: "held-back" });
  const owner = store.waiting.open("test");
  store.waiting.save(owner, owner.entries.map(entry => entry.id).reverse());
  const ctx = { queue: store, store: new AideRunStore() };
  expect((await jobRow(ctx, store.get(a.job.id)!)).queuePosition).toMatchObject({ n: 2, total: 2, reason: "Waiting for a prerequisite" });
  expect((await jobRow(ctx, b.job)).queuePosition).toMatchObject({ n: 1, total: 2 });
});

// `Job.stepStartedAt`/`StepResult.startedAt` are the one link
// in the five-file thread that fails silently rather than loudly — a
// dropped optional field compiles fine and simply reads as "no start
// recorded" forever. Guarded here, independent of the math that
// consumes the fields once they arrive.
describe("jobRow() carries the per-step start stamps through", () => {
  test("Job.stepStartedAt and StepResult.startedAt survive the hop into QueueRowView/StepResultView", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const enq = store.enqueue({ project: "aide", specFolder: "a", steps: ["analyze", "implement"] });
    if (!enq.ok) throw new Error("enqueue failed");
    store.update(enq.job.id, {
      stepStartedAt: "2026-08-16T12:00:00Z",
      results: [
        {
          step: "analyze", ok: true, costUsd: 1, costMeasured: true,
          terminalReason: "completed", at: "2026-08-16T09:10:00Z",
          startedAt: "2026-08-16T09:00:00Z",
        },
      ],
    });
    const job = store.get(enq.job.id)!;
    const ctx = { queue: store, store: runStore };
    const row = await jobRow(ctx, job);
    expect(row.stepStartedAt).toBe("2026-08-16T12:00:00Z");
    expect(row.results?.[0]?.startedAt).toBe("2026-08-16T09:00:00Z");
  });
});

// Why `gh` opened no pull request is the step's own answer, and the phase's
// log says it: the row the page draws from has to carry it.
describe("jobRow()'s step results", () => {
  test("carry why no pull request was opened", async () => {
    const store = makeStore();
    const queued = store.enqueue({ project: "aide", specFolder: "a", steps: ["archive"] });
    if (!queued.ok) throw new Error("enqueue failed");
    store.update(queued.job.id, {
      results: [{ step: "archive", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", prError: "gh auth login required" }],
    });
    const row = await jobRow({ queue: store, store: new AideRunStore() }, store.get(queued.job.id)!);
    expect(row.results?.[0]?.prError).toBe("gh auth login required");
  });
});

// The review and the verification of an implement step ride on the step's
// result, each with its tokens as the one total the page shows.
describe("jobRow()'s side sessions", () => {
  test("a stored review and verification reach the row, with their tokens as a total (AC-1, AC-2)", async () => {
    const store = makeStore();
    const queued = store.enqueue({ project: "aide", specFolder: "a", steps: ["implement"] });
    if (!queued.ok) throw new Error("enqueue failed");
    const tokens = { input: 30, output: 700, cacheRead: 4000, cacheCreation: 200, total: 4930 };
    store.update(queued.job.id, {
      results: [{
        step: "implement", ok: true, costUsd: 0.35, costMeasured: true, terminalReason: "completed",
        review: { outcome: "completed", tool: "claude", durationSec: 41, costUsd: 0.05, tokens, transcript: { from: 1, to: 9 }, provider: { key: "work", name: "Claude Work" } },
        verify: { outcome: "timeout", tool: "codex" },
      }],
    });
    const row = await jobRow({ queue: store, store: new AideRunStore() }, store.get(queued.job.id)!);
    expect(row.results?.[0]?.review).toEqual({ outcome: "completed", tool: "claude", durationSec: 41, costUsd: 0.05, tokens: 4930, provider: { key: "work", name: "Claude Work" } });
    expect(row.results?.[0]?.verify).toEqual({ outcome: "timeout", tool: "codex" });
  });
});

// The provider a step runs on is worked out once here and handed to every
// surface as data: its name as it is now, and each result's as it was then.
describe("jobRow()'s provider", () => {
  test("the row names the current step's provider by its present name, and each result its own (AC-10)", async () => {
    const store = makeStore({ capra: { name: "Claude-Capra", tool: "claude" }, codex: { name: "Codex", tool: "codex" } });
    const made = store.enqueue({ project: "aide", specFolder: "a", steps: ["analyze", "implement"] });
    if (!made.ok) throw new Error("enqueue failed");
    store.update(made.job.id, {
      provider: { analyze: "codex", implement: "capra" },
      results: [{ step: "analyze", ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", provider: { key: "codex", name: "Old-Codex" } }],
      stepIndex: 1,
    });
    const row = await jobRow({ queue: store, store: new AideRunStore() }, store.get(made.job.id)!);
    expect(row.provider).toBe("Claude-Capra");
    expect(row.results?.[0]?.provider).toEqual({ key: "codex", name: "Old-Codex" });
  });

  test("a store with no provider names none, and neither does a deploy (AC-10)", async () => {
    const store = makeStore();
    const made = store.enqueue({ project: "aide", specFolder: "a", steps: ["implement"] });
    if (!made.ok) throw new Error("enqueue failed");
    const row = await jobRow({ queue: store, store: new AideRunStore() }, store.get(made.job.id)!);
    expect(row.provider).toBeUndefined();
  });
});

test("Land rows carry their branch and push boundary to the page controls", async () => {
  const queue = makeStore();
  const made = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!made.ok) throw new Error(made.error);
  const job = queue.update(made.job.id, { landPushStarted: true })!;
  expect(await jobRow({ queue, store: new AideRunStore() }, job)).toMatchObject({ branch: "topic", landPushStarted: true });
});

test("an active process retains its running fact without a waiting position (AC-1)", async () => {
  const queue = makeStore();
  const made = queue.enqueue({ project: "aide", specFolder: "a", steps: ["analyze", "implement"] });
  if (!made.ok) throw new Error(made.error);
  const job = queue.update(made.job.id, { state: "running" })!;
  const row = await jobRow({ queue, store: new AideRunStore() }, job);
  expect(row.state).toBe("running");
  expect(row.queuePosition).toBeUndefined();
});

test("future phases have no waiting position while the current process runs (AC-1)", async () => {
  const queue = makeStore();
  const made = queue.enqueue({ project: "aide", specFolder: "a", steps: ["analyze", "implement"] });
  if (!made.ok) throw new Error(made.error);
  const job = queue.update(made.job.id, { state: "running" })!;
  const view = await jobRow({ queue, store: new AideRunStore() }, job);
  const { phasesFor } = await import("../../../src/render/pages/specs-list/data-model/phases.ts");
  const { wordPhase } = await import("../../../src/render/ui/job-state/word-phase.ts");
  const phase = phasesFor([view], undefined).find(phase => phase.step === "implement")!;
  const word = wordPhase(false, undefined, phase.attempts[0], { step: "implement", waiting: phase.waiting });
  expect(phase.attempts).toEqual([]);
  expect(word.waiting).toBeUndefined();
  expect(word.badge).toBeUndefined();
  expect(view.state).toBe("running");
  expect(view.queuePosition).toBeUndefined();
});
test("a merge waiter has a position while its successor remains unattempted (AC-1)", async () => {
  const queue = makeStore();
  const made = queue.enqueue({ project: "aide", specFolder: "a", steps: ["analyze", "implement"] });
  if (!made.ok) throw new Error(made.error);
  const job = queue.update(made.job.id, { state: "queued", stepIndex: 1, landing: true,
    results: [{ step: "analyze", ok: true, costUsd: 0, costMeasured: false, terminalReason: "completed" }] })!;
  queue.waiting.pending.set("merge:test:analyze:repo", { id: "merge:test:analyze:repo", jobId: job.id, project: "aide", label: "a", operation: "analyze", reason: "Repository busy" });
  const view = await jobRow({ queue, store: new AideRunStore() }, job);
  const { phasesFor } = await import("../../../src/render/pages/specs-list/data-model/phases.ts");
  const { wordPhase } = await import("../../../src/render/ui/job-state/word-phase.ts");
  const words = phasesFor([view], undefined).filter(p => ["analyze", "implement"].includes(p.step))
    .map(p => wordPhase(false, undefined, p.attempts[0], { step: p.step, waiting: p.waiting }));
  expect(words[0]!.waiting).toMatchObject({ operation: "analyze", reason: "Repository busy", n: 1, total: 1 });
  expect(words[1]!.waiting).toBeUndefined();
  expect(words[1]!.badge).toBeUndefined();
});

test("an admitted group Archive projects its stable identity to the job row (AC-4)", async () => {
  const queue = makeStore();
  const group = queue.executionGroups.create({ project: "aide", name: "Release", members: ["a", "b"], branch: "aide/release" });
  queue.executionGroups.update(group.id, { state: "waiting-acceptance", completedMembers: ["a", "b"] });
  const made = queue.enqueue({ project: "aide", specFolder: "a", steps: ["archive"], executionGroupId: group.id });
  if (!made.ok) throw new Error(made.error);
  validateWaitingArchives(queue);
  const row = await jobRow({ queue, store: new AideRunStore() }, made.job);
  expect(row.queuePosition).toMatchObject({ id: `group:${group.id}:archive`, operation: "archive", n: 1, total: 1 });
});

test("a cancelled Land row points at its later successful attempt", async () => {
  const queue = makeStore();
  const old = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!old.ok) throw new Error(old.error);
  queue.update(old.job.id, { state: "cancelled" });
  const next = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!next.ok) throw new Error(next.error);
  queue.update(next.job.id, { state: "done" });
  const row = await jobRow({ queue, store: new AideRunStore() }, queue.get(old.job.id)!);
  expect(row.landSuccessor).toEqual({ id: next.job.id, landed: true });
  expect(row.state).toBe("cancelled");
});

test("merge rows resolve the destination and forward current numeric activity (AC-2, AC-5, AC-6)", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "merge-row-"));
  try {
    const file = join(dir, "job.land.stream.jsonl");
    writeFileSync(file, "");
    const queue = makeStore();
    const queued = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
    if (!queued.ok) throw new Error(queued.error);
    const ctx = { queue, store: new AideRunStore(), mergeTarget: async () => "trunk" };
    for (const [task, activity] of [[1, "merging"], [2, "testing"], [3, "running"], [4, "running"]] as const) {
      writeFileSync(file.replace(".stream.jsonl", ".run.log"), `aide-run-spec 12:00:00 +0s --- Step ${task} of 4: Task — started\n`);
      queue.update(queued.job.id, { state: "running", streamFile: file });
      expect(await jobRow(ctx, queue.get(queued.job.id)!)).toMatchObject({ mergeTarget: "trunk", mergeActivity: activity });
    }
    expect((await jobRow({ ...ctx, mergeTarget: async () => { throw new Error("unavailable"); } }, queue.get(queued.job.id)!)).mergeTarget).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent merge rows share targets and subsequent refreshes retry failed lookups (AC-2)", async () => {
  const { setupLand } = await import("../../../src/serve/setup/land.ts");
  const { QueueStore } = await import("../../../src/queue/queue.ts");
  const { AideRunStore } = await import("../../../src/queue/aide-run-store.ts");
  const queue = new QueueStore({ mirrorPath: undefined, defaults: { timeoutSec: { default: 60 }, permissionMode: {}, model: {} }, resolve: () => ({ specFolders: [] }) });
  let calls = 0;
  let target: string | null = null;
  const rows = setupLand({} as never, {
    queue, store: new AideRunStore(), machineryProjectDir: (project: string) => project,
    branchStatus: { defaultBranch: async () => { calls++; await Promise.resolve(); if (!target) throw new Error("unavailable"); return target; } },
  } as never);
  const own = (id: string, project = "aide") => ({ id, project, specFolder: "land", steps: ["land"], stepIndex: 0, state: "done", results: [], timeoutSec: {}, permissionMode: {}, model: {} }) as never;
  const first = await Promise.all([rows.jobRow(own("a")), rows.jobRow(own("b")), rows.jobRow(own("c", "other"))]);
  expect(calls).toBe(2);
  expect(first.map(row => row.mergeTarget)).toEqual([undefined, undefined, undefined]);
  target = "trunk";
  expect((await rows.jobRow(own("a"))).mergeTarget).toBe("trunk");
  expect(calls).toBe(3);
  target = "develop";
  expect((await rows.jobRow(own("a"))).mergeTarget).toBe("develop");
  expect(calls).toBe(4);
});

test("window selection keeps pending merges in the Queued filter (AC-3, AC-7)", async () => {
  const { summaryJob } = await import("../../../src/serve/list-window/index.ts");
  const { jobFacts, jobsViewRows } = await import("../../../src/render/pages/jobs-page/view.ts");
  const queue = makeStore();
  const made = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
  if (!made.ok) throw new Error(made.error);
  const own = queue.update(made.job.id, { state: "done", landing: true })!;
  queue.waiting.pending.set("merge:waiting", { id: "merge:waiting", jobId: own.id, project: "aide", label: "Merge", operation: "land", reason: "Repository busy" });
  const summary = summaryJob(own, queue.waiting.snapshot().entries);
  const facts = jobFacts(summary, Date.now());
  expect(jobsViewRows([{ facts, place: { band: 0, changedAt: 0 } }], { state: "queued" })).toHaveLength(1);
});
