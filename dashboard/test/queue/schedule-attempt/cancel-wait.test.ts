import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { restartAfterUsageLimit } from "../../../src/queue/runner/usage-limit.ts";
import { cancelScheduleWait } from "../../../src/queue/schedule-attempt";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("cancelling a schedule wait clears restart metadata and persists its history (AC-2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "schedule-wait-")); dirs.push(dir);
  const opts = { mirrorPath: join(dir, "queue.json"), defaults: { model: {}, permissionMode: {}, timeoutSec: {} }, resolve: () => ({ specFolders: ["81-work"] }) };
  const store = new QueueStore(opts);
  const made = store.enqueue({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] });
  if (!made.ok) throw new Error(made.error);
  store.writeUnchecked(made.job.id, { state: "waiting", stopReason: "provider-limit", spentUsd: 3, spentTokens: 17,
    usageLimitWait: { until: "2026-11-18T00:00:00Z", resetKnown: true },
    usageLimitProbe: { results: 0, at: "2026-11-17T00:00:00Z", since: "2026-11-17T00:00:00Z" },
    retry: { action: "schedule", attempts: 1, dueAt: "2026-11-18T00:00:00Z" } });
  expect(cancelScheduleWait(store, store.get(made.job.id)!).ok).toBe(true);
  const reloaded = new QueueStore(opts);
  restartAfterUsageLimit(reloaded, () => "Claude", Date.parse("2026-12-01T00:00:00Z"));
  const job = reloaded.get(made.job.id)!;
  expect(job.state).toBe("cancelled");
  expect([job.usageLimitWait, job.usageLimitProbe, job.stopReason, job.retry]).toEqual([undefined, undefined, undefined, undefined]);
  expect([job.spentUsd, job.spentTokens]).toEqual([3, 17]);
  expect(job.finishedAt).toBeDefined();
  expect(cancelScheduleWait(reloaded, job).ok).toBe(false);
});

test("ordinary stops, non-schedules and landing work cannot use wait cancellation (AC-2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "schedule-wait-refuse-")); dirs.push(dir);
  const store = new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: { model: {}, permissionMode: {}, timeoutSec: {} }, resolve: () => ({ specFolders: ["81-work"] }) });
  for (const specFolder of ["81-work", "schedule-nightly"]) {
    const made = store.enqueue({ project: "aide", specFolder, steps: [specFolder === "81-work" ? "analyze" : "schedule"] });
    if (!made.ok) throw new Error(made.error);
    store.writeUnchecked(made.job.id, { state: "waiting", stopReason: "timeout" });
    expect(cancelScheduleWait(store, store.get(made.job.id)!).ok).toBe(false);
    store.update(made.job.id, { stopReason: "provider-limit", usageLimitWait: { until: "2027-01-01T00:00:00Z", resetKnown: true }, landing: true });
    expect(cancelScheduleWait(store, store.get(made.job.id)!).ok).toBe(false);
    if (specFolder === "81-work") {
      store.update(made.job.id, { landing: undefined });
      expect(cancelScheduleWait(store, store.get(made.job.id)!).ok).toBe(false);
    }
  }
});
