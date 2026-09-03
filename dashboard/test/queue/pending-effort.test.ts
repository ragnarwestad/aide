// Spec 364: an effort level picked for a phase survives leaving the
// page — the store's own half, mirroring pending-models.test.ts
// (spec 308) on the same terms. No budget grant to look up here (see
// 2-analysis.md, "Config-vs-code precedence tables are for THINGS THAT
// COST MONEY"): the value is checked against the fixed EFFORT_LEVELS
// list, not a configured allowlist.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12 } },
};

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-pending-effort-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("QueueStore.setPendingEffort() (spec 364)", () => {
  test("REQ-2: records a valid pick", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingEffort("aide", "81-queue-and-runner", "analyze", "high");
    expect(result.ok).toBe(true);
    expect(store.pendingEffort["aide/81-queue-and-runner"]?.analyze).toBe("high");
  });

  test("a second pick for another step is added beside the first, not over it", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingEffort("aide", "81-queue-and-runner", "analyze", "high");
    store.setPendingEffort("aide", "81-queue-and-runner", "implement", "low");
    expect(store.pendingEffort["aide/81-queue-and-runner"]).toEqual({ analyze: "high", implement: "low" });
  });

  test("refuses an unknown step, by name", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingEffort("aide", "81-queue-and-runner", "nope", "high");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("nope");
  });

  test("refuses a level not in EFFORT_LEVELS", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingEffort("aide", "81-queue-and-runner", "analyze", "turbo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("turbo");
    expect(store.pendingEffort["aide/81-queue-and-runner"]).toBeUndefined();
  });

  test("refuses ultracode — not a plain effort level (2-analysis.md, 'Which levels to offer')", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingEffort("aide", "81-queue-and-runner", "analyze", "ultracode");
    expect(result.ok).toBe(false);
  });

  test("REQ-2: persists across a fresh QueueStore instance pointed at the same file", () => {
    const pendingEffortPath = join(dir, "pending-effort.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, pendingEffortPath });
    first.setPendingEffort("aide", "81-queue-and-runner", "analyze", "high");

    const second = new QueueStore({ defaults: DEFAULTS, resolve, pendingEffortPath });
    expect(second.pendingEffort["aide/81-queue-and-runner"]?.analyze).toBe("high");
  });

  test("written tmp-then-renamed, like every other file this store writes", () => {
    const pendingEffortPath = join(dir, "pending-effort.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingEffortPath });
    store.setPendingEffort("aide", "81-queue-and-runner", "analyze", "high");
    const raw = JSON.parse(readFileSync(pendingEffortPath, "utf-8")) as unknown;
    expect(raw).toEqual({ "aide/81-queue-and-runner": { analyze: "high" } });
  });

  test("a malformed file on disk is dropped, not crashed on", () => {
    const pendingEffortPath = join(dir, "pending-effort.json");
    writeFileSync(pendingEffortPath, "not json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingEffortPath });
    expect(store.pendingEffort).toEqual({});
  });
});
