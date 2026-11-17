import { afterEach, beforeEach, expect, test } from "bun:test";
import { store, enqueue, makeRunner, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
beforeEach(resetHarness);
afterEach(cleanupHarness);

test("requested priority wins over arrival order but a blocked first entry does not take a slot", () => {
  const a = enqueue();
  const b = enqueue({ specFolder: "91-parallel-spec-runs" });
  const owner = store.waiting.open("test");
  store.waiting.save(owner, owner.entries.map(entry => entry.id).reverse());
  const runner = makeRunner({ maxConcurrent: 1 });
  runner.tick({ usageLimit: new Map([[b.id, { key: "runner.notAnalyzed" }]]) });
  expect(store.get(a.id)?.state).toBe("running");
  expect(store.get(b.id)?.state).toBe("queued");
});
test("saved priority determines which ready job takes the only slot", () => {
  const a = enqueue();
  const b = enqueue({ specFolder: "91-parallel-spec-runs" });
  const owner = store.waiting.open("test");
  store.waiting.save(owner, owner.entries.map(entry => entry.id).reverse());
  makeRunner({ maxConcurrent: 1 }).tick();
  expect(store.get(b.id)?.state).toBe("running");
  expect(store.get(a.id)?.state).toBe("queued");
});
