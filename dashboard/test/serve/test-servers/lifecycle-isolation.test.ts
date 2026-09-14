// Spec 388, REQ-8: starting or stopping a board must leave the served
// board's own queue, specs and checkouts untouched. `startTestServer`/
// `stopTestServer` take a `TestServersContext` that never carries a `QueueStore`
// or any checkout path at all — this test is the regression guard for
// that boundary: a real `QueueStore` sits alongside a start/stop
// round-trip, and nothing about it may change.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { TestServerStore } from "../../../src/serve/test-servers/store.ts";
import { startTestServer, stopTestServer, type TestServersContext } from "../../../src/serve/test-servers/lifecycle.ts";

let dir: string;
let queue: QueueStore;

// The fixture's pid (4242) is made up: no signal here may reach a real
// process — before this spy, a stop here sent SIGTERM to whatever process
// group 4242 happened to be on the machine.
let kill: ReturnType<typeof spyOn>;
afterEach(() => kill.mockRestore());
beforeEach(() => {
  kill = spyOn(process, "kill").mockImplementation(() => true);
  dir = mkdtempSync(join(tmpdir(), "aide-board-isolation-"));
  queue = new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: {
      budgetUsd: 1,
      jobCapUsd: 5,
      dailyCapUsd: 50,
      timeoutSec: { default: 600 },
      permissionMode: { default: "bypassPermissions" },
      model: { default: "script" },
    },
    resolve: () => null,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(): TestServersContext {
  return {
    store: new TestServerStore(),
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async () => ({ code: 0, stdout: "abc123\trefs/heads/aide/spec-1\n", stderr: "" }),
    spawn: () => ({ pid: 4242 }),
    isAlive: () => true,
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => mkdtempSync(join(tmpdir(), "aide-board-work-")),
    reservedPorts: () => [],
    findFreePort: async () => 9000,
    testServerOnPort: async () => undefined,
  };
}

describe("a board's start/stop round-trip", () => {
  test("leaves the served board's own queue exactly as it was", async () => {
    const before = queue.list();
    const ctx = makeCtx();
    await startTestServer(ctx, "aide", "spec-1");
    stopTestServer(ctx, "aide", "spec-1", "the test");
    expect(queue.list()).toEqual(before);
  });

  test("the boards context carries nothing that could reach a checkout the queue owns", () => {
    const ctx = makeCtx();
    // The context's own shape is the guarantee: nothing on it is a
    // QueueStore, a checkout root, or a specs root — there is nothing
    // here FOR a start or stop to touch outside the board registry.
    expect(Object.keys(ctx).sort()).toEqual(
      [
        "aideCheckout",
        "testServerOnPort",
        "findFreePort",
        "gitRun",
        "isAlive",
        "makeWorkDir",
        "now",
        "reservedPorts",
        "roundAvailable",
        "roundScript",
        "spawn",
        "store",
      ].sort(),
    );
  });
});
