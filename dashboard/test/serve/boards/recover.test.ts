// Finding a test server again after this server has restarted. Every
// deploy restarts the process, and the registry lives in memory: the
// board that was running is still up, still on its port, still holding
// its branch checked out — and the next click on the spec's own link
// tried to start a SECOND one on that branch, which git refuses with
// "it may already be checked out there, or in a leftover worktree".

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../../../src/serve/boards/store.ts";
import { stopBoard, type BoardsContext } from "../../../src/serve/boards/lifecycle.ts";
import { parseWorktrees, recoverBoards, sweepDeadBoards } from "../../../src/serve/boards/recover.ts";
import { workDirOf } from "../../../src/serve/boards/port-owner.ts";

/** A work directory shaped the way the round leaves one: `mktemp -d`'s
 *  own `tmp.XXXX` name, the board's worktree inside it, and the token it
 *  serves with beside that. The NAME is part of the shape — nothing is
 *  removed unless it looks like this. */
function roundWorkDir(token = "t0ken"): string {
  const work = mkdtempSync(join(tmpdir(), "tmp."));
  mkdirSync(join(work, "checkout"), { recursive: true });
  writeFileSync(join(work, "token"), token);
  return work;
}

const porcelain = (work: string, branch: string, commit: string): string =>
  `worktree /checkout/aide\nHEAD 1111111\nbranch refs/heads/main\n\n` +
  `worktree ${join(work, "checkout")}\nHEAD ${commit}\nbranch refs/heads/${branch}\n`;

function makeCtx(o: {
  worktrees?: string;
  onPort?: (port: number) => Promise<{ pid: number; workDir: string } | undefined>;
  store?: BoardStore;
} = {}): BoardsContext {
  return {
    store: o.store ?? new BoardStore(),
    aideCheckout: () => "/checkout/aide",
    roundScript: () => "/checkout/aide/dashboard/test/round/run",
    roundAvailable: () => true,
    gitRun: async (_dir, args) =>
      args[0] === "worktree"
        ? { code: 0, stdout: o.worktrees ?? "", stderr: "" }
        : { code: 1, stdout: "", stderr: "" },
    spawn: () => ({ pid: 1 }),
    isAlive: () => true,
    now: () => "2026-09-07T00:00:00.000Z",
    makeWorkDir: () => mkdtempSync(join(tmpdir(), "aide-board-recover-work-")),
    reservedPorts: () => [],
    findFreePort: async () => 8801,
    boardOnPort: o.onPort ?? (async () => undefined),
  };
}

describe("git worktree list --porcelain", () => {
  test("a branch per worktree, with the commit it is on", () => {
    expect(
      parseWorktrees("worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\nbranch refs/heads/aide/415-x\n"),
    ).toEqual([
      { path: "/a", branch: "main", commit: "abc" },
      { path: "/b", branch: "aide/415-x", commit: "def" },
    ]);
  });

  test("a detached worktree has no branch and is left out", () => {
    expect(parseWorktrees("worktree /a\nHEAD abc\ndetached\n")).toEqual([]);
  });
});

describe("finding a test server again", () => {
  test("the port names the process, the worktree names the spec", async () => {
    const work = roundWorkDir("s3cret");
    const store = new BoardStore();
    const ctx = makeCtx({
      store,
      worktrees: porcelain(work, "aide/415-x", "b67707e"),
      onPort: async (port) => (port === 8801 ? { pid: 238, workDir: work } : undefined),
    });

    const found = await recoverBoards(ctx, ["aide"]);
    expect(found).toHaveLength(1);
    const entry = store.get("aide", "415-x");
    expect([entry?.status, entry?.port, entry?.branch, entry?.commit]).toEqual([
      "running",
      8801,
      "aide/415-x",
      "b67707e",
    ]);
    // The address is no use without the token the round serves with.
    expect(entry?.url).toBe("http://127.0.0.1:8801/?token=s3cret");
  });

  // Everything else on the machine that happens to hold one of these
  // ports: not ours, and not to be adopted.
  test("a port held by something that is not a test server is left alone", async () => {
    const store = new BoardStore();
    const ctx = makeCtx({
      store,
      worktrees: porcelain(roundWorkDir(), "aide/415-x", "b67707e"),
      onPort: async () => ({ pid: 99, workDir: "/somewhere/else" }),
    });
    expect(await recoverBoards(ctx, ["aide"])).toEqual([]);
    expect(store.all()).toEqual([]);
  });

  // The ports are only worth asking about when the round left something
  // behind — and reading the process table three times per restart, on
  // every server that never runs one, is a cost with no question in it.
  test("no round worktree at all, and no port is asked about", async () => {
    let asked = 0;
    const ctx = makeCtx({
      worktrees: "worktree /checkout/aide\nHEAD abc\nbranch refs/heads/main\n",
      onPort: async () => {
        asked++;
        return undefined;
      },
    });
    expect(await recoverBoards(ctx, ["aide"])).toEqual([]);
    expect(asked).toBe(0);
  });

  // The registry already knows about it: this server started it itself,
  // and its own entry — "starting", with the wrapper still going — is
  // the truer one.
  test("a port this server already tracks is not touched", async () => {
    const store = new BoardStore();
    store.set("aide", "415-x", {
      branch: "aide/415-x",
      commit: "b67707e",
      port: 8801,
      wrapperPid: 7,
      workDir: "/w",
      logPath: "/w/board.log",
      status: "starting",
      startedAt: "2026-09-07T00:00:00.000Z",
    });
    let asked = 0;
    const ctx = makeCtx({
      store,
      worktrees: porcelain(roundWorkDir(), "aide/415-x", "b67707e"),
      onPort: async (port) => {
        if (port === 8801) asked++;
        return undefined;
      },
    });
    await recoverBoards(ctx, ["aide"]);
    expect([asked, store.get("aide", "415-x")?.status]).toEqual([0, "starting"]);
  });

  test("a checkout git cannot be asked about recovers nothing, and does not throw", async () => {
    const ctx = makeCtx({ worktrees: undefined, onPort: async () => ({ pid: 1, workDir: "/w" }) });
    expect(await recoverBoards(ctx, ["aide"])).toEqual([]);
  });
});

// The round's wrapper is gone by the time a board is recovered, so
// `wrapperPid` is the board's OWN process. Signalling the negated pid
// there asks the kernel for a process GROUP with that id, which is not
// this process — and the board went on running.
describe("stopping a board that was found again", () => {
  const stopWith = (recovered: boolean): number[] => {
    const signalled: number[] = [];
    const store = new BoardStore();
    store.set("aide", "415-x", {
      branch: "aide/415-x",
      commit: "b67707e",
      port: 8801,
      wrapperPid: 238,
      ...(recovered ? { recovered: true } : {}),
      workDir: "/w",
      logPath: "/w/serve.log",
      status: "running",
      startedAt: "2026-09-07T00:00:00.000Z",
    });
    const real = process.kill;
    // @ts-expect-error — replaced for the length of one call
    process.kill = (pid: number) => {
      signalled.push(pid);
    };
    try {
      stopBoard(makeCtx({ store }), "aide", "415-x");
    } finally {
      process.kill = real;
    }
    return signalled;
  };

  test("the signal goes to the board itself, not to a process group", () => {
    expect(stopWith(true)).toEqual([238]);
  });

  test("a board this server started still gets its whole group", () => {
    expect(stopWith(false)).toEqual([-238]);
  });
});

// The round leaves a watcher that removes its worktree once the board
// dies, and a restart that takes the board takes the watcher with it.
// What is left is a registration that refuses the next checkout of that
// branch — the next click on the spec's own link.
describe("the worktrees of test servers that are gone", () => {
  const removals = (calls: string[][]) => calls.filter((a) => a[0] === "worktree" && a[1] === "remove");

  test("a round worktree nothing is listening for is removed", async () => {
    const work = roundWorkDir();
    const calls: string[][] = [];
    const ctx = makeCtx({ worktrees: porcelain(work, "aide/415-x", "b67707e") });
    const gitRun = ctx.gitRun;
    ctx.gitRun = async (dir, args) => {
      calls.push(args);
      return gitRun(dir, args);
    };
    expect(await sweepDeadBoards(ctx, ["aide"])).toEqual([join(work, "checkout")]);
    expect(removals(calls)).toHaveLength(1);
    expect(calls.some((a) => a[0] === "worktree" && a[1] === "prune")).toBe(true);
  });

  // `recoverBoards` runs first and puts a live board in the registry;
  // its own worktree is not a leftover.
  test("the worktree of a board that IS running is left alone", async () => {
    const work = roundWorkDir();
    const store = new BoardStore();
    const ctx = makeCtx({
      store,
      worktrees: porcelain(work, "aide/415-x", "b67707e"),
      onPort: async (port) => (port === 8801 ? { pid: 238, workDir: work } : undefined),
    });
    await recoverBoards(ctx, ["aide"]);
    expect(await sweepDeadBoards(ctx, ["aide"])).toEqual([]);
  });

  // A run's own worktree lives at `~/aide-worktrees/<project>/<spec>/code`
  // and is a job in progress, not a leftover.
  test("nothing but a round's own worktree is touched", async () => {
    const ctx = makeCtx({
      worktrees:
        `worktree /checkout/aide\nHEAD 1111111\nbranch refs/heads/main\n\n` +
        `worktree /Users/x/aide-worktrees/aide/415-x/code\nHEAD abc\nbranch refs/heads/aide/415-x\n\n` +
        `worktree /var/folders/44/T/not-a-temp-name/checkout\nHEAD abc\nbranch refs/heads/aide/416-x\n`,
    });
    expect(await sweepDeadBoards(ctx, ["aide"])).toEqual([]);
  });
});

// The one fact `boards/recover.ts` reads off a command line. The round
// starts its board with `--root <work>/root`; this dashboard's own
// `--root` is a projects directory, and must not read as a board.
describe("which process on a port is a test server", () => {
  test("the round's own --root gives the work directory", () => {
    expect(
      workDirOf(
        "bun run src/serve/serve.ts serve --port 8801 --root /var/folders/44/T/tmp.DoLqJvcLvq/root --site /x",
      ),
    ).toBe("/var/folders/44/T/tmp.DoLqJvcLvq");
  });

  test("this dashboard's own --root is not one", () => {
    expect(workDirOf("bun run serve.ts serve --root /Users/x/aide-dashboard-projects --bind 127.0.0.1")).toBeUndefined();
  });

  test("a --root at the very end of the line is still read", () => {
    expect(workDirOf("bun run serve.ts serve --root /tmp/w/root")).toBe("/tmp/w");
  });

  // The directory is named "root", not merely started that way.
  test("a directory whose name only begins with root is not one", () => {
    expect(workDirOf("bun run serve.ts serve --root /tmp/w/rootless --site /x")).toBeUndefined();
  });
});
