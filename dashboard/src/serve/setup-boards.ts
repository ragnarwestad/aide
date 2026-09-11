// The board registry (spec 388): a test board's own store and the
// context every board lifecycle function (start, recover, sweep) reads.
// Split out of serve.ts (split serve.ts by theme, restructuring
// createServer into staged setup functions to get it under 500 lines).
//
// Built before `land`, which needs `boardsCtx` to stop a spec's board
// once its archive actually lands (REQ-7) — the same ordering
// `createServer` already followed inline.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../git/branch-status.ts";
import { BoardStore } from "./boards/store.ts";
import { findFreePort, type BoardsContext, type PortProbe, type Spawner } from "./boards/lifecycle.ts";
import { boardOnPort } from "./boards/port-owner.ts";
import type { ServerState } from "./state.ts";

export interface BoardsSetupInputs {
  boardsPath?: string;
  machineryProjectDir: (project: string) => string;
  gitRun: GitRunner;
  /** A capability check, never a hardcoded project name (REQ-1): the
   *  round only ever makes sense for a project whose own checkout
   *  carries dashboard code, which in practice is `aide` alone,
   *  self-hosting. Overridable, like `boardsSpawn`: no test should
   *  depend on which project happens to have the round checked out. */
  boardsAvailable?: boolean;
  /** A test seam, like `boardsAvailable`: no test should actually spawn
   *  a round, which takes minutes and real model spend. */
  boardsSpawn?: Spawner;
  /** A test seam, like `boardsSpawn`. */
  boardsIsAlive?: (pid: number) => boolean;
  /** A test seam, like `boardsSpawn` — the one that keeps the free-port
   *  search from depending on which of 8801-8806 this machine happens
   *  to have free. */
  boardsPortProbe?: PortProbe;
  /** A test seam, like `boardsSpawn`: the real one reads the process
   *  table. */
  boardsOnPort?: (port: number) => Promise<{ pid: number; workDir: string } | undefined>;
  /** The served board's own port, reserved before probing for a free
   *  one (REQ-10) — read off `state.server` once it exists, this
   *  fallback until then. */
  port: number;
}

export function setupBoards(state: ServerState, inputs: BoardsSetupInputs) {
  const boardStore = new BoardStore({ path: inputs.boardsPath });
  const boardsCtx: BoardsContext = {
    store: boardStore,
    aideCheckout: (project) => inputs.machineryProjectDir(project),
    roundScript: (project) => join(inputs.machineryProjectDir(project), "dashboard", "test", "round", "run"),
    roundAvailable: (project) =>
      inputs.boardsAvailable ??
      (existsSync(join(inputs.machineryProjectDir(project), "dashboard", "test", "round", "run")) &&
        existsSync(join(inputs.machineryProjectDir(project), "dashboard", "src", "serve", "serve.ts"))),
    gitRun: inputs.gitRun,
    spawn:
      inputs.boardsSpawn ??
      ((cmd, logPath) => {
        const proc = Bun.spawn({ cmd, stdio: ["ignore", Bun.file(logPath), Bun.file(logPath)], detached: true });
        proc.unref();
        return { pid: proc.pid };
      }),
    isAlive:
      inputs.boardsIsAlive ??
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
      ...boardStore.all().filter((e) => e.status !== "failed").map((e) => e.port),
    ],
    // The probe is the seam, not the search: `boardsPortProbe` lets a
    // test answer "can this port be bound" without binding anything, so
    // no test depends on which of 8801-8806 this machine happens to have
    // free. Unset in production, where the real probe binds.
    findFreePort: (reserved: number[]) => findFreePort(reserved, inputs.boardsPortProbe),
    // Reads the process table, so a board still running after a
    // restart can be found again: what holds the port, and which
    // directory it was started with. `--root <work>/root` is the round's
    // own invocation, and the work directory is what identifies it.
    boardOnPort: inputs.boardsOnPort ?? boardOnPort,
    log: (line) => console.log(line),
  };
  return { boardStore, boardsCtx };
}
