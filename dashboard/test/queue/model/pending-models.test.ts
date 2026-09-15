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

// Spec 465: a model picked on the New page for a phase the create job
// does not run is banked under the job's own provisional key, the same
// table `setPendingModel()` writes to — mirroring
// `pending-steps.test.ts`'s own `enqueueCreate()`-seeds-`pendingSteps`
// test.
describe("QueueStore.enqueueCreate() seeds pendingModels (spec 465)", () => {
  const allow = (project: string) => project === "brandnew";

  test("a model posted for a phase not in steps is banked under the job's provisional folder", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const result = store.enqueueCreate({
      project: "brandnew",
      title: "A new spec",
      description: "Do the thing",
      model: { implement: "fable" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.pendingModels[`${result.job.project}/${result.job.specFolder}`]).toEqual({ implement: "fable" });
  });

  test("a model posted for a step this job DOES run is not banked as pending", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const result = store.enqueueCreate({
      project: "brandnew",
      title: "A new spec",
      description: "Do the thing",
      model: { create: "fable" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.pendingModels[`${result.job.project}/${result.job.specFolder}`]).toBeUndefined();
  });

  test("no model posted at all records nothing", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve, allowCreateProject: allow });
    const result = store.enqueueCreate({ project: "brandnew", title: "A new spec", description: "Do the thing" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.pendingModels[`${result.job.project}/${result.job.specFolder}`]).toBeUndefined();
  });
});

// Spec 465: the `pendingModels` sibling of the `specFolder` rename
// landing already makes on the job itself (spec 453) — the provisional
// key's entry must move with it, or it is orphaned the moment the real
// folder appears.
describe("QueueStore.renamePendingModel() (spec 465)", () => {
  test("moves an entry from the provisional key to the real one", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingModel("aide", "new-abcd1234", "implement", "fable");
    store.renamePendingModel("aide", "new-abcd1234", "94-a-new-spec");
    expect(store.pendingModels["aide/new-abcd1234"]).toBeUndefined();
    expect(store.pendingModels["aide/94-a-new-spec"]).toEqual({ implement: "fable" });
  });

  test("a no-op when nothing is recorded under the provisional key", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.renamePendingModel("aide", "new-abcd1234", "94-a-new-spec");
    expect(store.pendingModels["aide/94-a-new-spec"]).toBeUndefined();
  });

  test("persists across a fresh QueueStore instance pointed at the same file", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    first.setPendingModel("aide", "new-abcd1234", "implement", "fable");
    first.renamePendingModel("aide", "new-abcd1234", "94-a-new-spec");

    const second = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(second.pendingModels["aide/94-a-new-spec"]).toEqual({ implement: "fable" });
  });
});
