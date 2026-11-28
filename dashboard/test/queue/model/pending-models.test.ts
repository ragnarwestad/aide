// A model picked for a phase survives leaving the page — the
// store's own half. `setPendingModel()` records a pick made before a
// job exists to attach it to, the way `editTailModel()` records one
// made on a running job's tail.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { clearAllStorageFaults, storageFaults } from "../../../src/queue/store/storage-faults.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: { }, fable: { } },
};

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-pending-models-"));
});

afterEach(() => {
  clearAllStorageFaults();
  rmSync(dir, { recursive: true, force: true });
});

describe("QueueStore.setPendingModel()", () => {
  test("records and clears Review and Verify choices across a restart (AC-9, AC-11)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const defaults = { ...DEFAULTS, modelChoices: { ...DEFAULTS.modelChoices, codex: { tool: "codex" as const } } };
    const first = new QueueStore({ defaults, resolve, pendingModelsPath });
    expect(first.setPendingModel("aide", "81-queue-and-runner", "review", "codex").ok).toBe(true);
    expect(first.setPendingModel("aide", "81-queue-and-runner", "verify", "codex").ok).toBe(true);
    expect(new QueueStore({ defaults, resolve, pendingModelsPath }).pendingModels["aide/81-queue-and-runner"]).toEqual({ review: "codex", verify: "codex" });
    expect(first.setPendingModel("aide", "81-queue-and-runner", "review", "").ok).toBe(true);
    expect(new QueueStore({ defaults, resolve, pendingModelsPath }).pendingModels["aide/81-queue-and-runner"]).toEqual({ verify: "codex" });
  });

  test("records and clears an Analyze Review choice and its provider across a restart (AC-7)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const defaults = {
      ...DEFAULTS,
      modelChoices: { ...DEFAULTS.modelChoices, codex: { tool: "codex" as const } },
      providers: { Codex: { name: "Codex", tool: "codex" as const } },
    };
    const first = new QueueStore({ defaults, resolve, pendingModelsPath });
    expect(first.setPendingModel("aide", "81-queue-and-runner", "plan-review", "codex", "Codex").ok).toBe(true);
    const second = new QueueStore({ defaults, resolve, pendingModelsPath });
    expect(second.pendingModels["aide/81-queue-and-runner"]).toEqual({ "plan-review": "codex" });
    expect(second.pendingProviders["aide/81-queue-and-runner"]).toEqual({ "plan-review": "Codex" });
    expect(second.setPendingModel("aide", "81-queue-and-runner", "plan-review", "").ok).toBe(true);
    expect(new QueueStore({ defaults, resolve, pendingModelsPath }).pendingModels["aide/81-queue-and-runner"]).toBeUndefined();
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

  test("persists across a fresh QueueStore instance pointed at the same file", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const first = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    first.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");

    const second = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(second.pendingModels["aide/81-queue-and-runner"]?.analyze).toBe("fable");
  });

  test("written in one versioned file, model and provider together", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    const raw = JSON.parse(readFileSync(pendingModelsPath, "utf-8")) as unknown;
    expect(raw).toEqual({ version: 2, choices: { "aide/81-queue-and-runner": { analyze: { model: "fable" } } } });
  });
});

// The pending choices are kept to the same rules as the queue's own file:
// a file that cannot be read is left as it is and reported, a save that
// fails is refused and leaves memory as it was, and a model and its
// provider are written in one rename.
describe("the pending-models file on disk", () => {
  const PROVIDERS: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: { ...DEFAULTS.modelChoices, codex: { tool: "codex" as const } },
    providers: { Codex: { name: "Codex", tool: "codex" as const }, Other: { name: "Other", tool: "codex" as const } },
  };
  const KEY = "aide/81-queue-and-runner";
  const faultFor = (file: string) => storageFaults().find((fault) => fault.file === file);

  test("a file that cannot be parsed is left as it is, reported, and never written (AC-1)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    writeFileSync(pendingModelsPath, "not json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(store.pendingModels).toEqual({});
    expect(faultFor(pendingModelsPath)).toMatchObject({ store: "pending", action: "read" });
    const result = store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(pendingModelsPath);
    expect(store.pendingModels).toEqual({});
    expect(readFileSync(pendingModelsPath, "utf-8")).toBe("not json");
  });

  test("an unreadable providers file beside a legacy models file locks both files (AC-1)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const providersPath = join(dir, "pending-providers.json");
    const legacy = JSON.stringify({ [KEY]: { implement: "codex" } });
    writeFileSync(pendingModelsPath, legacy);
    writeFileSync(providersPath, "{ broken");
    const store = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(faultFor(providersPath)).toMatchObject({ store: "pending", action: "read" });
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "codex", "Codex").ok).toBe(false);
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "codex").ok).toBe(false);
    expect(readFileSync(pendingModelsPath, "utf-8")).toBe(legacy);
    expect(readFileSync(providersPath, "utf-8")).toBe("{ broken");
  });

  test("an unreadable providers file with no models file is reported and not removed (AC-1)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const providersPath = join(dir, "pending-providers.json");
    writeFileSync(providersPath, "not json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(faultFor(providersPath)).toMatchObject({ store: "pending", action: "read" });
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable").ok).toBe(false);
    expect(readFileSync(providersPath, "utf-8")).toBe("not json");
    expect(existsSync(pendingModelsPath)).toBe(false);
  });

  test("with no files at all nothing is reported and a pick is saved (AC-1)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    expect(storageFaults()).toEqual([]);
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable").ok).toBe(true);
    expect(existsSync(pendingModelsPath)).toBe(true);
  });

  test("a save that fails is refused, reported and not kept; the next good save clears the fault (AC-2)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    mkdirSync(pendingModelsPath);
    const result = store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(pendingModelsPath);
    expect(faultFor(pendingModelsPath)).toMatchObject({ store: "pending", action: "write" });
    expect(store.pendingModels).toEqual({});
    rmSync(pendingModelsPath, { recursive: true });
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "fable").ok).toBe(true);
    expect(faultFor(pendingModelsPath)).toBeUndefined();
    expect(store.pendingModels[KEY]).toEqual({ analyze: "fable" });
  });

  test("a model and its provider come back together from the one file (AC-3)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const first = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(first.setPendingModel("aide", "81-queue-and-runner", "implement", "codex", "Codex").ok).toBe(true);
    expect(existsSync(join(dir, "pending-providers.json"))).toBe(false);
    const second = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(second.pendingModels[KEY]).toEqual({ implement: "codex" });
    expect(second.pendingProviders[KEY]).toEqual({ implement: "Codex" });
  });

  test("a save interrupted before its rename leaves the pair from the last completed save (AC-3)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const first = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(first.setPendingModel("aide", "81-queue-and-runner", "implement", "codex", "Codex").ok).toBe(true);
    writeFileSync(`${pendingModelsPath}.tmp`, JSON.stringify({ version: 2, choices: { [KEY]: { implement: { model: "fable", provider: "Other" } } } }));
    const second = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(second.pendingModels[KEY]).toEqual({ implement: "codex" });
    expect(second.pendingProviders[KEY]).toEqual({ implement: "Codex" });
  });

  test("a stale providers file beside a versioned file is not read (AC-3)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ version: 2, choices: { [KEY]: { implement: { model: "codex", provider: "Codex" } } } }));
    writeFileSync(join(dir, "pending-providers.json"), JSON.stringify({ [KEY]: { implement: "Other" } }));
    const store = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath });
    expect(store.pendingModels[KEY]).toEqual({ implement: "codex" });
    expect(store.pendingProviders[KEY]).toEqual({ implement: "Codex" });
  });

  test("legacy models, providers and steps survive the migration, and the providers file goes (AC-4)", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const pendingStepsPath = join(dir, "pending-steps.json");
    const providersPath = join(dir, "pending-providers.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ [KEY]: { implement: "codex", analyze: "fable" } }));
    writeFileSync(providersPath, JSON.stringify({ [KEY]: { implement: "Codex", archive: "Codex" } }));
    writeFileSync(pendingStepsPath, JSON.stringify({ [KEY]: ["analyze", "implement"] }));
    const first = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath, pendingStepsPath });
    expect(first.pendingProviders[KEY]).toEqual({ implement: "Codex" });
    expect(first.setPendingModel("aide", "82-next", "analyze", "fable").ok).toBe(true);
    expect(existsSync(providersPath)).toBe(false);
    const second = new QueueStore({ defaults: PROVIDERS, resolve, pendingModelsPath, pendingStepsPath });
    expect(second.pendingModels).toEqual({ [KEY]: { implement: "codex", analyze: "fable" }, "aide/82-next": { analyze: "fable" } });
    expect(second.pendingProviders).toEqual({ [KEY]: { implement: "Codex" } });
    expect(second.pendingSteps[KEY]).toEqual(["analyze", "implement"]);
  });
});

// A model picked on the New page for a phase the create job
// does not run is banked under the job's own provisional key, the same
// table `setPendingModel()` writes to — mirroring
// `pending-steps.test.ts`'s own `enqueueCreate()`-seeds-`pendingSteps`
// test.
describe("QueueStore.enqueueCreate() seeds pendingModels", () => {
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

// The `pendingModels` sibling of the `specFolder` rename
// landing already makes on the job itself — the provisional
// key's entry must move with it, or it is orphaned the moment the real
// folder appears.
describe("QueueStore.renamePendingModel()", () => {
  test("moves an entry from the provisional key to the real one", () => {
    const store = new QueueStore({ defaults: DEFAULTS, resolve });
    store.setPendingModel("aide", "new-abcd1234", "implement", "fable");
    store.renamePendingModel("aide", "new-abcd1234", "94-a-new-spec");
    expect(store.pendingModels["aide/new-abcd1234"]).toBeUndefined();
    expect(store.pendingModels["aide/94-a-new-spec"]).toEqual({ implement: "fable" });
  });

  test("moves the entry in memory even when the file cannot take it, and reports the fault", () => {
    const pendingModelsPath = join(dir, "pending-models.json");
    const store = new QueueStore({ defaults: DEFAULTS, resolve, pendingModelsPath });
    store.setPendingModel("aide", "new-abcd1234", "implement", "fable");
    rmSync(pendingModelsPath);
    mkdirSync(pendingModelsPath);
    expect(store.renamePendingModel("aide", "new-abcd1234", "94-a-new-spec")).toBeDefined();
    expect(store.pendingModels["aide/new-abcd1234"]).toBeUndefined();
    expect(store.pendingModels["aide/94-a-new-spec"]).toEqual({ implement: "fable" });
    expect(storageFaults()).toEqual([expect.objectContaining({ file: pendingModelsPath, action: "write" })]);
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

describe("QueueStore.setPendingModel() with a differently-cased name", () => {
  test("stores the listed spelling", () => {
    const store = new QueueStore({ defaults: { ...DEFAULTS, modelChoices: { Sonnet: {} } }, resolve });
    expect(store.setPendingModel("aide", "81-queue-and-runner", "analyze", "sonnet").ok).toBe(true);
    expect(store.pendingModels["aide/81-queue-and-runner"]?.analyze).toBe("Sonnet");
  });
});
