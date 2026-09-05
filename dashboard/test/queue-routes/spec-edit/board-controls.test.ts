// Spec 388: the board's own start/stop routes, following the shape
// `run-controls.ts`'s own reset-route suite already tests against —
// a real `createServer`, real fixture files, real HTTP.
import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-board-routes-");
afterEach(() => {
  harness.cleanup();
});

const auth = { "x-aide-token": TOKEN };
const folder = "81-queue-and-runner";

describe("spec 388: the board start/stop routes", () => {
  test("404 for an unknown spec", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/specs/aide/never-existed/board`, {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(404);
  });

  test("an archived spec refuses with ARCHIVED_REFUSAL, for both start and stop", async () => {
    const archivedFolder = "82-archived";
    const { base } = harness.start({
      extra: { queueToken: TOKEN },
      archivedSpecs: { [archivedFolder]: {} },
    });
    for (const path of [`board`, `board/stop`]) {
      const res = await fetch(`${base}/api/queue/specs/aide/${archivedFolder}/${path}`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      if (path === "board") {
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("archived");
      } else {
        // Stopping is always accepted (a no-op when nothing is
        // tracked) — there is nothing archived-only about clearing a
        // registry entry, and REQ-7's own automatic stop runs on an
        // archived spec by definition.
        expect(res.status).toBe(200);
      }
    }
  });

  test("a spec whose branch never made it to origin refuses without starting a process", async () => {
    const { base } = start({ queueToken: TOKEN, boardsAvailable: true });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/board`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; spec: string };
    expect(body.error).toContain("no such branch on origin");
    expect(body.spec).toBe(`aide/${folder}`);
  });

  test("the round being unavailable on this host refuses cleanly", async () => {
    const { base } = start({ queueToken: TOKEN, boardsAvailable: false });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/board`, {
      method: "POST",
      headers: { ...auth, accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("the round is not available");
  });

  test("a start/stop round-trip against a fake spawn", async () => {
    // The spawn is faked (never the real, minutes-long round script),
    // but the process it stands in for is real and owned by this test —
    // a harmless, detached `sleep`, so `stopBoard`'s own real
    // `process.kill(-pid, "SIGTERM")` has an actual, self-owned process
    // group to reach rather than an arbitrary pid this test does not
    // own.
    const spawnCalls: { cmd: string[] }[] = [];
    const spawned: number[] = [];
    const { base, dir } = start({
      queueToken: TOKEN,
      boardsAvailable: true,
      boardsSpawn: (cmd) => {
        spawnCalls.push({ cmd });
        const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
        proc.unref();
        spawned.push(proc.pid);
        return { pid: proc.pid };
      },
    });
    // Give the fixture's own project root an `aide/<folder>` branch on
    // "origin" — `startBoard`'s own `headCommit` reads `git ls-remote
    // --heads origin`, so the branch has to actually exist there.
    const root = `${dir}/root/aide`;
    Bun.spawnSync({ cmd: ["git", "-C", root, "init", "-q", "-b", "main"] });
    Bun.spawnSync({ cmd: ["git", "-C", root, "add", "-A"] });
    Bun.spawnSync({
      cmd: ["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"],
    });
    Bun.spawnSync({ cmd: ["git", "-C", root, "checkout", "-q", "-b", `aide/${folder}`] });
    const bare = `${dir}/origin.git`;
    Bun.spawnSync({ cmd: ["git", "init", "-q", "--bare", "-b", "main", bare] });
    Bun.spawnSync({ cmd: ["git", "-C", root, "remote", "add", "origin", bare] });
    Bun.spawnSync({ cmd: ["git", "-C", root, "push", "-q", "origin", "main", `aide/${folder}`] });

    try {
      const startRes = await fetch(`${base}/api/queue/specs/aide/${folder}/board`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      expect(startRes.status).toBe(200);
      const started = (await startRes.json()) as { ok: boolean; board: { status: string; wrapperPid: number } };
      expect(started.ok).toBe(true);
      expect(started.board.status).toBe("starting");
      expect(started.board.wrapperPid).toBe(spawned[0]);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.cmd).toContain(`aide/${folder}`);

      const stopRes = await fetch(`${base}/api/queue/specs/aide/${folder}/board/stop`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      expect(stopRes.status).toBe(200);

      // A second start after the stop spawns again — the registry entry
      // was cleared.
      const restartRes = await fetch(`${base}/api/queue/specs/aide/${folder}/board`, {
        method: "POST",
        headers: { ...auth, accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      expect(restartRes.status).toBe(200);
      expect(spawnCalls).toHaveLength(2);
    } finally {
      for (const pid of spawned) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // already gone, which is the outcome either way
        }
      }
    }
  });
});
