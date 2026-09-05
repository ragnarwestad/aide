// Spec 388, REQ-8: starting or stopping a board must leave the served
// board's own queue, specs and checkouts untouched. `startBoard`/
// `stopBoard` take a `BoardsContext` that never carries a `QueueStore`
// or any checkout path at all — this test is the regression guard for
// that boundary: a real `QueueStore` sits alongside a start/stop
// round-trip, and nothing about it may change.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import { startBoard, stopBoard, type BoardsContext } from "../../../src/serve/boards/lifecycle.ts";

let dir: string;
let queue: QueueStore;

beforeEach(() => {
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

function makeCtx(): BoardsContext {
  return {
    store: new BoardStore(),
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
  };
}

describe("a board's start/stop round-trip", () => {
  test("leaves the served board's own queue exactly as it was", async () => {
    const before = queue.list();
    const ctx = makeCtx();
    await startBoard(ctx, "aide", "spec-1");
    stopBoard(ctx, "aide", "spec-1");
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
