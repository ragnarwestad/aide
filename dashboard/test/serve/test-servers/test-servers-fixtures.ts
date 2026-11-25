// A test-servers context that starts nothing real: one checkout, a round
// command, git answering nothing, every pid alive, and port 9000 free.
import { TestServerStore } from "../../../src/serve/test-servers/store.ts";
import type { TestServersContext } from "../../../src/serve/test-servers/lifecycle.ts";

/** Every field `TestServersContext` needs, with `store` and `overrides`
 *  merged over the defaults. */
export function testServersCtx(
  store: TestServerStore = new TestServerStore(),
  overrides: Partial<TestServersContext> = {},
): TestServersContext {
  return {
    store,
    aideCheckout: () => "/checkout/aide",
    startCommand: (_p, { branch, port }) => [
      "/checkout/aide/dashboard/test/round/run", "/checkout/aide",
      "--branch", branch, "--port", String(port), "--keep",
    ],
    previewAvailable: () => true,
    gitRun: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: () => ({ pid: 1 }),
    isAlive: () => true,
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => "/tmp",
    reservedPorts: () => [],
    findFreePort: async () => 9000,
    testServerOnPort: async () => undefined,
    portExposed: async () => true,
    ...overrides,
  };
}
