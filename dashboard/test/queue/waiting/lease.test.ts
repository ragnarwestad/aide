import { expect, test } from "bun:test";
import { WaitingQueue } from "../../../src/queue/waiting";

const entry = (id: string) => ({ id, project: "p", label: id, operation: "analyze", reason: "", jobId: id });

test("acquisition pauses admission, distinguishes tabs and expires without restoring ownership", () => {
  let now = 0;
  const q = new WaitingQueue({ now: () => now });
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab-a");
  expect(q.paused).toBe(true);
  expect(() => q.open("tab-b")).toThrow();
  expect(q.open("tab-a").token).toBe(owner.token);
  expect(() => q.cancel({ ...owner, token: "foreign" })).toThrow();
  now = 30_001;
  expect(q.paused).toBe(false);
  const other = q.open("tab-b");
  expect(() => q.save(owner, ["b", "a"])).toThrow();
  expect(q.paused).toBe(true);
  q.cancel(other);
  expect(q.paused).toBe(false);
});

test("Save reconciles departed entries and arrivals without losing the draft", () => {
  const q = new WaitingQueue({});
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab");
  q.reconcile([entry("b"), entry("c")]);
  q.save(owner, ["b", "a"]);
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["b", "c"]);
  expect(q.paused).toBe(false);
});

test("malformed Save and failed persistence retain order, revision and owner for retry", () => {
  let fail = false;
  const q = new WaitingQueue({ persist: () => { if (fail) throw new Error("disk full"); } });
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab");
  expect(() => q.save(owner, ["a", "a"])).toThrow();
  expect(() => q.save(owner, ["b", "invented"])).toThrow();
  fail = true;
  expect(() => q.save(owner, ["b", "a"])).toThrow("disk full");
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["a", "b"]);
  expect(q.snapshot().revision).toBe(owner.revision);
  expect(q.renew(owner).token).toBe(owner.token);
  fail = false;
  q.save(owner, ["b", "a"]);
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["b", "a"]);
});

test("Save retry is idempotent and an old Cancel cannot release a new acquisition", () => {
  const q = new WaitingQueue({}); q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("old");
  const saved = q.save(owner, ["b", "a"]);
  expect(q.save(owner, ["b", "a"])).toEqual(saved);
  const next = q.open("new");
  expect(() => q.cancel(owner)).toThrow();
  expect(q.paused).toBe(true);
  q.cancel(next);
});
test("a failed Save leaves the old order and revision and allows Cancel", () => {
  let fail = false;
  const q = new WaitingQueue({ persist: () => { if (fail) throw new Error("disk full"); } });
  q.reconcile([entry("a"), entry("b")]); const owner = q.open("owner");
  fail = true;
  expect(() => q.save(owner, ["b", "a"])).toThrow("disk full");
  expect(q.snapshot()).toMatchObject({ revision: owner.revision, entries: [entry("a"), entry("b")] });
  expect(q.renew(owner).token).toBe(owner.token);
  q.cancel(owner); expect(q.paused).toBe(false);
});
test("a failed opening releases admission immediately", () => {
  const q = new WaitingQueue({ refresh: () => { throw new Error("unavailable"); } });
  expect(() => q.open("first")).toThrow("unavailable");
  expect(q.paused).toBe(false);
});
