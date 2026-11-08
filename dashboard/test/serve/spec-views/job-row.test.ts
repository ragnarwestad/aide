// JobRow()'s queuePosition must come off the same
// queuePriorityOrder() the runner picks from.

import { describe, expect, test } from "bun:test";
import { QueueStore, queuePriorityOrder } from "../../../src/queue/queue.ts";
import { AideRunStore } from "../../../src/queue/aide-run-store.ts";
import { jobRow } from "../../../src/serve/job-row.ts";

const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["a", "b", "c", "d"] } : null;

function makeStore(
  providers?: Record<
    string,
    { name: string; tool: "claude" | "codex" | "opencode" }
  >,
): QueueStore {
  return new QueueStore({
    mirrorPath: undefined,
    defaults: {
      timeoutSec: { default: 1200 },
      permissionMode: {
        implement: "bypassPermissions",
        default: "acceptEdits",
      },
      model: { implement: "opus", default: "sonnet" },
      ...(providers
        ? {
            providers,
            modelChoices: { opus: {}, sonnet: {}, codex: { tool: "codex" } },
          }
        : {}),
    },
    resolve,
  });
}

describe("jobRow()'s queuePosition", () => {
  test("matches queuePriorityOrder()'s own order for a mix of quick and slow queued jobs", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const analyze = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["analyze"],
    });
    const implement = store.enqueue({
      project: "aide",
      specFolder: "b",
      steps: ["implement"],
    });
    const archive = store.enqueue({
      project: "aide",
      specFolder: "c",
      steps: ["archive"],
    });
    if (!analyze.ok || !implement.ok || !archive.ok)
      throw new Error("enqueue failed");

    const ctx = { queue: store, store: runStore };
    const rows = await Promise.all(
      [analyze.job, implement.job, archive.job].map((job) => jobRow(ctx, job)),
    );

    const expectedOrder = queuePriorityOrder(
      [...store.list()].reverse().filter((j) => j.state === "queued"),
    );

    for (const row of rows) {
      const job = [analyze.job, implement.job, archive.job].find(
        (j) => j.id === row.id,
      )!;
      const expectedN = expectedOrder.findIndex((j) => j.id === job.id) + 1;
      expect(row.queuePosition?.n).toBe(expectedN);
      expect(row.queuePosition?.total).toBe(expectedOrder.length);
    }

    // archive is the only quick step here, so it must be first.
    const archiveRow = rows.find((r) => r.id === archive.job.id)!;
    expect(archiveRow.queuePosition?.n).toBe(1);
  });
});

// A job the runner has held back (`errorReason: "held-back"`)
// is not competing for a slot at all, so it gets no place, and it must
// not be counted in any OTHER queued job's total either.
describe("jobRow()'s queuePosition excludes held-back jobs", () => {
  test("a held-back job gets no queuePosition, and the genuinely-queued job's total excludes it", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const held = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["implement"],
    });
    const waiting = store.enqueue({
      project: "aide",
      specFolder: "b",
      steps: ["implement"],
    });
    if (!held.ok || !waiting.ok) throw new Error("enqueue failed");
    store.update(held.job.id, {
      error: "held back: depends on 80-x",
      errorReason: "held-back",
    });

    const ctx = { queue: store, store: runStore };
    const heldJob = store.get(held.job.id)!;
    const waitingJob = store.get(waiting.job.id)!;
    const heldRow = await jobRow(ctx, heldJob);
    const waitingRow = await jobRow(ctx, waitingJob);

    expect(heldRow.queuePosition).toBeUndefined();
    expect(waitingRow.queuePosition?.n).toBe(1);
    expect(waitingRow.queuePosition?.total).toBe(1);
  });

  test("same, with the held-back job sorting AFTER the genuinely-queued one", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const waiting = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["archive"],
    });
    const held = store.enqueue({
      project: "aide",
      specFolder: "b",
      steps: ["implement"],
    });
    if (!waiting.ok || !held.ok) throw new Error("enqueue failed");
    store.update(held.job.id, {
      error: "held back: depends on 80-x",
      errorReason: "held-back",
    });

    const ctx = { queue: store, store: runStore };
    const heldJob = store.get(held.job.id)!;
    const waitingJob = store.get(waiting.job.id)!;
    const heldRow = await jobRow(ctx, heldJob);
    const waitingRow = await jobRow(ctx, waitingJob);

    expect(heldRow.queuePosition).toBeUndefined();
    expect(waitingRow.queuePosition?.n).toBe(1);
    expect(waitingRow.queuePosition?.total).toBe(1);
  });
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
    const enq = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["analyze", "implement"],
    });
    if (!enq.ok) throw new Error("enqueue failed");
    store.update(enq.job.id, {
      stepStartedAt: "2026-08-16T12:00:00Z",
      results: [
        {
          step: "analyze",
          ok: true,
          costUsd: 1,
          costMeasured: true,
          terminalReason: "completed",
          at: "2026-08-16T09:10:00Z",
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
    const queued = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["archive"],
    });
    if (!queued.ok) throw new Error("enqueue failed");
    store.update(queued.job.id, {
      results: [
        {
          step: "archive",
          ok: true,
          costUsd: 0,
          costMeasured: true,
          terminalReason: "completed",
          prError: "gh auth login required",
        },
      ],
    });
    const row = await jobRow(
      { queue: store, store: new AideRunStore() },
      store.get(queued.job.id)!,
    );
    expect(row.results?.[0]?.prError).toBe("gh auth login required");
  });
});

// The review and the verification of an implement step ride on the step's
// result, each with its tokens as the one total the page shows.
describe("jobRow()'s side sessions", () => {
  test("a stored review and verification reach the row, with their tokens as a total (AC-1, AC-2)", async () => {
    const store = makeStore();
    const queued = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["implement"],
    });
    if (!queued.ok) throw new Error("enqueue failed");
    const tokens = {
      input: 30,
      output: 700,
      cacheRead: 4000,
      cacheCreation: 200,
      total: 4930,
    };
    store.update(queued.job.id, {
      results: [
        {
          step: "implement",
          ok: true,
          costUsd: 0.35,
          costMeasured: true,
          terminalReason: "completed",
          review: {
            outcome: "completed",
            tool: "claude",
            durationSec: 41,
            costUsd: 0.05,
            tokens,
            transcript: { from: 1, to: 9 },
          },
          verify: { outcome: "timeout", tool: "codex" },
        },
      ],
    });
    const row = await jobRow(
      { queue: store, store: new AideRunStore() },
      store.get(queued.job.id)!,
    );
    expect(row.results?.[0]?.review).toEqual({
      outcome: "completed",
      tool: "claude",
      durationSec: 41,
      costUsd: 0.05,
      tokens: 4930,
    });
    expect(row.results?.[0]?.verify).toEqual({
      outcome: "timeout",
      tool: "codex",
    });
  });
});

// The provider a step runs on is worked out once here and handed to every
// surface as data: its name as it is now, and each result's as it was then.
describe("jobRow()'s provider", () => {
  test("the row names the current step's provider by its present name, and each result its own (AC-10)", async () => {
    const store = makeStore({
      capra: { name: "Claude-Capra", tool: "claude" },
      codex: { name: "Codex", tool: "codex" },
    });
    const made = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["analyze", "implement"],
    });
    if (!made.ok) throw new Error("enqueue failed");
    store.update(made.job.id, {
      provider: { analyze: "codex", implement: "capra" },
      results: [
        {
          step: "analyze",
          ok: true,
          costUsd: 0,
          costMeasured: true,
          terminalReason: "completed",
          provider: { key: "codex", name: "Old-Codex" },
        },
      ],
      stepIndex: 1,
    });
    const row = await jobRow(
      { queue: store, store: new AideRunStore() },
      store.get(made.job.id)!,
    );
    expect(row.provider).toBe("Claude-Capra");
    expect(row.results?.[0]?.provider).toEqual({
      key: "codex",
      name: "Old-Codex",
    });
  });

  test("a store with no provider names none, and neither does a deploy (AC-10)", async () => {
    const store = makeStore();
    const made = store.enqueue({
      project: "aide",
      specFolder: "a",
      steps: ["implement"],
    });
    if (!made.ok) throw new Error("enqueue failed");
    const row = await jobRow(
      { queue: store, store: new AideRunStore() },
      store.get(made.job.id)!,
    );
    expect(row.provider).toBeUndefined();
  });
});
