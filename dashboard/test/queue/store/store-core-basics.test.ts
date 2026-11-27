import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ERROR_REASONS } from "../../../src/job-states.ts";
import { QueueStore } from "../../../src/queue/queue.ts";
import { clearAllStorageFaults } from "../../../src/queue/store/storage-faults.ts";
import { DEFAULTS, resolve, REQ } from "../queue-fixtures.ts";

let dir: string;
let mirrorPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
  mirrorPath = join(dir, "queue.json");
});

afterEach(() => {
  clearAllStorageFaults();
  rmSync(dir, { recursive: true, force: true });
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
    // Distinct steps: the queue refuses the same step twice while the
    // first is unfinished, so four identical requests would not make
    // four jobs to drop one of.
    const ids = ["analyze", "implement", "archive", "explore"].map((step) => {
      const r = store.enqueue({ ...REQ, steps: [step] });
      return r.ok ? r.job.id : "";
    });
    expect(store.list().length).toBe(3);
    expect(store.get(ids[0])).toBeUndefined();
    expect(store.get(ids[3])).toBeDefined();
  });

  test("the default store keeps the newest 1000 jobs after reload (AC-13)", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const raw = Array.from({ length: 1001 }, (_, i) => ({
      id: `job-${i}`, project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
      state: "done", timeoutSec: {}, permissionMode: {}, model: {}, results: [], createdAt: new Date(1_700_000_000_000 + i).toISOString(),
    }));
    writeFileSync(mirrorPath, JSON.stringify(raw));
    const loaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(loaded.list()).toHaveLength(1000);
    expect(loaded.get("job-0")).toBeUndefined();
    expect(loaded.get("job-1000")).toBeDefined();
    void store;
  });

  test("saving 1000 jobs stays within the bounded 200-job baseline (AC-14)", () => {
    const measure = (count: number): number => {
      const path = join(dir, `queue-${count}.json`);
      const raw = Array.from({ length: count }, (_, i) => ({
        id: `job-${i}`, project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
        state: "done", timeoutSec: {}, permissionMode: {}, model: {}, results: [], createdAt: new Date(1_700_000_000_000 + i).toISOString(),
      }));
      writeFileSync(path, JSON.stringify(raw));
      const store = new QueueStore({ mirrorPath: path, defaults: DEFAULTS, resolve });
      const times = Array.from({ length: 21 }, (_, i) => {
        const start = performance.now();
        store.update(`job-${count - 1}`, { spentUsd: i });
        return performance.now() - start;
      }).slice(1).sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)]!;
    };
    const at200 = measure(200);
    const at1000 = measure(1000);
    expect(at1000).toBeLessThanOrEqual(25);
    expect(at1000).toBeLessThanOrEqual(at200 * 8 + 5);
  });

  test("no queue file and no groups file start empty, as on a first start, and the first enqueue writes the file (AC-1)", () => {
    const executionGroupsPath = join(dir, "execution-groups.json");
    const store = new QueueStore({ mirrorPath, executionGroupsPath, defaults: DEFAULTS, resolve });
    expect(store.list()).toEqual([]);
    expect(store.executionGroups.list()).toEqual([]);
    expect(store.storage.fault).toBeUndefined();
    expect(store.executionGroups.fault).toBeUndefined();
    expect(store.enqueue(REQ).ok).toBe(true);
    expect(existsSync(mirrorPath)).toBe(true);
  });

  test("a queue file holding invalid data is reported and left as it is (AC-2)", () => {
    writeFileSync(mirrorPath, "{not json");
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(store.list()).toEqual([]);
    store.enqueue(REQ);
    expect(readFileSync(mirrorPath, "utf-8")).toBe("{not json");
    expect(store.storage.fault).toMatchObject({ file: mirrorPath, store: "queue", action: "read" });
    expect(store.storage.fault?.reason).toBeTruthy();
  });

  test("a queue file holding valid JSON that is not a list is reported and left as it is (AC-2)", () => {
    writeFileSync(mirrorPath, '{"x":1}');
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    store.enqueue(REQ);
    expect(readFileSync(mirrorPath, "utf-8")).toBe('{"x":1}');
    expect(store.storage.fault).toMatchObject({ file: mirrorPath, action: "read" });
  });

  test("an entry the queue cannot read is kept beside the file before anything is written (AC-2)", () => {
    const seed = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const kept = seed.enqueue(REQ);
    if (!kept.ok) throw new Error("enqueue failed");
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    const retired = { ...raw[0], id: "old-gated", state: "awaiting-approval" };
    writeFileSync(mirrorPath, JSON.stringify([...raw, retired]));
    const lines: string[] = [];
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve, log: (line) => lines.push(line) });
    const added = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!added.ok) throw new Error("enqueue failed");
    expect(store.list().map((job) => job.id).sort()).toEqual([kept.job.id, added.job.id].sort());
    expect(JSON.parse(readFileSync(`${mirrorPath}.rejected.json`, "utf-8"))).toEqual([retired]);
    expect(lines.some((line) => line.includes(`${mirrorPath}.rejected.json`))).toBe(true);
    expect(store.storage.fault).toBeUndefined();
  });

  test("a write blocked by a directory at the temporary file's path is still reported, not thrown (AC-3)", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    mkdirSync(`${mirrorPath}.tmp`);
    expect(store.enqueue(REQ).ok).toBe(true);
    expect(store.storage.fault).toMatchObject({ file: mirrorPath, store: "queue", action: "write" });
  });

  test("a failed write is reported with the file and the reason, and cleared by the next write that succeeds (AC-3)", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    mkdirSync(mirrorPath);
    const first = store.enqueue(REQ);
    if (!first.ok) throw new Error("enqueue failed");
    expect(store.storage.fault).toMatchObject({ file: mirrorPath, store: "queue", action: "write" });
    expect(store.storage.fault?.reason).toBeTruthy();
    rmSync(mirrorPath, { recursive: true });
    const second = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!second.ok) throw new Error("enqueue failed");
    expect(store.storage.fault).toBeUndefined();
    const onDisk = (JSON.parse(readFileSync(mirrorPath, "utf-8")) as { id: string }[]).map((job) => job.id);
    expect(onDisk.sort()).toEqual([first.job.id, second.job.id].sort());
  });

  // Three jobs on this machine were posted with
  // a gate before the stop between steps was removed, and their records
  // are still in the mirror. A retired FIELD is ignored, like every
  // other unknown key; a retired STATE fails the state check and takes
  // its own row with it, which is the rule a corrupt row has always
  // had — but it must take only its own. A boot that threw, or that
  // dropped the rest of the file with it, would lose every job on the
  // page for the sake of one from August.
  test("a record mirrored with gateAfter or awaiting-approval does not take the file down", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const keep = store.enqueue(REQ);
    expect(keep.ok).toBe(true);
    if (!keep.ok) return;
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    // One row as it was written in August: both retired shapes at once.
    raw.unshift({ ...raw[0], id: "old-gated", state: "awaiting-approval", gateAfter: ["analyze"] });
    // And one that carries only the retired FIELD — that row is fine and
    // stays, minus the field.
    raw.push({ ...raw[raw.length - 1], id: "old-field", gateAfter: ["analyze"] });
    writeFileSync(mirrorPath, JSON.stringify(raw));

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get(keep.job.id)?.id).toBe(keep.job.id);
    expect(reloaded.get("old-gated")).toBeUndefined();
    const field = reloaded.get("old-field");
    expect(field?.state).toBe("queued");
    // Left behind on the way in, so it is gone from the mirror the
    // store writes back too — a field nothing reads must not survive a
    // reload-and-save round trip.
    expect(field && "gateAfter" in field).toBe(false);
    // Any update rewrites the mirror from what is in memory.
    reloaded.update("old-field", { spentUsd: 1 });
    expect(readFileSync(mirrorPath, "utf-8")).not.toContain("gateAfter");
  });

  test("a mirrored job drops an unknown errorReason and keeps every shared member (AC-5, AC-7)", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const seeded = store.enqueue(REQ);
    if (!seeded.ok) throw new Error("enqueue failed");
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    const first = raw[0]!;
    writeFileSync(mirrorPath, JSON.stringify([
      { ...first, id: "unknown-reason", errorReason: "bogus" },
      ...ERROR_REASONS.map((errorReason) => ({ ...first, id: errorReason, errorReason })),
    ]));

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    expect(reloaded.get("unknown-reason")).toBeDefined();
    expect(reloaded.get("unknown-reason")?.errorReason).toBeUndefined();
    for (const errorReason of ERROR_REASONS) {
      expect(reloaded.get(errorReason)?.errorReason).toBe(errorReason);
    }
  });
});

// The data layer: the session of the step that is
// running right now. It is worth nothing unless it survives a restart —
// the very case where the run is still going and the page has to say
// what it is doing.
describe("the running step's session", () => {
  test("sessionId and streamFile round-trip through the mirror", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    store.writeUnchecked(r.job.id, {
      state: "running",
      sessionId: "3f7a1c2e-0000-4000-8000-000000000001",
      streamFile: "/tmp/jobs/x.stream.jsonl",
    });

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)!;
    expect(reloaded.sessionId).toBe("3f7a1c2e-0000-4000-8000-000000000001");
    expect(reloaded.streamFile).toBe("/tmp/jobs/x.stream.jsonl");
  });

  test("a malformed sessionId is dropped, not carried — the mirror is validated, never trusted", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error("enqueue failed");
    const raw = JSON.parse(readFileSync(mirrorPath, "utf-8")) as Record<string, unknown>[];
    raw[0].sessionId = 42;
    raw[0].streamFile = { path: "/tmp/x" };
    writeFileSync(mirrorPath, JSON.stringify(raw));

    const reloaded = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get(r.job.id)!;
    expect(reloaded.sessionId).toBeUndefined();
    expect(reloaded.streamFile).toBeUndefined();
  });

});

// Which repos does this spec have a branch in RIGHT NOW? A
// spec is taken through its steps as several jobs, and each job knows
// only about the repos its own steps pushed to. The merge route needs
// the union — and never trusts the browser for it.
describe("branchesFor", () => {
  const seed = (store: QueueStore, steps: string[], branchUrls: { root: string; url: string }[]) => {
    const r = store.enqueue({ ...REQ, steps });
    if (!r.ok) throw new Error(r.error);
    store.writeUnchecked(r.job.id, { state: "done", branchUrls, startedAt: "2026-08-17T10:00:00Z" });
    return r.job.id;
  };

  test("a spec with no branch anywhere has nothing to merge", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    expect(store.branchesFor("aide", "81-queue-and-runner")).toEqual([]);
  });

  test("two jobs for one spec union their repos", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    seed(store, ["analyze"], [{ root: "/repos/aide-specs", url: "https://example.test/specs" }]);
    seed(store, ["implement"], [{ root: "/repos/aide", url: "https://example.test/aide" }]);
    expect(new Set(store.branchesFor("aide", "81-queue-and-runner"))).toEqual(
      new Set([
        { root: "/repos/aide-specs", url: "https://example.test/specs" },
        { root: "/repos/aide", url: "https://example.test/aide" },
      ]),
    );
  });

  test("when both jobs recorded the same root, the most recent one wins", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const older = store.enqueue({ ...REQ, steps: ["analyze"] });
    if (!older.ok) throw new Error(older.error);
    store.writeUnchecked(older.job.id, {
      state: "done",
      startedAt: "2026-08-17T09:00:00Z",
      branchUrls: [{ root: "/repos/aide", url: "https://example.test/old" }],
    });
    const newer = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!newer.ok) throw new Error(newer.error);
    store.writeUnchecked(newer.job.id, {
      state: "done",
      startedAt: "2026-08-17T11:00:00Z",
      branchUrls: [{ root: "/repos/aide", url: "https://example.test/new" }],
    });
    expect(store.branchesFor("aide", "81-queue-and-runner")).toEqual([
      { root: "/repos/aide", url: "https://example.test/new" },
    ]);
  });

  test("another spec's branches are not this spec's", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    seed(store, ["analyze"], [{ root: "/repos/aide", url: "https://example.test/aide" }]);
    expect(store.branchesFor("aide-dashboard", "01-first")).toEqual([]);
  });
});

// The row-level sibling of `pullRequestFor` — newest job wins,
// and a spec no job ever recorded one for reads as absent rather than as
// a claim.
describe("branchDeleteErrorFor", () => {
  test("a spec no job recorded one for has none", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    store.writeUnchecked(r.job.id, { state: "done" });
    expect(store.branchDeleteErrorFor("aide", "81-queue-and-runner")).toBeUndefined();
  });

  test("the newest job that recorded one wins", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const older = store.enqueue({ ...REQ, steps: ["analyze"] });
    if (!older.ok) throw new Error(older.error);
    store.writeUnchecked(older.job.id, {
      state: "done",
      startedAt: "2026-08-17T09:00:00Z",
      branchDeleteError: "merged, but deleting aide/81-queue-and-runner on origin failed: old reason",
    });
    const newer = store.enqueue({ ...REQ, steps: ["implement"] });
    if (!newer.ok) throw new Error(newer.error);
    store.writeUnchecked(newer.job.id, {
      state: "done",
      startedAt: "2026-08-17T11:00:00Z",
      branchDeleteError: "merged, but deleting aide/81-queue-and-runner on origin failed: new reason",
    });
    expect(store.branchDeleteErrorFor("aide", "81-queue-and-runner")).toBe(
      "merged, but deleting aide/81-queue-and-runner on origin failed: new reason",
    );
  });

  test("another spec's recorded reason is not this spec's", () => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const r = store.enqueue(REQ);
    if (!r.ok) throw new Error(r.error);
    store.writeUnchecked(r.job.id, { state: "done", branchDeleteError: "merged, but deleting failed: reason" });
    expect(store.branchDeleteErrorFor("aide-dashboard", "01-first")).toBeUndefined();
  });
});

// Two jobs for the same spec and the same step is never what anyone
// meant: it happened on 2026-08-16 when the same analyze was posted
// from the API and from the page seconds apart, and the queue took
// both without a word.
describe("the same work is not queued twice", () => {
  const queued = (extra: Record<string, unknown> = {}) => {
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const first = store.enqueue({ ...REQ, ...extra });
    if (!first.ok) throw new Error(first.error);
    return { store, first: first.job };
  };

  test("the same step on the same spec is refused while the first is unfinished", () => {
    const { store } = queued();
    const again = store.enqueue(REQ);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain("analyze");
    expect(again.error).toContain("aide:81");
  });

  test("a job that has been started still blocks — it is not finished", () => {
    const { store, first } = queued();
    store.writeUnchecked(first.id, { state: "running" });
    expect(store.enqueue(REQ).ok).toBe(false);
  });

  test("overlapping by one step is enough to refuse", () => {
    const { store } = queued({ steps: ["analyze", "implement"] });
    const again = store.enqueue({ ...REQ, steps: ["implement", "archive"] });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain("implement");
  });

  test("a different step on the same spec is fine — analyze now, implement after", () => {
    const { store } = queued({ steps: ["analyze"] });
    expect(store.enqueue({ ...REQ, steps: ["implement"] }).ok).toBe(true);
  });

  test("the same step on another spec is fine", () => {
    const { store } = queued();
    expect(store.enqueue({ project: "aide-dashboard", specFolder: "01-first", steps: ["analyze"] }).ok).toBe(true);
  });

  for (const state of ["done", "cancelled", "failed", "waiting"] as const) {
    test(`a ${state} job does not block the next one`, () => {
      const { store, first } = queued();
      store.writeUnchecked(first.id, { state });
      expect(store.enqueue(REQ).ok).toBe(true);
    });
  }
});
