// A job cancelled before it started holds nothing worth keeping — no log,
// no cost, no result — and cannot be started again, so the store removes
// it. A job that had started keeps its record. Every cancel leaves one
// line saying which job, in which state, and what it was waiting for.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { endStep } from "../../../src/queue/runner/step-result.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};
const resolve = () => ({ specFolders: ["1-first", "2-next"] });

let dir: string;
let mirror: string;
let lines: string[];
const storeAt = () => new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath: mirror, log: (line) => lines.push(line) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-cancel-before-start-"));
  mirror = join(dir, "queue.json");
  lines = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const queued = (store: QueueStore, specFolder = "1-first") => {
  const made = store.enqueue({ project: "aide", specFolder, steps: ["analyze"] });
  if (!made.ok) throw new Error(made.error);
  return made.job.id;
};

describe("cancelling a job that never started", () => {
  test("removes it from the queue and from the mirror", () => {
    const store = storeAt();
    const id = queued(store);
    const result = endStep(store, id, "cancel", { finishedAt: "2026-11-13T10:00:00.000Z" });
    expect(result.ok).toBe(true);
    expect(store.get(id)).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(mirror, "utf8")) as { id: string }[];
    expect(onDisk.map((job) => job.id)).not.toContain(id);
  });

  test("logs the job, its state and the reason it was waiting for", () => {
    const store = storeAt();
    const id = queued(store);
    store.update(id, { error: { key: "runner.usageLimitHeld", values: { provider: "Claude", at: "06:00" } }, errorReason: "held-back" });
    endStep(store, id, "cancel", { finishedAt: "2026-11-13T10:00:00.000Z", error: undefined, errorReason: undefined });
    const line = lines.find((l) => l.includes(id.slice(0, 8)));
    expect(line).toContain("aide/1-first");
    expect(line).toContain("queued");
    expect(line).toContain("runner.usageLimitHeld");
  });

  test("keeps a job that had started, cancelled, and logs it", () => {
    const store = storeAt();
    const id = queued(store);
    store.transition(id, "start", { startedAt: "2026-11-13T09:00:00.000Z" });
    endStep(store, id, "cancel", { finishedAt: "2026-11-13T10:00:00.000Z" });
    expect(store.get(id)?.state).toBe("cancelled");
    expect(lines.some((l) => l.includes(id.slice(0, 8)) && l.includes("running"))).toBe(true);
  });

  test("still stops its group before it goes", () => {
    const store = storeAt();
    const group = store.executionGroups.create({ project: "aide", name: "Release", members: ["1-first", "2-next"], branch: "aide/group-1-first" });
    const made = store.enqueue({ project: "aide", specFolder: "1-first", steps: ["archive"], executionGroupId: group.id });
    if (!made.ok) throw new Error(made.error);
    store.executionGroups.update(group.id, { state: "archiving" });
    endStep(store, made.job.id, "cancel", { finishedAt: "2026-11-13T10:00:00.000Z" });
    expect(store.get(made.job.id)).toBeUndefined();
    expect(store.executionGroups.get(group.id)?.state).toBe("stopped");
  });
});

describe("loading the queue", () => {
  test("drops a cancelled job that never started and keeps one that did", () => {
    const base = { project: "aide", steps: ["schedule"], stepIndex: 0, state: "cancelled", timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-11-10T02:00:00.000Z", spentUsd: 0 };
    writeFileSync(mirror, JSON.stringify([
      { ...base, id: "never-started", specFolder: "schedule-nightly-e2e", results: [] },
      { ...base, id: "had-started", specFolder: "schedule-Nyhetssjekk", results: [], startedAt: "2026-11-10T04:30:00.000Z" },
    ]));
    const store = storeAt();
    expect(store.get("never-started")).toBeUndefined();
    expect(store.get("had-started")?.state).toBe("cancelled");
  });
});
