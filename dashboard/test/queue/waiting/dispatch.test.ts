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
  const owner = q.open("editor");
  release();
  await busy;
  await roots.run("repo", async () => { calls.push("edit"); });
  expect(calls).toEqual(["edit"]);
  q.save(owner, ["b", "a"]);
  await Promise.all([a, b]);
  expect(calls).toEqual(["edit", "b", "a"]);
});

test("a generic queued edit excludes tryRun and cancelled work never begins", async () => {
  const q = new WaitingQueue({}); const roots = createRootLock(); const dispatch = new WaitingDispatch(q);
  let release!: () => void;
  const busy = roots.run("repo", () => new Promise<void>(resolve => { release = resolve; }));
  const edit = roots.run("repo", async () => {});
  expect(roots.tryRun("repo", async () => "wrong")).toBeUndefined();
  await Promise.resolve();
  const owner = q.open("owner"); let cancelled = false; let began = false;
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
  const owner = q.open("owner"); release(); await first;
  let began = false;
  const second = dispatch.run({ id: "second", project: "p", label: "topic", operation: "land", reason: "" }, roots, "two", async () => { began = true; });
  await roots.run("two", async () => {});
  expect(began).toBe(false);
  q.cancel(owner); await second; expect(began).toBe(true);
});
