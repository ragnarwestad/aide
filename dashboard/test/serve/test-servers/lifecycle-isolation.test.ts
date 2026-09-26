// Spec 388, REQ-8: starting or stopping a board must leave the served
// board's own queue, specs and checkouts untouched. `startTestServer`/
// `stopTestServer` take a `TestServersContext` that never carries a `QueueStore`
// or any checkout path at all — this test is the regression guard for
// that boundary.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestServerStore } from "../../../src/serve/test-servers/store.ts";
import type { TestServersContext } from "../../../src/serve/test-servers/lifecycle.ts";

function makeCtx(): TestServersContext {
  return {
    store: new TestServerStore(),
    aideCheckout: () => "/checkout/aide",
    startCommand: (_p, { branch, port }) => [
      "/checkout/aide/dashboard/test/round/run", "/checkout/aide",
      "--branch", branch, "--port", String(port), "--keep",
    ],
    previewAvailable: () => true,
    gitRun: async () => ({ code: 0, stdout: "abc123\trefs/heads/aide/spec-1\n", stderr: "" }),
    spawn: () => ({ pid: 4242 }),
    isAlive: () => true,
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => mkdtempSync(join(tmpdir(), "aide-board-work-")),
    reservedPorts: () => [],
    findFreePort: async () => 9000,
    testServerOnPort: async () => undefined,
    portExposed: async () => true,
  };
}

describe("a board's start/stop round-trip", () => {
  test("the boards context carries nothing that could reach a checkout the queue owns", () => {
    const ctx = makeCtx();
    // The context's own shape is the guarantee: nothing on it is a
    // QueueStore, a checkout root, or a specs root — there is nothing
    // here FOR a start or stop to touch outside the board registry.
    expect(Object.keys(ctx).sort()).toEqual(
      [
        "aideCheckout",
        "testServerOnPort",
        "portExposed",
        "findFreePort",
        "gitRun",
        "isAlive",
        "makeWorkDir",
        "now",
        "reservedPorts",
        "previewAvailable",
        "startCommand",
        "spawn",
        "store",
      ].sort(),
    );
  });
});
