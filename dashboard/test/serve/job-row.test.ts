// Spec 353: jobRow()'s queuePosition must come off the same
// queuePriorityOrder() the runner picks from (REQ-6), and the full
// jobRow() -> specStateChip() composition must render it (REQ-4).

import { describe, expect, test } from "bun:test";
import { QueueStore, queuePriorityOrder } from "../../src/queue/queue.ts";
import { AideRunStore } from "../../src/queue/aide-run-store.ts";
import { jobRow } from "../../src/serve/job-row.ts";
import { specStateChip } from "../../src/render/ui/job-state.ts";

const resolve = (project: string) =>
  project === "aide" ? { specFolders: ["a", "b", "c", "d"] } : null;

function makeStore(): QueueStore {
  return new QueueStore({
    mirrorPath: undefined,
    defaults: {
      budgetUsd: 3,
      jobCapUsd: 10,
      dailyCapUsd: 20,
      timeoutSec: { default: 1200 },
      permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
      model: { implement: "opus", default: "sonnet" },
    },
    resolve,
  });
}

describe("jobRow()'s queuePosition (spec 353)", () => {
  test("matches queuePriorityOrder()'s own order for a mix of quick and slow queued jobs", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const analyze = store.enqueue({ project: "aide", specFolder: "a", steps: ["analyze"] });
    const implement = store.enqueue({ project: "aide", specFolder: "b", steps: ["implement"] });
    const archive = store.enqueue({ project: "aide", specFolder: "c", steps: ["archive"] });
    if (!analyze.ok || !implement.ok || !archive.ok) throw new Error("enqueue failed");

    const ctx = { queue: store, store: runStore };
    const rows = await Promise.all(
      [analyze.job, implement.job, archive.job].map((job) => jobRow(ctx, job)),
    );

    const expectedOrder = queuePriorityOrder(
      [...store.list()].reverse().filter((j) => j.state === "queued"),
    );

    for (const row of rows) {
      const job = [analyze.job, implement.job, archive.job].find((j) => j.id === row.id)!;
      const expectedN = expectedOrder.findIndex((j) => j.id === job.id) + 1;
      expect(row.queuePosition?.n).toBe(expectedN);
      expect(row.queuePosition?.total).toBe(expectedOrder.length);
    }

    // archive is the only quick step here, so it must be first.
    const archiveRow = rows.find((r) => r.id === archive.job.id)!;
    expect(archiveRow.queuePosition?.n).toBe(1);
  });

  test("the jobRow() -> specStateChip() composition renders '<step> n/total'", async () => {
    const store = makeStore();
    const runStore = new AideRunStore();
    const archive = store.enqueue({ project: "aide", specFolder: "a", steps: ["archive"] });
    const analyze = store.enqueue({ project: "aide", specFolder: "b", steps: ["analyze"] });
    const implement = store.enqueue({ project: "aide", specFolder: "c", steps: ["implement"] });
    if (!archive.ok || !analyze.ok || !implement.ok) throw new Error("enqueue failed");

    const ctx = { queue: store, store: runStore };
    const row = await jobRow(ctx, implement.job);
    const html = specStateChip(row);

    const n = row.queuePosition?.n;
    const total = row.queuePosition?.total;
    expect(html).toContain(`implementing ${n}/${total}`);
  });
});
