import { afterEach, beforeEach, expect, test } from "bun:test";
import { store, enqueue, makeRunner, resetHarness, cleanupHarness, spawns } from "./runner-fixtures.ts";
beforeEach(resetHarness);
afterEach(cleanupHarness);

test("requested priority wins over arrival order but a blocked first entry does not take a slot", () => {
  const a = enqueue();
  const b = enqueue({ specFolder: "91-parallel-spec-runs" });
  const d = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  const owner = store.waiting.open("test", `job:${d.id}:0`);
  store.waiting.save(owner, owner.entries.map(entry => entry.id));
  const runner = makeRunner({ maxConcurrent: 1 });
  runner.tick({ usageLimit: new Map([[a.id, { key: "runner.notAnalyzed" }]]) });
  expect(store.get(b.id)?.state).toBe("running");
  expect(store.get(a.id)?.state).toBe("queued");
});
test("saved priority determines which ready job takes the only slot (AC-4)", () => {
  const a = enqueue();
  const b = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  const owner = store.waiting.open("test", `job:${b.id}:0`);
  store.waiting.save(owner, owner.entries.map(entry => entry.id).reverse());
  makeRunner({ maxConcurrent: 1 }).tick();
  expect(store.get(b.id)?.state).toBe("running");
  expect(spawns.map(s => s.jobId)).toEqual([b.id, a.id]);
});

for (const landing of [false, true]) test(`successors join after arrivals without page reads, landing=${landing} (AC-1, AC-2)`, () => {
  const a = enqueue({ steps: ["analyze", "implement", "archive"] });
  store.writeUnchecked(a.id, { state: "running" });
  expect(store.waiting.snapshot().entries).toEqual([]);
  const b = enqueue({ specFolder: "91-parallel-spec-runs" });
  const c = enqueue({ project: "other-project" });
  store.writeUnchecked(a.id, { state: "queued", stepIndex: 1, landing });
  if (landing) {
    expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([b.id, c.id]);
    store.update(a.id, { landing: false });
  }
  expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([b.id, c.id, a.id]);
  const runner = makeRunner({ maxConcurrent: 1 });
  runner.tick();
  expect(store.get(b.id)?.state).toBe("running");
  expect(store.get(a.id)?.state).toBe("queued");
  store.writeUnchecked(b.id, { state: "done" });
  runner.tick();
  expect(store.get(c.id)?.state).toBe("running");
});


test("new Deploy appends and does not hold an earlier Land (AC-1)", () => {
  const land = enqueue({ specFolder: "land", steps: ["land"], branch: "topic" });
  const deploy = enqueue({ specFolder: "deploy", steps: ["deploy"] });
  expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([land.id, deploy.id]);
  makeRunner({ maxConcurrent: 1 }).tick();
  expect(store.get(land.id)?.state).toBe("running");
});
