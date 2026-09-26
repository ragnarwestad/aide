// A restart after a Deploy does not wait for a wiki build: every archive
// starts one, and a Deploy pressed after an archive waited minutes on it.
// The build is stopped and queued again instead, so it runs once the
// dashboard is back.

import { describe, expect, test } from "bun:test";
import { requeueWikiBuilds, restartAfterLanding, runningJobNames } from "../../../../src/serve/land-branch";
import { createRootLock } from "../../../../src/serve/serve.ts";
import { makeStore, runningJob } from "../../../push/fixtures.ts";

describe("a wiki build at a restart", () => {
  test("is not among the jobs a restart waits for", () => {
    const store = makeStore();
    runningJob(store, ["wiki"], "wiki-aide");
    const spec = runningJob(store, ["implement"]);
    expect(runningJobNames(store)).toEqual([`aide:${spec.specFolder}`]);
  });

  test("is stopped and queued again as the same kind of build, and a spec's job is left alone", () => {
    const store = makeStore();
    const wiki = runningJob(store, ["wiki"], "wiki-aide");
    store.update(wiki.id, { wikiRefresh: true, pgid: 4242 });
    const spec = runningJob(store, ["implement"]);
    const signalled: unknown[] = [];
    requeueWikiBuilds(store, (pgid) => signalled.push(pgid));
    expect(store.get(wiki.id)!.state).toBe("cancelled");
    expect(signalled).toEqual([4242]);
    const again = store.list().filter((j) => j.specFolder === "wiki-aide" && j.state === "queued");
    expect(again).toHaveLength(1);
    expect(again[0]!.wikiRefresh).toBe(true);
    expect(store.get(spec.id)!.state).toBe("running");
  });

  test("the restart stops it just before it fires, not while it waits", async () => {
    const order: string[] = [];
    await restartAfterLanding({
      mergeLock: createRootLock(),
      restart: { registered: async () => true, fire: () => order.push("fire") },
      queue: { list: () => [] },
      beforeRestart: () => order.push("requeue"),
    });
    expect(order).toEqual(["requeue", "fire"]);
  });
});
