import { expect, test } from "bun:test";
import { WaitingQueue } from "../../../src/queue/waiting";

const entry = (id: string) => ({ id, project: "p", label: id, operation: id === "b" ? "deploy" : "analyze", reason: "", jobId: id });

test("acquisition pauses admission, distinguishes tabs and expires without restoring ownership (AC-5)", () => {
  let now = 0;
  const q = new WaitingQueue({ now: () => now });
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab-a", "b");
  expect(q.paused).toBe(true);
  expect(() => q.open("tab-b", "b")).toThrow();
  expect(q.open("tab-a", "b").token).toBe(owner.token);
  expect(() => q.cancel({ ...owner, token: "foreign" })).toThrow();
  now = 30_001;
  expect(q.paused).toBe(false);
  const other = q.open("tab-b", "b");
  expect(() => q.save(owner, ["b", "a"])).toThrow();
  expect(q.paused).toBe(true);
  q.cancel(other);
  expect(q.paused).toBe(false);
});

test("Save reconciles departed entries and arrivals without losing the draft", () => {
  const q = new WaitingQueue({});
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab", "b");
  q.reconcile([entry("b"), entry("c")]);
  q.save(owner, ["b", "a"]);
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["b", "c"]);
  expect(q.paused).toBe(false);
});

test("malformed Save and failed persistence retain order, revision and owner for retry", () => {
  let fail = false;
  const q = new WaitingQueue({ persist: () => { if (fail) throw new Error("disk full"); } });
  q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("tab", "b");
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
  const owner = q.open("old", "b");
  const saved = q.save(owner, ["b", "a"]);
  expect(q.save(owner, ["b", "a"])).toEqual(saved);
  const next = q.open("new", "b");
  expect(() => q.cancel(owner)).toThrow();
  expect(q.paused).toBe(true);
  q.cancel(next);
});
test("a failed Save leaves the old order and revision and allows Cancel", () => {
  let fail = false;
  const q = new WaitingQueue({ persist: () => { if (fail) throw new Error("disk full"); } });
  q.reconcile([entry("a"), entry("b")]); const owner = q.open("owner", "b");
  fail = true;
  expect(() => q.save(owner, ["b", "a"])).toThrow("disk full");
  expect(q.snapshot()).toMatchObject({ revision: owner.revision, entries: [entry("a"), entry("b")] });
  expect(q.renew(owner).token).toBe(owner.token);
  q.cancel(owner); expect(q.paused).toBe(false);
});
test("a failed opening releases admission immediately", () => {
  const q = new WaitingQueue({ refresh: () => { throw new Error("unavailable"); } });
  expect(() => q.open("first", "b")).toThrow("unavailable");
  expect(q.paused).toBe(false);
});


test("only the selected Deploy can cross predecessors; successors and arrivals remain behind it (AC-3, AC-4)", () => {
  const q = new WaitingQueue({});
  q.reconcile([entry("a"), entry("x"), entry("b"), entry("c")]);
  const owner = q.open("editor", "b");
  expect(() => q.save(owner, ["x", "a", "b", "c"])).toThrow();
  expect(() => q.save(owner, ["a", "x", "c", "b"])).toThrow();
  q.reconcile([entry("a"), entry("b"), entry("c"), entry("new")]);
  const refreshed = q.renew(owner);
  expect(() => q.save({ ...refreshed, snapshotIds: refreshed.entries.map(e => e.id) }, ["a", "c", "b", "new"])).toThrow();
  q.save({ ...refreshed, snapshotIds: refreshed.entries.map(e => e.id) }, ["b", "a", "c", "new"]);
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["b", "a", "c", "new"]);
});
test("opening refuses non-Deploy and removed targets without pausing admission (AC-7)", () => {
  const q = new WaitingQueue({}); q.reconcile([entry("a"), entry("b")]);
  expect(() => q.open("spec", "a")).toThrow();
  expect(() => q.open("gone", "missing")).toThrow();
  expect(q.paused).toBe(false);
  const owner = q.open("deploy", "b");
  expect(() => q.open("deploy", "a")).toThrow();
  q.reconcile([entry("a")]);
  expect(() => q.save(owner, ["b", "a"])).toThrow();
  q.cancel(owner);
});
test("Cancel and expiry preserve saved order and revision (AC-5)", () => {
  let now = 0;
  const q = new WaitingQueue({ now: () => now }); q.reconcile([entry("a"), entry("b")]);
  const before = q.snapshot(); const owner = q.open("cancel", "b");
  q.cancel(owner); expect(q.snapshot()).toEqual(before);
  q.open("expire", "b"); now = 30_001;
  expect(q.paused).toBe(false); expect(q.snapshot()).toEqual(before);
});


test("renewal never widens the opening boundary after removals and arrivals (AC-3)", () => {
  const q = new WaitingQueue({});
  q.reconcile([entry("a"), entry("b"), entry("c")]);
  const owner = q.open("editor", "b");
  expect(() => q.open("editor", "a")).toThrow();
  q.reconcile([entry("b"), entry("new")]);
  const renewed = q.renew(owner);
  expect(renewed.openingIds).toEqual(["a", "b", "c"]);
  const credential = { ...renewed, snapshotIds: renewed.entries.map(e => e.id), openingIds: ["new", "b"] };
  expect(() => q.save(credential, ["new", "b"])).toThrow();
  expect(q.snapshot().revision).toBe(owner.revision);
  q.cancel(owner);
});

test("a vanished target cannot save an old issued snapshot (AC-3, AC-5)", () => {
  const q = new WaitingQueue({}); q.reconcile([entry("a"), entry("b")]);
  const owner = q.open("editor", "b");
  q.reconcile([entry("a")]);
  expect(() => q.save(owner, ["b", "a"])).toThrow();
  expect(q.snapshot()).toMatchObject({ revision: owner.revision, entries: [entry("a")] });
  q.cancel(owner);
});
