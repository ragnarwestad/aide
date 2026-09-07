// Spec 388: starting a board wraps the round script exactly as a
// terminal user does — every assertion here is against a FAKE spawn/
// isAlive/gitRun, the same seam `runner-fixtures.ts` uses so a spawn/
// kill test never touches a real process.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import { refreshBoardStatus, startBoard, type BoardsContext, type SpawnResult } from "../../../src/serve/boards/lifecycle.ts";

let dir: string;
let spawnCalls: { cmd: string[]; logPath: string }[];
let spawnResult: SpawnResult;
let alive: Set<number>;

function makeCtx(overrides: Partial<BoardsContext> = {}): BoardsContext {
  return {
    store: new BoardStore(),
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async (_dir, args) => {
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc123\trefs/heads/aide/spec-1\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "" };
    },
    spawn: (cmd, logPath) => {
      spawnCalls.push({ cmd, logPath });
      return spawnResult;
    },
    isAlive: (pid) => alive.has(pid),
    now: () => "2026-09-05T00:00:00.000Z",
    makeWorkDir: () => mkdtempSync(join(tmpdir(), "aide-board-test-")),
    reservedPorts: () => [],
    findFreePort: async (reserved) => {
      let port = 9000;
      while (reserved.includes(port)) port++;
      return port;
    },
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-board-lifecycle-"));
  spawnCalls = [];
  spawnResult = { pid: 4242 };
  alive = new Set([4242]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("startBoard", () => {
  test("invokes the round script with --branch/--port/--keep", async () => {
    const ctx = makeCtx();
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toEqual([
      "/checkout/aide/dashboard/test/round/run",
      "/checkout/aide",
      "--branch",
      "aide/spec-1",
      "--port",
      "9000",
      "--keep",
    ]);
    if (result.ok) {
      expect(result.entry.status).toBe("starting");
      expect(result.entry.wrapperPid).toBe(4242);
      expect(result.entry.branch).toBe("aide/spec-1");
      expect(result.entry.commit).toBe("abc123");
    }
  });

  test("REQ-6: a second call for the same branch and commit returns the existing board instead of spawning again", async () => {
    const ctx = makeCtx();
    const first = await startBoard(ctx, "aide", "spec-1");
    const second = await startBoard(ctx, "aide", "spec-1");
    expect(spawnCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test("a branch that has moved to a new commit starts a fresh board", async () => {
    const ctx = makeCtx();
    await startBoard(ctx, "aide", "spec-1");
    const movedCtx = makeCtx({
      gitRun: async () => ({ code: 0, stdout: "def456\trefs/heads/aide/spec-1\n", stderr: "" }),
      store: ctx.store,
    });
    spawnResult = { pid: 5252 };
    const second = await startBoard(movedCtx, "aide", "spec-1");
    expect(spawnCalls).toHaveLength(2);
    expect(second.ok && second.entry.commit).toBe("def456");
  });

  test("REQ-10: the port never collides with the served board's own port or another tracked board's port", async () => {
    const store = new BoardStore();
    store.set("aide", "spec-0", {
      branch: "aide/spec-0",
      commit: "zzz",
      port: 9000,
      wrapperPid: 1,
      workDir: dir,
      logPath: join(dir, "board.log"),
      status: "running",
      startedAt: "2026-09-05T00:00:00.000Z",
    });
    const ctx = makeCtx({
      store,
      reservedPorts: () => [9000, 9001, ...store.all().map((e) => e.port)],
    });
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toContain("9002");
  });

  test("no board control possible when the round is unavailable on this host", async () => {
    const ctx = makeCtx({ roundAvailable: () => false });
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result).toEqual({ ok: false, error: "the round is not available on this host" });
    expect(spawnCalls).toHaveLength(0);
  });

  test("a branch absent on origin refuses without spawning", async () => {
    const ctx = makeCtx({ gitRun: async () => ({ code: 1, stdout: "", stderr: "" }) });
    const result = await startBoard(ctx, "aide", "spec-1");
    expect(result.ok).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe("refreshBoardStatus", () => {
  test("REQ-4: parses the round's own 'left running' line into a running board", async () => {
    const ctx = makeCtx();
    const started = await startBoard(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startBoard to succeed");
    writeFileSync(
      started.entry.logPath,
      "== queue the specs\nleft running: pid 4242, http://127.0.0.1:9000/?token=t — serving aide/spec-1 @ abc123 (fixtures), /tmp/x\n",
    );
    const refreshed = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("running");
    expect(refreshed?.pid).toBe(4242);
    expect(refreshed?.url).toBe("http://127.0.0.1:9000/?token=t");
  });

  test("a dead wrapper process before the round ever reported up is a failed board", async () => {
    const ctx = makeCtx();
    const started = await startBoard(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startBoard to succeed");
    writeFileSync(started.entry.logPath, "some early output\ncannot check out aide/spec-1: already checked out\n");
    alive.clear();
    const refreshed = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("cannot check out");
  });

  test("still starting while the process is alive and no 'left running' line has appeared yet", async () => {
    const ctx = makeCtx();
    const started = await startBoard(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startBoard to succeed");
    writeFileSync(started.entry.logPath, "== building local origins\n");
    const refreshed = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("starting");
  });
});

// The round leaves the board running and DETACHED, and its own wrapper
// then exits — so a dead wrapper is what success looks like from here.
// Asked the other way round, every board that came up was reported as
// "could not start", with its own "left running: … http://…" line
// quoted underneath as the reason.
describe("a board whose wrapper has exited", () => {
  const entryFor = (logPath: string) => ({
    branch: "aide/spec-1",
    commit: "abc123",
    port: 8801,
    wrapperPid: 4242,
    workDir: dirname(logPath),
    logPath,
    status: "starting" as const,
    startedAt: "2026-09-07T00:00:00.000Z",
  });

  test("is RUNNING when its log says it left one running", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-board-alive-"));
    const logPath = join(dir, "board.log");
    writeFileSync(
      logPath,
      "left running: pid 17721, http://127.0.0.1:8801/?token=t0ken — serving aide/spec-1 @ abc123\n",
    );
    const store = new BoardStore();
    store.set("aide", "spec-1", entryFor(logPath));
    // Nothing is alive: the wrapper is gone, which is the normal end.
    const ctx = makeCtx({ store, isAlive: () => false });
    const seen = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(seen?.status).toBe("running");
    expect(seen?.url).toBe("http://127.0.0.1:8801/?token=t0ken");
  });

  test("is FAILED only when the log says nothing and the wrapper is gone", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-board-dead-"));
    const logPath = join(dir, "board.log");
    writeFileSync(logPath, "cannot check out aide/spec-1 in a worktree\n");
    const store = new BoardStore();
    store.set("aide", "spec-1", entryFor(logPath));
    const ctx = makeCtx({ store, isAlive: () => false });
    const seen = refreshBoardStatus(ctx, "aide", "spec-1");
    expect(seen?.status).toBe("failed");
    expect(seen?.error).toContain("cannot check out");
  });
});
