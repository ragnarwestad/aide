// The newest model id each choice ran on, kept on the store so the pickers
// can say what an alias gives today — and kept in a sidecar, since the
// queue's own memory is 200 jobs and an alias may not have run in that many.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { resolveStepModel } from "../../../src/queue/model-name.ts";
import { resolveStepModel as reExported } from "../../../src/serve/serve-helpers/runner-argv.ts";
import { enqueue, makeRunner, okResult, resetHarness, cleanupHarness, store as harnessStore } from "../runner/runner-fixtures.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { Opus: { model: "opus" }, Sonnet: { model: "sonnet" } },
};
const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-model-ids-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("QueueStore.recordModelId() (AC-4, AC-5)", () => {
  test("records the id per choice name", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.recordModelId("Opus", "claude-opus-5-5");
    store.recordModelId("Sonnet", "claude-sonnet-5");
    expect(store.modelIds).toEqual({ Opus: "claude-opus-5-5", Sonnet: "claude-sonnet-5" });
  });

  test("the newer id wins (AC-5)", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.recordModelId("Opus", "claude-opus-5-5");
    store.recordModelId("Opus", "claude-opus-5-6");
    expect(store.modelIds.Opus).toBe("claude-opus-5-6");
  });

  test("an empty id and an unresolved choice record nothing", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.recordModelId("Opus", "");
    store.recordModelId(undefined, "claude-opus-5-5");
    expect(store.modelIds).toEqual({});
  });

  test("survives a rebuild from the sidecar (AC-5)", () => {
    const modelIdsPath = join(dir, "model-ids.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, modelIdsPath });
    first.recordModelId("Opus", "claude-opus-5-5");
    first.recordModelId("Opus", "claude-opus-5-6");
    const second = new QueueStore({ defaults: DEFAULTS, resolve, modelIdsPath });
    expect(second.modelIds).toEqual({ Opus: "claude-opus-5-6" });
    expect(JSON.parse(readFileSync(modelIdsPath, "utf-8"))).toEqual({ Opus: "claude-opus-5-6" });
  });

  test("a corrupt sidecar starts empty, and a malformed entry is dropped", () => {
    const modelIdsPath = join(dir, "model-ids.json");
    writeFileSync(modelIdsPath, "{not json");
    expect(new QueueStore({ defaults: DEFAULTS, resolve, modelIdsPath }).modelIds).toEqual({});
    writeFileSync(modelIdsPath, JSON.stringify({ Opus: "claude-opus-5-5", Sonnet: 5, Fable: "" }));
    expect(new QueueStore({ defaults: DEFAULTS, resolve, modelIdsPath }).modelIds).toEqual({ Opus: "claude-opus-5-5" });
  });
});

describe("Runner.complete() records the id against the choice the step ran on (AC-4)", () => {
  beforeEach(resetHarness);
  afterEach(cleanupHarness);

  test("a step that ran on a choice with an id records it under that choice (the configured default when none was picked)", () => {
    const job = enqueue();
    const runner = makeRunner({ readResult: () => ({ ...okResult(1), modelId: "claude-opus-5-5" }) });
    runner.tick();
    runner.poll();
    expect(harnessStore.get(job.id)?.state).toBe("done");
    expect(harnessStore.modelIds).toEqual({ sonnet: "claude-opus-5-5" });
  });

  test("a step with no id records nothing", () => {
    enqueue();
    const runner = makeRunner({ readResult: () => okResult(1) });
    runner.tick();
    runner.poll();
    expect(harnessStore.modelIds).toEqual({});
  });
});

describe("resolveStepModel", () => {
  test("lives in the queue layer and is still exported from where it was", () => {
    expect(reExported).toBe(resolveStepModel);
  });
});
