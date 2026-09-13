// Spec 388: starting a board wraps the round script exactly as a
// terminal user does — every assertion here is against a FAKE spawn/
// isAlive/gitRun, the same seam `runner-fixtures.ts` uses so a spawn/
// kill test never touches a real process.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TestServerStore } from "../../../src/serve/test-servers/store.ts";
import {
  TEST_SERVER_PORTS,
  findFreePort,
  MAIN_TEST_SERVER_KEY,
  refreshTestServerStatus,
  restartMainTestServer,
  startTestServer,
  type TestServersContext,
  type SpawnResult,
} from "../../../src/serve/test-servers/lifecycle.ts";
import type { TestServer } from "../../../src/serve/test-servers/store.ts";

// No test in this file may reach a real `process.kill`: the fixtures
// below carry made-up pids (one of them is 1, and `kill(-1)` is every
// process the user owns). Spied for the whole file, whatever a later
// test happens to call.
let killSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  killSpy = spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);
});
afterEach(() => killSpy.mockRestore());

let dir: string;
let spawnCalls: { cmd: string[]; logPath: string }[];
let spawnResult: SpawnResult;
let alive: Set<number>;

function makeCtx(overrides: Partial<TestServersContext> = {}): TestServersContext {
  return {
    store: new TestServerStore(),
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
    testServerOnPort: async () => undefined,
    findFreePort: async (reserved) => {
      let port = 9000;
      while (reserved.includes(port)) port++;
      return port;
    },
    ...overrides,
  };
}

/** A tracked, running board fixture — used to pin the exact running
 *  count a pool-exhausted refusal states (REQ-2). */
function runningEntry(port: number): TestServer {
  return {
    branch: `aide/board-${port}`,
    commit: "abc123",
    port,
    wrapperPid: port,
    workDir: dir,
    logPath: join(dir, `board-${port}.log`),
    status: "running",
    startedAt: "2026-09-05T00:00:00.000Z",
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

describe("startTestServer", () => {
  test("invokes the round script with --branch/--port/--keep", async () => {
    const ctx = makeCtx();
    const result = await startTestServer(ctx, "aide", "spec-1");
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
    const first = await startTestServer(ctx, "aide", "spec-1");
    const second = await startTestServer(ctx, "aide", "spec-1");
    expect(spawnCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test("a branch that has moved to a new commit starts a fresh board", async () => {
    const ctx = makeCtx();
    await startTestServer(ctx, "aide", "spec-1");
    const movedCtx = makeCtx({
      gitRun: async () => ({ code: 0, stdout: "def456\trefs/heads/aide/spec-1\n", stderr: "" }),
      store: ctx.store,
    });
    spawnResult = { pid: 5252 };
    const second = await startTestServer(movedCtx, "aide", "spec-1");
    expect(spawnCalls).toHaveLength(2);
    expect(second.ok && second.entry.commit).toBe("def456");
  });

  test("REQ-10: the port never collides with the served board's own port or another tracked board's port", async () => {
    const store = new TestServerStore();
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
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toContain("9002");
  });

  test("no board control possible when the round is unavailable on this host", async () => {
    const ctx = makeCtx({ roundAvailable: () => false });
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result).toEqual({ ok: false, error: "the round is not available on this host" });
    expect(spawnCalls).toHaveLength(0);
  });

  test("a branch absent on origin refuses without spawning", async () => {
    const ctx = makeCtx({ gitRun: async () => ({ code: 1, stdout: "", stderr: "" }) });
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result.ok).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  // REQ-1: a fourth start succeeds once the pool holds more than three
  // ports — proved through the REAL `findFreePort`, not a mock, with
  // three ports already reserved.
  test("REQ-1: a fourth start succeeds and takes the fourth pool port", async () => {
    const ctx = makeCtx({
      reservedPorts: () => [TEST_SERVER_PORTS[0]!, TEST_SERVER_PORTS[1]!, TEST_SERVER_PORTS[2]!],
      findFreePort: (reserved) => findFreePort(reserved, () => true),
    });
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toContain(String(TEST_SERVER_PORTS[3]));
  });

  // REQ-1: the pool still has a limit — all six ports reserved by six
  // tracked, running boards refuses a seventh, proved end to end through
  // `startTestServer()`'s own real `findFreePort`, not a mocked one.
  test("REQ-1: a seventh start is refused once all six ports are reserved", async () => {
    const store = new TestServerStore();
    for (let i = 0; i < 6; i++) {
      store.set("aide", `spec-${i}`, runningEntry(TEST_SERVER_PORTS[i]!));
    }
    const ctx = makeCtx({
      store,
      reservedPorts: () => [...TEST_SERVER_PORTS],
      findFreePort: (reserved) => findFreePort(reserved, () => true),
    });
    const result = await startTestServer(ctx, "aide", "spec-6");
    expect(result.ok).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  // REQ-2: the refusal states the exact running count (6) and the
  // pool's limit (6) — never a bare port list.
  test("REQ-2: a pool-exhausted refusal names the running count and the limit", async () => {
    const store = new TestServerStore();
    for (let i = 0; i < 6; i++) {
      store.set("aide", `spec-${i}`, runningEntry(TEST_SERVER_PORTS[i]!));
    }
    const ctx = makeCtx({ store, findFreePort: async () => undefined });
    const result = await startTestServer(ctx, "aide", "spec-6");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("6");
    expect(!result.ok && result.error).toContain(String(TEST_SERVER_PORTS.length));
    expect(spawnCalls).toHaveLength(0);
  });

  // REQ-2: the pool can also be exhausted for a reason outside the
  // registry (nothing tracked, yet every port is taken) — the refusal
  // states the actual tracked count (0), never a false claim that the
  // running count equals the limit.
  test("REQ-2: a pool-exhausted refusal outside the registry states 0 running, not the limit", async () => {
    const ctx = makeCtx({ findFreePort: async () => undefined });
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("0");
    expect(!result.ok && result.error).toContain(String(TEST_SERVER_PORTS.length));
    expect(spawnCalls).toHaveLength(0);
  });
});

// AC-3: the Deploy tab's button starts a board on the project's real
// default branch, not a spec's `aide/<specFolder>` derivation.
describe("startTestServer with an explicit branch (AC-3)", () => {
  test("opts.branch is used instead of aide/<specFolder>, for both the spawn and the entry", async () => {
    const ctx = makeCtx({
      gitRun: async (_dir, args) => {
        if (args[0] === "ls-remote") return { code: 0, stdout: "def456\trefs/heads/main\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    const result = await startTestServer(ctx, "aide", MAIN_TEST_SERVER_KEY, { branch: "main" });
    expect(result.ok).toBe(true);
    expect(spawnCalls[0]!.cmd).toEqual([
      "/checkout/aide/dashboard/test/round/run",
      "/checkout/aide",
      "--branch",
      "main",
      "--port",
      "9000",
      "--keep",
    ]);
    if (result.ok) {
      expect(result.entry.branch).toBe("main");
      expect(result.entry.commit).toBe("def456");
    }
  });

  test("with no opts at all, the default derivation is unchanged", async () => {
    const ctx = makeCtx();
    const result = await startTestServer(ctx, "aide", "spec-1");
    expect(result.ok && result.entry.branch).toBe("aide/spec-1");
  });
});

describe("restartMainTestServer (AC-6)", () => {
  test("nothing tracked yet behaves like a plain startTestServer", async () => {
    const ctx = makeCtx({
      gitRun: async (_dir, args) => {
        if (args[0] === "ls-remote") return { code: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    const result = await restartMainTestServer(ctx, "aide", "main");
    expect(result.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    if (result.ok) {
      expect(result.entry.branch).toBe("main");
      expect(ctx.store.get("aide", MAIN_TEST_SERVER_KEY)).toEqual(result.entry);
    }
  });

  // AC-6: a second press stops whatever is tracked under MAIN_TEST_SERVER_KEY —
  // whatever its status — and starts a fresh one, rather than leaving the
  // first running beside a second.
  test("a second call stops the first board's process group and starts a fresh one", async () => {
    const ctx = makeCtx({
      gitRun: async (_dir, args) => {
        if (args[0] === "ls-remote") return { code: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    const first = await restartMainTestServer(ctx, "aide", "main");
    if (!first.ok) throw new Error("expected restartMainTestServer to succeed");
    alive.add(5252);
    spawnResult = { pid: 5252 };
    const second = await restartMainTestServer(ctx, "aide", "main");
    expect(spawnCalls).toHaveLength(2);
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.entry.wrapperPid).toBe(5252);
      expect(ctx.store.get("aide", MAIN_TEST_SERVER_KEY)?.wrapperPid).toBe(5252);
    }
  });

  // AC-6: restarting must not be blocked by its OWN prior entry's port —
  // stopTestServer clears the registry before startTestServer ever asks for a free
  // one.
  test("the freed port is available to the fresh board", async () => {
    const store = new TestServerStore();
    const ctx = makeCtx({
      store,
      gitRun: async (_dir, args) => {
        if (args[0] === "ls-remote") return { code: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
      reservedPorts: () => store.all().map((e) => e.port),
      findFreePort: (reserved) => findFreePort(reserved, () => true),
    });
    const first = await restartMainTestServer(ctx, "aide", "main");
    expect(first.ok && first.entry.port).toBe(TEST_SERVER_PORTS[0]);
    spawnResult = { pid: 5252 };
    const second = await restartMainTestServer(ctx, "aide", "main");
    expect(second.ok && second.entry.port).toBe(TEST_SERVER_PORTS[0]);
  });
});

describe("refreshTestServerStatus", () => {
  test("REQ-4: parses the round's own 'left running' line into a running board", async () => {
    const ctx = makeCtx();
    const started = await startTestServer(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startTestServer to succeed");
    writeFileSync(
      started.entry.logPath,
      "== queue the specs\nleft running: pid 4242, http://127.0.0.1:9000/?token=t — serving aide/spec-1 @ abc123 (fixtures), /tmp/x\n",
    );
    const refreshed = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("running");
    expect(refreshed?.pid).toBe(4242);
    expect(refreshed?.url).toBe("http://127.0.0.1:9000/?token=t");
  });

  test("a dead wrapper process before the round ever reported up is a failed board", async () => {
    const ctx = makeCtx();
    const started = await startTestServer(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startTestServer to succeed");
    writeFileSync(started.entry.logPath, "some early output\ncannot check out aide/spec-1: already checked out\n");
    alive.clear();
    const refreshed = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("cannot check out");
  });

  // The round says the address twice: once the moment its server answers
  // ("board up"), and once when the whole round is finished ("left
  // running"). A reader waiting on the first gets in while the fixture
  // specs are still being created, rather than after.
  test("the 'board up' line is a running board too, minutes before the round ends", async () => {
    const ctx = makeCtx();
    await startTestServer(ctx, "aide", "spec-1");
    const entry = ctx.store.get("aide", "spec-1")!;
    writeFileSync(
      entry.logPath,
      "== queue the specs\nboard up: pid 4242, http://127.0.0.1:9000/?token=t — serving aide/spec-1 @ abc123\n",
    );
    const running = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect([running?.status, running?.url]).toEqual(["running", "http://127.0.0.1:9000/?token=t"]);
  });

  test("still starting while the process is alive and no 'left running' line has appeared yet", async () => {
    const ctx = makeCtx();
    const started = await startTestServer(ctx, "aide", "spec-1");
    if (!started.ok) throw new Error("expected startTestServer to succeed");
    writeFileSync(started.entry.logPath, "== building local origins\n");
    const refreshed = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect(refreshed?.status).toBe("starting");
  });

  // REQ-2: a "running" entry whose own process has since died — nobody
  // pressed Stop, the process is simply gone — is removed from the
  // registry on the very read that discovers it, rather than staying
  // "running" forever (the gap: today only the "starting" branch above
  // ever re-examines an entry at all).
  describe("a running entry that has gone quiet (REQ-2)", () => {
    test("its process no longer alive: the entry is removed, and undefined is returned", async () => {
      const ctx = makeCtx();
      const started = await startTestServer(ctx, "aide", "spec-1");
      if (!started.ok) throw new Error("expected startTestServer to succeed");
      writeFileSync(
        started.entry.logPath,
        "left running: pid 9999, http://127.0.0.1:9000/?token=t — serving aide/spec-1 @ abc123\n",
      );
      alive.add(9999);
      const running = refreshTestServerStatus(ctx, "aide", "spec-1");
      expect(running?.status).toBe("running");
      alive.delete(9999);
      const refreshed = refreshTestServerStatus(ctx, "aide", "spec-1");
      expect(refreshed).toBeUndefined();
      expect(ctx.store.get("aide", "spec-1")).toBeUndefined();
    });

    test("its process still alive: the entry is returned unchanged", async () => {
      const ctx = makeCtx();
      const started = await startTestServer(ctx, "aide", "spec-1");
      if (!started.ok) throw new Error("expected startTestServer to succeed");
      writeFileSync(
        started.entry.logPath,
        "left running: pid 9999, http://127.0.0.1:9000/?token=t — serving aide/spec-1 @ abc123\n",
      );
      alive.add(9999);
      refreshTestServerStatus(ctx, "aide", "spec-1");
      const refreshed = refreshTestServerStatus(ctx, "aide", "spec-1");
      expect(refreshed?.status).toBe("running");
      expect(ctx.store.get("aide", "spec-1")).toBeDefined();
    });
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
    const store = new TestServerStore();
    store.set("aide", "spec-1", entryFor(logPath));
    // Nothing is alive: the wrapper is gone, which is the normal end.
    const ctx = makeCtx({ store, isAlive: () => false });
    const seen = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect(seen?.status).toBe("running");
    expect(seen?.url).toBe("http://127.0.0.1:8801/?token=t0ken");
  });

  test("is FAILED only when the log says nothing and the wrapper is gone", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-board-dead-"));
    const logPath = join(dir, "board.log");
    writeFileSync(logPath, "cannot check out aide/spec-1 in a worktree\n");
    const store = new TestServerStore();
    store.set("aide", "spec-1", entryFor(logPath));
    const ctx = makeCtx({ store, isAlive: () => false });
    const seen = refreshTestServerStatus(ctx, "aide", "spec-1");
    expect(seen?.status).toBe("failed");
    expect(seen?.error).toContain("cannot check out");
  });
});
