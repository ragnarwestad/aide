// The provider picked for a step of a running job and for a phase with no
// job yet, kept beside the model.

import { describe, expect, test } from "bun:test";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Opus" },
  modelChoices: { Opus: {}, "gpt-6": { tool: "codex" } },
  providers: {
    Claude: { name: "Claude", tool: "claude" },
    "Claude-Capra": { name: "Claude-Capra", tool: "claude", configDir: "~/.claude-capra" },
    Codex: { name: "Codex", tool: "codex" },
  },
};

function store(): QueueStore {
  return new QueueStore({ defaults: DEFAULTS, resolve: (p) => (p === "aide" ? { specFolders: ["81-queue"] } : null) });
}

function runningJob(q: QueueStore, extra: object = {}): string {
  const made = q.enqueue({ project: "aide", specFolder: "81-queue", steps: ["analyze", "implement"], ...extra });
  if (!made.ok) throw new Error(made.error);
  q.update(made.job.id, { state: "running" });
  return made.job.id;
}

describe("a tail pick's provider", () => {
  test("the provider is stored on the step beside its model (AC-9, AC-12)", () => {
    const q = store();
    const id = runningJob(q);
    const r = q.editTailModel(id, "implement", "gpt-6", "Codex");
    expect(r.ok && r.job.provider).toEqual({ implement: "Codex" });
    expect(r.ok && r.job.model.implement).toBe("gpt-6");
  });

  test("a provider that cannot run the model is refused and the job is left as it was (AC-9, AC-12)", () => {
    const q = store();
    const id = runningJob(q);
    const r = q.editTailModel(id, "implement", "gpt-6", "Claude");
    expect(!r.ok && r.error).toContain("gpt-6 is a Codex model and Claude is a Claude Code provider");
    expect(q.get(id)?.provider).toBeUndefined();
  });

  test("a model alone drops the step's own provider when that provider cannot run it (AC-9, AC-12)", () => {
    const q = store();
    const id = runningJob(q, { provider: { implement: "Claude-Capra" } });
    const r = q.editTailModel(id, "implement", "gpt-6");
    expect(r.ok && r.job.provider).toEqual({});
  });
});

describe("a pending pick's provider", () => {
  test("it is kept beside the model and carried to the folder landing assigns (AC-9)", () => {
    const q = store();
    expect(q.setPendingModel("aide", "new-1", "implement", "gpt-6", "Codex")).toEqual({ ok: true });
    expect(q.pendingProviders["aide/new-1"]).toEqual({ implement: "Codex" });
    q.renamePendingModel("aide", "new-1", "81-queue");
    expect(q.pendingProviders["aide/81-queue"]).toEqual({ implement: "Codex" });
    expect(q.pendingProviders["aide/new-1"]).toBeUndefined();
    expect(q.pendingModels["aide/81-queue"]).toEqual({ implement: "gpt-6" });
  });

  test("an unknown provider is refused and nothing is kept (AC-9)", () => {
    const q = store();
    const r = q.setPendingModel("aide", "81-queue", "implement", "Opus", "Gone");
    expect(!r.ok && r.error).toContain("unknown or not-allowed provider: Gone");
    expect(q.pendingProviders["aide/81-queue"]).toBeUndefined();
    expect(q.pendingModels["aide/81-queue"]).toBeUndefined();
  });
});
