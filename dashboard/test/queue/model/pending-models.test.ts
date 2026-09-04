// Spec 308: a model picked for a phase survives leaving the page — the
// store's own half. `setPendingModel()` records a pick made before a
// job exists to attach it to, the way `editTailModel()` records one
// made on a running job's tail.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";

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
  dir = mkdtempSync(join(tmpdir(), "aide-pending-models-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("QueueStore.setPendingModel() (spec 308)", () => {
  test("REQ-1: records a valid pick", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    expect(result.ok).toBe(true);
    expect(store.pendingModels["aide/81-queue-and-runner"]?.analyze).toBe("fable");
  });

  test("a second pick for another step is added beside the first, not over it", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    store.setPendingModel("aide", "81-queue-and-runner", "implement", "sonnet");
    expect(store.pendingModels["aide/81-queue-and-runner"]).toEqual({ analyze: "fable", implement: "sonnet" });
  });

  test("refuses an unknown step, by name", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingModel("aide", "81-queue-and-runner", "nope", "fable");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("nope");
  });

  test("refuses a model the server does not offer", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    const result = store.setPendingModel("aide", "81-queue-and-runner", "analyze", "haiku");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("haiku");
    expect(store.pendingModels["aide/81-queue-and-runner"]).toBeUndefined();
  });

  test("REQ-2: persists across a fresh QueueStore instance pointed at the same file", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    first.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");

    const second = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(second.pendingModels["aide/81-queue-and-runner"]?.analyze).toBe("fable");
  });

  test("written tmp-then-renamed, like every other file this store writes", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    const raw = JSON.parse(readFileSync(pendingModelsPath, "utf-8")) as unknown;
    expect(raw).toEqual({ "aide/81-queue-and-runner": { analyze: "fable" } });
  });

  test("a malformed file on disk is dropped, not crashed on", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    writeFileSync(pendingModelsPath, "not json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(store.pendingModels).toEqual({});
  });
});
