// The board's own log says what a start spawned and why one did not
// come up (2026-09-10). Four presses of the start link had left four
// empty work directories and nothing in the log to tell which of them
// failed where, or whether the round was ever spawned at all.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import { refreshBoardStatus, startBoard, type BoardsContext } from "../../../src/serve/boards/lifecycle.ts";

let dir: string;
let lines: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-board-log-"));
  lines = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeCtx(overrides: Partial<BoardsContext> = {}): BoardsContext {
  return {
    store: new BoardStore(),
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async (_dir, args) =>
      args[0] === "ls-remote"
        ? { code: 0, stdout: "abc1234567\trefs/heads/aide/spec-1\n", stderr: "" }
        : { code: 1, stdout: "", stderr: "" },
    spawn: () => ({ pid: 4242 }),
    isAlive: () => false,
    now: () => "2026-09-10T00:00:00.000Z",
    makeWorkDir: () => dir,
    reservedPorts: () => [],
    boardOnPort: async () => undefined,
    findFreePort: async () => 8801,
    log: (line) => lines.push(line),
    ...overrides,
  };
}

describe("the board log says what a start did", () => {
  test("a spawned round is logged with branch, commit, port, pid and its log path", async () => {
    const ctx = makeCtx();
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("boards: starting aide/spec-1 @ abc1234 on :8801");
    expect(lines[0]).toContain("pid 4242");
    expect(lines[0]).toContain(join(dir, "board.log"));
  });

  test("a spawn that throws is logged with the command, and refused rather than thrown", async () => {
    const ctx = makeCtx({
      spawn: () => {
        throw new Error("EACCES");
      },
    });
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result).toEqual({ ok: false, error: "could not start the round: EACCES" });
    expect(lines[0]).toContain("boards: could not start aide/spec-1 @ abc1234 on :8801 — EACCES");
    expect(lines[0]).toContain("/checkout/aide/dashboard/test/round/run /checkout/aide --branch aide/spec-1 --port 8801 --keep");
  });

  test("a round that died before reporting an address is logged with its last line", async () => {
    const ctx = makeCtx();
    await startBoard(ctx, "aide", "spec-1");
    writeFileSync(join(dir, "board.log"), "cannot check out aide/spec-1 in a worktree\n");
    const after = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(after?.status).toBe("failed");
    expect(lines[1]).toContain("boards: aide/spec-1 did not come up on :8801 — cannot check out aide/spec-1 in a worktree");
  });

  test("a context without a log still works", async () => {
    const ctx = makeCtx({ log: undefined });
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
  });
});
