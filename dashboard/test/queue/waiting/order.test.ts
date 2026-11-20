import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WaitingQueue } from "../../../src/queue/waiting";
const entries = ["a", "b"].map(id => ({ id, project: "p", label: id, operation: id === "b" ? "deploy" : "land", jobId: id, reason: "" }));
test("saved priority survives restart but editing ownership does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-"));
  try {
    const path = join(dir, "order.json");
    const q = new WaitingQueue({ path });
    q.reconcile(entries);
    const owner = q.open("first", "b");
    q.save(owner, ["b", "a"]);
    const next = new WaitingQueue({ path });
    next.reconcile(entries);
    expect(next.snapshot().entries.map(e => e.id)).toEqual(["b", "a"]);
    expect(next.paused).toBe(false);
    next.open("new", "b");
    expect(() => next.cancel(owner)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("storage refuses a failed atomic rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-"));
  try {
    const path = join(dir, "order.json");
    const q = new WaitingQueue({ path });
    q.reconcile(entries);
    const owner = q.open("first", "b");
    rmSync(path);
    mkdirSync(path);
    expect(() => q.save(owner, ["b", "a"])).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { QueueStore } from "../../../src/queue/queue.ts";
import { makeRunner, setNow, DEFAULTS } from "../runner/runner-fixtures.ts";

for (const refused of [false, true]) test(`saved reservations are pruned while unresolved archive survives Save and restart, refused=${refused} (AC-5)`, () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-migration-"));
  const mirrorPath = join(dir, "queue.json");
  const path = join(dir, "waiting-order.json");
  const make = () => new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve: () => ({ specFolders: ["1-a", "2-b", "3-c"] }) });
  try {
    let store = make();
    const add = (folder: string, steps: string[]) => {
      const r = store.enqueue({ project: "aide", specFolder: folder, steps });
      if (!r.ok) throw new Error(r.error);
      return r.job;
    };
    const a = add("1-a", ["analyze", "implement"]);
    const archive = add("2-b", ["archive"]);
    const c = add("deploy", ["deploy"]);
    const ids = [`job:${a.id}:0`, `job:${archive.id}:0`, `job:${c.id}:0`];
    writeFileSync(path, JSON.stringify({ revision: 1, order: [ids[2], `job:${a.id}:1`, ids[1], "group:missing:future:analyze", ids[0]] }));
    store = make();
    expect(JSON.parse(readFileSync(path, "utf8")).order).toEqual([ids[2], ids[1], ids[0]]);
    const owner = store.waiting.open("edit", ids[2]!);
    expect(owner.entries.map(e => e.id)).toEqual([ids[2], ids[0]]);
    expect(() => store.waiting.save(owner, [...owner.entries.map(e => e.id), ids[1]!])).toThrow();
    store.waiting.save(owner, owner.entries.map(e => e.id));
    expect(JSON.parse(readFileSync(path, "utf8")).order).toEqual([ids[2], ids[1], ids[0]]);
    store = make();
    setNow(Date.parse("2026-11-18T10:00:00Z"));
    const runner = makeRunner({ store, maxConcurrent: 1 });
    const edit = store.waiting.open("hold dispatch", ids[2]!);
    runner.tick({ acceptanceOpen: new Set(refused ? [archive.id] : []) });
    expect(store.waiting.snapshot().entries.map(e => e.id)).toEqual(refused ? [ids[2], ids[0]] : [ids[2], ids[1], ids[0]]);
    store.waiting.cancel(edit);
    expect(JSON.parse(readFileSync(path, "utf8")).order).toEqual(refused ? [ids[2], ids[0]] : [ids[2], ids[1], ids[0]]);
    store = make();
    expect(store.waiting.snapshot().entries.map(e => e.id)).toEqual([ids[2], ids[0]]);
    expect(JSON.parse(readFileSync(path, "utf8")).order).toEqual(refused ? [ids[2], ids[0]] : [ids[2], ids[1], ids[0]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("admission reports failed persistence instead of claiming the new order (AC-5)", () => {
  let fail = false;
  const q = new WaitingQueue({ persist: () => { if (fail) throw new Error("disk unavailable"); } });
  q.reconcile([entries[0]!]);
  fail = true;
  expect(() => q.reconcile(entries)).toThrow("disk unavailable");
  fail = false;
  q.reconcile(entries);
  expect(q.snapshot().entries.map(e => e.id)).toEqual(["a", "b"]);
});

test("startup drops a successor reservation while its predecessor's landing must resume (AC-1, AC-5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "waiting-cut-landing-"));
  const mirrorPath = join(dir, "queue.json");
  const path = join(dir, "waiting-order.json");
  const make = () => new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve: () => ({ specFolders: ["1-a", "2-b"] }) });
  try {
    let store = make();
    const a = store.enqueue({ project: "aide", specFolder: "1-a", steps: ["analyze", "implement"] });
    const b = store.enqueue({ project: "aide", specFolder: "2-b", steps: ["analyze"] });
    if (!a.ok || !b.ok) throw new Error("enqueue failed");
    store.update(a.job.id, { state: "queued", stepIndex: 1, landing: true });
    writeFileSync(path, JSON.stringify({ revision: 0, order: [`job:${a.job.id}:1`, `job:${b.job.id}:0`] }));
    store = make();
    expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([b.job.id]);
    expect(JSON.parse(readFileSync(path, "utf8")).order).toEqual([`job:${b.job.id}:0`]);
    store.update(a.job.id, { landingCut: undefined });
    expect(store.waiting.snapshot().entries.map(e => e.jobId)).toEqual([b.job.id, a.job.id]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("a saved Deploy position controls actual starts after restart (AC-1, AC-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-order-"));
  const mirrorPath = join(dir, "queue.json");
  const make = () => new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve: () => ({ specFolders: ["a", "b"] }) });
  try {
    let store = make();
    const add = (specFolder: string, steps: string[]) => { const r = store.enqueue({ project: "p", specFolder, steps }); if (!r.ok) throw Error(r.error); return r.job; };
    const first = add("a", ["analyze"]);
    const second = add("b", ["analyze"]);
    const deploy = add("deploy", ["deploy"]);
    const owner = store.waiting.open("edit", `job:${deploy.id}:0`);
    store.waiting.save(owner, [`job:${first.id}:0`, `job:${deploy.id}:0`, `job:${second.id}:0`]);
    store = make();
    const starts: string[] = [];
    makeRunner({ store, maxConcurrent: 2, spawn: job => ({ providers: {}, start: () => { starts.push(job.id); return { pid: 100, pgid: 100 }; } }) }).tick();
    expect(starts).toEqual([first.id, deploy.id, second.id]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
