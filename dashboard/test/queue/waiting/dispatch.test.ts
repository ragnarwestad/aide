import { expect, test } from "bun:test";
import { WaitingQueue } from "../../../src/queue/waiting";
import { WaitingDispatch } from "../../../src/queue/waiting/dispatch.ts";
import { createRootLock } from "../../../src/serve/serve-helpers/config.ts";

test("ranked merge waiters reserve no roots while editing and generic edits continue", async () => {
  const q = new WaitingQueue({});
  const roots = createRootLock();
  const dispatch = new WaitingDispatch(q);
  let release!: () => void;
  const busy = roots.run("repo", () => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const calls: string[] = [];
  const a = dispatch.run({ id: "a", project: "p", label: "a", operation: "land", reason: "busy" }, roots, "repo", async () => { calls.push("a"); });
  const b = dispatch.run({ id: "b", project: "p", label: "b", operation: "land", reason: "busy" }, roots, "repo", async () => { calls.push("b"); });
  q.reconcile([{ id: "d", project: "p", label: "deploy", operation: "deploy", jobId: "d", reason: "" }]);
  const owner = q.open("editor", "d");
  release();
  await busy;
  await roots.run("repo", async () => { calls.push("edit"); });
  expect(calls).toEqual(["edit"]);
  q.save(owner, ["d", "a", "b"]);
  await Promise.all([a, b]);
  expect(calls).toEqual(["edit", "a", "b"]);
});

test("a generic queued edit excludes tryRun and cancelled work never begins", async () => {
  const q = new WaitingQueue({}); const roots = createRootLock(); const dispatch = new WaitingDispatch(q);
  let release!: () => void;
  const busy = roots.run("repo", () => new Promise<void>(resolve => { release = resolve; }));
  const edit = roots.run("repo", async () => {});
  expect(roots.tryRun("repo", async () => "wrong")).toBeUndefined();
  await Promise.resolve();
  q.reconcile([{ id: "d", project: "p", label: "deploy", operation: "deploy", jobId: "d", reason: "" }]);
  const owner = q.open("owner", "d"); let cancelled = false; let began = false;
  const work = dispatch.run({ id: "cancelled", project: "p", label: "topic", operation: "land", reason: "" }, roots, "repo", async () => { began = true; }, () => cancelled);
  const refused = work.catch(error => error.message);
  cancelled = true; release(); await busy; await edit;
  q.cancel(owner);
  expect(await refused).toContain("cancelled"); expect(began).toBe(false);
});
test("work admitted before acquisition finishes, but the next repository segment waits", async () => {
  const q = new WaitingQueue({}); const roots = createRootLock(); const dispatch = new WaitingDispatch(q);
  let release!: () => void;
  const first = dispatch.run({ id: "first", project: "p", label: "topic", operation: "land", reason: "" }, roots, "one", () => new Promise<void>(resolve => { release = resolve; }));
  q.reconcile([{ id: "d", project: "p", label: "deploy", operation: "deploy", jobId: "d", reason: "" }]);
  const owner = q.open("owner", "d"); release(); await first;
  let began = false;
  const second = dispatch.run({ id: "second", project: "p", label: "topic", operation: "land", reason: "" }, roots, "two", async () => { began = true; });
  await roots.run("two", async () => {});
  expect(began).toBe(false);
  q.cancel(owner); await second; expect(began).toBe(true);
});


import { QueueStore } from "../../../src/queue/queue.ts";
import { dispatchFor } from "../../../src/queue/waiting/dispatch.ts";
import { makeRunner, DEFAULTS, resetHarness, cleanupHarness } from "../runner/runner-fixtures.ts";
import { afterEach, beforeEach } from "bun:test";

// The runner fixtures read module-level state (clock, spawns, folder); set it
// here so these tests do not depend on another file in the same process.
beforeEach(resetHarness);
afterEach(cleanupHarness);

test("a saved Deploy boundary controls actual merge admission and active multi-root completion (AC-4, AC-6)", async () => {
  const store = new QueueStore({ defaults: DEFAULTS, resolve: () => ({ specFolders: ["a", "b"] }) });
  const add = (specFolder: string, steps: string[]) => { const r = store.enqueue({ project: "p", specFolder, steps }); if (!r.ok) throw Error(r.error); return r.job; };
  const landing = add("a", ["analyze"]);
  store.update(landing.id, { state: "done", landing: true });
  const deploy = add("deploy", ["deploy"]);
  const roots = createRootLock();
  const dispatch = dispatchFor(store.waiting);
  const calls: string[] = [];
  let finish!: () => void;
  const entry = { id: "merge:first", jobId: landing.id, project: "p", label: "a", operation: "land", reason: "" };
  const merge = dispatch.run(entry, roots, "one", () => new Promise<void>(resolve => { calls.push("first"); finish = resolve; }));
  const owner = store.waiting.open("edit", `job:${deploy.id}:0`);
  store.waiting.save(owner, owner.entries.map(e => e.id));
  // Deploy precedes the not-yet-admitted merge, so the dispatcher must leave it pending.
  expect(calls).toEqual([]);
  store.update(deploy.id, { state: "cancelled" });
  dispatch.drain();
  expect(calls).toEqual(["first"]);
  const nextDeploy = add("deploy", ["deploy"]);
  const runner = makeRunner({ store });
  runner.tick();
  expect(store.get(nextDeploy.id)?.state).toBe("queued");
  finish(); await merge;
  await dispatch.run({ ...entry, id: "merge:second" }, roots, "two", async () => { calls.push("second"); });
  runner.tick();
  expect(store.get(nextDeploy.id)?.state).toBe("queued");
  store.update(landing.id, { landing: false });
  runner.tick();
  expect(store.get(nextDeploy.id)?.state).toBe("running");
  expect(calls).toEqual(["first", "second"]);
});


test("an earlier merge is admitted before Deploy on the same tick (AC-1, AC-4, AC-6)", async () => {
  const store = new QueueStore({ defaults: DEFAULTS, resolve: () => ({ specFolders: ["a"] }) });
  const landing = store.enqueue({ project: "p", specFolder: "a", steps: ["analyze"] });
  if (!landing.ok) throw Error(landing.error);
  store.update(landing.job.id, { state: "done", landing: true });
  const roots = createRootLock(); const dispatch = dispatchFor(store.waiting);
  let releaseRoot!: () => void; let releaseMerge!: () => void;
  const busy = roots.run("repo", () => new Promise<void>(resolve => { releaseRoot = resolve; }));
  await Promise.resolve();
  const work = dispatch.run({ id: "merge:earlier", jobId: landing.job.id, project: "p", label: "a", operation: "land", reason: "" }, roots, "repo", () => new Promise<void>(resolve => { releaseMerge = resolve; }));
  const d = store.enqueue({ project: "p", specFolder: "deploy", steps: ["deploy"] });
  if (!d.ok) throw Error(d.error);
  const runner = makeRunner({ store }); runner.tick();
  expect(store.get(d.job.id)?.state).toBe("queued");
  releaseRoot(); await busy;
  runner.tick(); expect(store.get(d.job.id)?.state).toBe("queued");
  releaseMerge(); await work;
  store.update(landing.job.id, { landing: false });
  runner.tick(); expect(store.get(d.job.id)?.state).toBe("running");
});
