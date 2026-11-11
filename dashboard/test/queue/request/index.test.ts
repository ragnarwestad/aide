import { describe, expect, test } from "bun:test";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { enqueueCreateRequest, enqueueRequest, followOnRequest } from "../../../src/queue/request/index.ts";

const defaults: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};
const resolve = (project: string) => project === "aide" ? { specFolders: ["81-queue"] } : null;

describe("shared queue request origin", () => {
  test("marks successful manual jobs and creates, but not automatic work (AC-1, AC-2)", () => {
    const queue = new QueueStore({ defaults, resolve, allowCreateProject: (project) => project === "new" });
    const manual = enqueueRequest(queue, { project: "aide", specFolder: "81-queue", steps: ["analyze"] }, "manual");
    const automatic = enqueueRequest(queue, { project: "aide", specFolder: "81-queue", steps: ["implement"] }, "automatic");
    const created = enqueueCreateRequest(queue, { project: "new", title: "Shared rules", description: "Queue it" }, "manual");
    expect(manual.ok && queue.get(manual.job.id)?.pressed).toBe(true);
    expect(automatic.ok && queue.get(automatic.job.id)?.pressed).toBeUndefined();
    expect(created.ok && queue.get(created.job.id)?.pressed).toBe(true);
  });

  test("returns a refusal unchanged without updating a job (AC-5)", () => {
    const updates: string[] = [];
    const refusal = { ok: false as const, error: "refused", solution: "wait" };
    const result = enqueueRequest({ enqueue: () => refusal, update: (id) => void updates.push(id) }, {}, "manual");
    expect(result).toBe(refusal);
    expect(updates).toEqual([]);
  });
});

test("a follow-up keeps only the remaining step choices (AC-4)", () => {
  const request = followOnRequest("aide", "81-queue", ["implement"], {
    model: { analyze: "sonnet", implement: "opus" },
    provider: { analyze: "Claude", implement: "Codex" },
    effort: { analyze: "low", implement: "high" },
  } as never);
  expect(request).toMatchObject({
    steps: ["implement"],
    model: { implement: "opus" },
    provider: { implement: "Codex" },
    effort: { implement: "high" },
  });
});
