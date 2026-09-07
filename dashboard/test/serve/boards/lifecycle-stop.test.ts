// Spec 388, REQ-7: stopBoard reaches the round's whole process group by
// sending SIGTERM to the NEGATED wrapper pid — the same primitive
// job-actions.ts's own cancel route uses (`process.kill(-job.pgid, ...)`)
// — and clears the registry entry, whether the board has finished
// starting or not. `process.kill` is spied rather than real: this test
// never signals an actual process.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { BoardStore, type BoardEntry } from "../../../src/serve/boards/store.ts";
import { stopBoard, type BoardsContext } from "../../../src/serve/boards/lifecycle.ts";

let killed: { pid: number; signal: string }[];
let killSpy: ReturnType<typeof spyOn>;

function entry(overrides: Partial<BoardEntry> = {}): BoardEntry {
  return {
    branch: "aide/spec-1",
    commit: "abc123",
    port: 9000,
    wrapperPid: 4242,
    workDir: "/tmp/board",
    logPath: "/tmp/board/board.log",
    status: "starting",
    startedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function makeCtx(store: BoardStore): BoardsContext {
  return {
    store,
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: () => ({ pid: 1 }),
    isAlive: () => true,
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => "/tmp",
    reservedPorts: () => [],
    findFreePort: async () => 9000,
    boardOnPort: async () => undefined,
  };
}

beforeEach(() => {
  killed = [];
  killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string) => {
    killed.push({ pid, signal: signal ?? "" });
    return true;
  });
});

afterEach(() => {
  killSpy.mockRestore();
});

describe("stopBoard", () => {
  test("sends SIGTERM to the negated wrapper pid and clears the entry", () => {
    const store = new BoardStore();
    store.set("aide", "spec-1", entry());
    stopBoard(makeCtx(store), "aide", "spec-1");
    expect(killed).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    expect(store.get("aide", "spec-1")).toBeUndefined();
  });

  test("still reaches the process group while the board is only 'starting', with no inner pid known yet", () => {
    const store = new BoardStore();
    store.set("aide", "spec-1", entry({ status: "starting", pid: undefined }));
    stopBoard(makeCtx(store), "aide", "spec-1");
    expect(killed).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    expect(store.get("aide", "spec-1")).toBeUndefined();
  });

  test("a kill on an already-dead process group is tolerated, and the entry is still cleared", () => {
    killSpy.mockRestore();
    killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const store = new BoardStore();
    store.set("aide", "spec-1", entry());
    expect(() => stopBoard(makeCtx(store), "aide", "spec-1")).not.toThrow();
    expect(store.get("aide", "spec-1")).toBeUndefined();
  });

  test("nothing tracked for this spec is a no-op", () => {
    const store = new BoardStore();
    expect(() => stopBoard(makeCtx(store), "aide", "spec-1")).not.toThrow();
    expect(killed).toHaveLength(0);
  });
});
