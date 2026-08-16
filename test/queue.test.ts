// Criterion 5 (spec 81): the queue store — a job is validated against
// the discovered, allowlisted projects and their real spec folders;
// unknown fields are ignored; per-job overrides may only tighten the
// configured caps, never loosen them; the mirror survives a restart.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, mergeQueueDefaults, parseJobRequest, type QueueDefaults } from "../src/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: 1200,
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

let dir: string;
let mirrorPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
  mirrorPath = join(dir, "queue.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseJobRequest", () => {
  test("a valid request becomes a job with the configured defaults", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.project).toBe("aide");
    expect(r.job.specFolder).toBe("81-queue-and-runner");
    expect(r.job.steps).toEqual(["analyze", "implement"]);
    expect(r.job.state).toBe("queued");
    expect(r.job.budgetUsd).toBe(3);
    expect(r.job.jobCapUsd).toBe(10);
    expect(r.job.timeoutSec).toBe(1200);
    expect(r.job.spentUsd).toBe(0);
    expect(r.job.stepIndex).toBe(0);
  });

  test("gateAfter defaults to every step, and may be emptied to run straight through", () => {
    const all = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(all.ok && all.job.gateAfter).toEqual(["analyze", "implement"]);
    const none = parseJobRequest({ ...REQ, gateAfter: [] }, { resolve, defaults: DEFAULTS });
    expect(none.ok && none.job.gateAfter).toEqual([]);
  });

  test("the permission mode and model come from the config, per step", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.permissionMode).toEqual({ analyze: "acceptEdits", implement: "bypassPermissions" });
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
  });

  test("unknown fields are ignored", () => {
    const r = parseJobRequest({ ...REQ, nonsense: 1, permissionMode: "bypassPermissions" }, {
      resolve,
      defaults: DEFAULTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.job as unknown as Record<string, unknown>).nonsense).toBeUndefined();
    // permissionMode is config-only: a request must never be able to
    // widen what an unattended run may do.
    expect(r.job.permissionMode.analyze).toBe("acceptEdits");
  });

  test("an override may tighten a cap but never loosen it", () => {
    const tighter = parseJobRequest({ ...REQ, budgetUsd: 1, timeoutSec: 60 }, { resolve, defaults: DEFAULTS });
    expect(tighter.ok).toBe(true);
    if (tighter.ok) {
      expect(tighter.job.budgetUsd).toBe(1);
      expect(tighter.job.timeoutSec).toBe(60);
    }
    const looser = parseJobRequest({ ...REQ, budgetUsd: 50 }, { resolve, defaults: DEFAULTS });
    expect(looser.ok).toBe(false);
    if (!looser.ok) expect(looser.error).toContain("budgetUsd");
  });

  test.each([
    ["an unknown project", { ...REQ, project: "atlasaurus" }, "project"],
    ["a project not in the allowlist", { ...REQ, project: "claude-usage" }, "project"],
    ["a path instead of a name", { ...REQ, project: "../../etc" }, "project"],
    ["an unknown spec folder", { ...REQ, specFolder: "99-nope" }, "specFolder"],
    ["a step that is not a workflow step", { ...REQ, steps: ["deploy"] }, "steps"],
    ["no steps at all", { ...REQ, steps: [] }, "steps"],
    ["a gate for a step not in the job", { ...REQ, gateAfter: ["archive"] }, "gateAfter"],
    ["a non-object body", "hello", "object"],
  ])("%s is rejected", (_label, body, field) => {
    const r = parseJobRequest(body, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(field);
  });
});

describe("QueueStore", () => {
  test("enqueue lists the job, mirrors it, and a new instance reloads it", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(store.list().map((j) => j.id)).toEqual([r.job.id]);
    expect(existsSync(mirrorPath)).toBe(true);

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.list().map((j) => j.id)).toEqual([r.job.id]);
    expect(reloaded.get(r.job.id)?.specFolder).toBe("81-queue-and-runner");
  });

  test("a rejected request stores nothing", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(store.enqueue({ ...REQ, project: "nope" }).ok).toBe(false);
    expect(store.list()).toEqual([]);
  });

  test("the oldest job is dropped at the cap", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, cap: 3 });
    const ids = [1, 2, 3, 4].map(() => {
      const r = store.enqueue(REQ);
      return r.ok ? r.job.id : "";
    });
    expect(store.list().length).toBe(3);
    expect(store.get(ids[0])).toBeUndefined();
    expect(store.get(ids[3])).toBeDefined();
  });

  test("update persists and survives a restart", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    store.update(r.job.id, { state: "cancelled" });
    expect(new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)?.state).toBe("cancelled");
  });

  test("a corrupt mirror is survivable — the store starts empty", () => {
    writeFileSync(mirrorPath, "{not json");
    expect(new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).list()).toEqual([]);
  });
});

describe("mergeQueueDefaults", () => {
  test("a config file overrides what it names and keeps the rest", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      budgetUsd: 15,
      jobCapUsd: 50,
      model: { implement: "opus", "review-plan": "sonnet" },
    });
    expect(merged.budgetUsd).toBe(15);
    expect(merged.jobCapUsd).toBe(50);
    expect(merged.dailyCapUsd).toBe(20); // untouched
    expect(merged.timeoutSec).toBe(1200);
    expect(merged.model["review-plan"]).toBe("sonnet");
    expect(merged.permissionMode.implement).toBe("bypassPermissions");
  });

  test("nonsense is ignored rather than obeyed — failing towards spending less", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { budgetUsd: -5, dailyCapUsd: "lots", model: 7 });
    expect(merged.budgetUsd).toBe(3);
    expect(merged.dailyCapUsd).toBe(20);
    expect(merged.model).toEqual(DEFAULTS.model);
  });
});

describe("stepsCompletedFor", () => {
  test("a step the queue actually ran counts, whatever the status file says", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!r.ok) throw new Error(r.error);
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual([]);
    store.update(r.job.id, {
      state: "done",
      results: [
        {
          step: "implement",
          ok: true,
          costUsd: 12.34,
          costMeasured: true,
          terminalReason: "completed",
          at: "2026-08-16T18:00:00Z",
        },
      ],
    });
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual(["implement"]);
    // Another spec's history is not this spec's.
    expect(store.stepsCompletedFor("aide-dashboard", "01-first")).toEqual([]);
  });

  test("a step that did NOT succeed does not count", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!r.ok) throw new Error(r.error);
    store.update(r.job.id, {
      state: "stopped",
      results: [
        {
          step: "implement",
          ok: false,
          costUsd: 15,
          costMeasured: false,
          terminalReason: "budget",
          at: "2026-08-16T18:00:00Z",
        },
      ],
    });
    expect(store.stepsCompletedFor("aide", "81-queue-and-runner")).toEqual([]);
  });
});
