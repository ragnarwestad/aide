// The board registry (spec 388): a test board's own store and the
// context every board lifecycle function (start, recover, sweep) reads.
// Split out of serve.ts (split serve.ts by theme, restructuring
// createServer into staged setup functions to get it under 500 lines).
//
// Built before `land`, which needs `testServersCtx` to stop a spec's board
// once its archive actually lands (REQ-7) — the same ordering
// `createServer` already followed inline.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../git/branch-status.ts";
import { TestServerStore } from "./test-servers/store.ts";
import { findFreePort, type TestServersContext, type PortProbe, type Spawner } from "./test-servers/lifecycle.ts";
import { testServerOnPort } from "./test-servers/port-owner.ts";
import type { ServerState } from "./state.ts";

export interface TestServersSetupInputs {
  testServersPath?: string;
  machineryProjectDir: (project: string) => string;
  gitRun: GitRunner;
  /** A capability check, never a hardcoded project name (REQ-1): the
   *  round only ever makes sense for a project whose own checkout
   *  carries dashboard code, which in practice is `aide` alone,
   *  self-hosting. Overridable, like `testServersSpawn`: no test should
   *  depend on which project happens to have the round checked out. */
  testServersAvailable?: boolean;
  /** A test seam, like `testServersAvailable`: no test should actually spawn
   *  a round, which takes minutes and real model spend. */
  testServersSpawn?: Spawner;
  /** A test seam, like `testServersSpawn`. */
  testServersIsAlive?: (pid: number) => boolean;
  /** A test seam, like `testServersSpawn` — the one that keeps the free-port
   *  search from depending on which of 8801-8806 this machine happens
   *  to have free. */
  testServersPortProbe?: PortProbe;
  /** A test seam, like `testServersSpawn`: the real one reads the process
   *  table. */
  testServersOnPort?: (port: number) => Promise<{ pid: number; workDir: string } | undefined>;
  /** The served board's own port, reserved before probing for a free
   *  one (REQ-10) — read off `state.server` once it exists, this
   *  fallback until then. */
  port: number;
}

export function setupTestServers(state: ServerState, inputs: TestServersSetupInputs) {
  const testServerStore = new TestServerStore({ path: inputs.testServersPath });
  const testServersCtx: TestServersContext = {
    store: testServerStore,
    aideCheckout: (project) => inputs.machineryProjectDir(project),
    roundScript: (project) => join(inputs.machineryProjectDir(project), "dashboard", "test", "round", "run"),
    roundAvailable: (project) =>
      inputs.testServersAvailable ??
      (existsSync(join(inputs.machineryProjectDir(project), "dashboard", "test", "round", "run")) &&
        existsSync(join(inputs.machineryProjectDir(project), "dashboard", "src", "serve", "serve.ts"))),
    gitRun: inputs.gitRun,
    spawn:
      inputs.testServersSpawn ??
      ((cmd, logPath) => {
        const proc = Bun.spawn({ cmd, stdio: ["ignore", Bun.file(logPath), Bun.file(logPath)], detached: true });
        proc.unref();
        return { pid: proc.pid };
      }),
    isAlive:
      inputs.testServersIsAlive ??
      ((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }),
    now: () => new Date().toISOString(),
    makeWorkDir: () => mkdtempSync(join(tmpdir(), "aide-board-")),
    // REQ-10: the served board's own port, plus every OTHER tracked
    // board's port — a `failed` entry no longer holds anything.
    reservedPorts: () => [
      state.server?.port ?? inputs.port,
      ...testServerStore.all().filter((e) => e.status !== "failed").map((e) => e.port),
    ],
    // The probe is the seam, not the search: `testServersPortProbe` lets a
    // test answer "can this port be bound" without binding anything, so
    // no test depends on which of 8801-8806 this machine happens to have
    // free. Unset in production, where the real probe binds.
    findFreePort: (reserved: number[]) => findFreePort(reserved, inputs.testServersPortProbe),
    // Reads the process table, so a board still running after a
    // restart can be found again: what holds the port, and which
    // directory it was started with. `--root <work>/root` is the round's
    // own invocation, and the work directory is what identifies it.
    testServerOnPort: inputs.testServersOnPort ?? testServerOnPort,
    log: (line) => console.log(line),
  };
  return { testServerStore, testServersCtx };
}
