// The board's own start/stop routes, following the shape
// `run-controls.ts`'s own reset-route suite already tests against —
// a real `createServer`, real fixture files, real HTTP.
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import type { ServerOptions } from "../../../src/serve/serve.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { WAITING_RUNNER } from "../../helpers/waiting-runner.ts";
import { tempDirs } from "../../helpers/setup/temp-dirs.ts";
import { branchOnOrigin, branchOpenGit, fakeSpawn, folder, postEmpty, settledBranchJob } from "./test-server-fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-board-routes-");
const results = tempDirs("aide-board-results-");
afterEach(() => harness.cleanup());

/** A board whose spec has a finished step and a branch still open on
 *  origin — what the spec page's `capable` check needs before it starts
 *  a test server. */
async function startWithOpenBranch(extra: Partial<ServerOptions>): Promise<string> {
  const queueResultDir = results.make();
  const { base, dir } = start({
    testServersAvailable: true,
    gitRun: branchOpenGit as never,
    queueRunnerBin: WAITING_RUNNER,
    queueResultDir,
    ...extra,
  });
  await settledBranchJob(base, dir, queueResultDir);
  return base;
}


describe("the board start/stop routes", () => {
  test("404 for an unknown spec", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/specs/aide/never-existed/test-server`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("an archived spec refuses with ARCHIVED_REFUSAL, for both start and stop", async () => {
    const archivedFolder = "82-archived";
    const { base } = harness.start({
      extra: {},
      archivedSpecs: { [archivedFolder]: {} },
    });
    for (const path of [`test-server`, `test-server/stop`]) {
      const res = await postEmpty(`${base}/api/queue/specs/aide/${archivedFolder}/${path}`);
      if (path === "test-server") {
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("archived");
      } else {
        // Stopping is always accepted (a no-op when nothing is
        // tracked) — there is nothing archived-only about clearing a
        // registry entry, and the automatic stop runs on an
        // archived spec by definition.
        expect(res.status).toBe(200);
      }
    }
  });

  test("a spec whose branch never made it to origin refuses without starting a process", async () => {
    const { base } = start({ testServersAvailable: true });
    const res = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; spec: string };
    expect(body.error).toContain("no such branch on origin");
    expect(body.spec).toBe(`aide/${folder}`);
  });

  test("an active group's member can open its already running shared-branch test server", async () => {
    const { base, server } = harness.start({
      executionGroups: [{ id: "release", project: "aide", name: "Release", members: [folder, "82-next"],
        branch: "aide/group-release", state: "running", currentMember: "82-next", completedMembers: [folder], jobs: [] }],
      alsoSpecs: ["82-next"],
      extra: { testServersIsAlive: () => true },
    });
    server.testServersStore().set("aide", folder, {
      branch: "aide/group-release", commit: "abc1234deadbeef", port: 8801,
      wrapperPid: 1, pid: 4242, url: "http://127.0.0.1:8801/?token=shared",
      workDir: "/tmp/aide-shared-test-server", logPath: "/tmp/aide-shared-test-server/board.log",
      status: "running", startedAt: "2026-11-16T00:00:00.000Z",
    });
    const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:8801/?token=shared");
  });

  test("the round being unavailable on this host refuses cleanly", async () => {
    const { base } = start({ testServersAvailable: false });
    const res = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("says nothing about how to start a board");
  });

  test("a start/stop round-trip against a fake spawn", async () => {
    // The spawn is faked (never the real, minutes-long round script),
    // but the process it stands in for is real and owned by this test —
    // a harmless, detached `sleep`, so `stopTestServer`'s own real
    // `process.kill(-pid, "SIGTERM")` has an actual, self-owned process
    // group to reach rather than an arbitrary pid this test does not
    // own.
    const board = fakeSpawn();
    // Which ports the search asked about, and the answer it got. The
    // port search is the harness's to answer, not this machine's
    // (`testServersPortProbe`, queue-server.ts): its default says the pool is
    // free, and `probed` below pins that the option is what decides. The
    // day that seam stops being wired, this test goes back to BINDING
    // 8801-8803 — which is what let one leftover test server on the host
    // fail it, and with it every landing whose merge runs this suite
    // (2026-09-09).
    const probed: number[] = [];
    const { base, dir } = start({
      testServersAvailable: true,
      testServersPortProbe: (port: number) => {
        probed.push(port);
        return true;
      },
      testServersSpawn: board.spawn,
    });
    branchOnOrigin(dir);

    try {
      const startRes = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server`);
      expect(startRes.status).toBe(200);
      const started = (await startRes.json()) as { ok: boolean; testServer: { status: string; wrapperPid: number } };
      expect(started.ok).toBe(true);
      expect(started.testServer.status).toBe("starting");
      expect(started.testServer.wrapperPid).toBe(board.spawned[0]);
      expect(board.calls).toHaveLength(1);
      expect(board.calls[0]!.cmd).toContain(`aide/${folder}`);
      // The injected probe decided the port, so nothing was bound on
      // this machine to find one.
      expect(probed).toContain(8801);

      const stopRes = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server/stop`);
      expect(stopRes.status).toBe(200);

      // A second start after the stop spawns again — the registry entry
      // was cleared.
      const restartRes = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server`);
      expect(restartRes.status).toBe(200);
      expect(board.calls).toHaveLength(2);
    } finally {
      board.killAll();
    }
  });

  // A board already tracked for a spec must keep its
  // link and Stop form once that spec is archived, even though the
  // archive never merged (the exact gap this spec's own description
  // names — the automatic stop only fires when a merge actually lands).
  // The spec is archived from the START (`archivedSpecs`, the ordinary
  // fixture shape) and the board entry is seeded straight into the
  // registry through `server.testServersStore()` — `TestServerStore` knows
  // nothing about which directory a spec's files live in, so a board
  // tracked for an archived spec is exactly what a held-back archive
  // leaves behind; nothing about getting there needs a real spawn, a
  // real branch on origin, or the scan to catch up.
  test("an archived spec's already-tracked board keeps its link and Stop form", async () => {
    const archivedFolder = "82-archived";
    const { base, server } = harness.start({
      extra: { testServersIsAlive: () => true },
      archivedSpecs: { [archivedFolder]: {} },
    });
    server.testServersStore().set("aide", archivedFolder, {
      branch: `aide/${archivedFolder}`,
      commit: "abc1234deadbeef",
      port: 8801,
      wrapperPid: 1,
      pid: 4242,
      url: "http://127.0.0.1:8801/?token=t0ken",
      workDir: "/tmp/aide-board-req1-test",
      logPath: "/tmp/aide-board-req1-test/board.log",
      status: "running",
      startedAt: "2026-09-09T00:00:00.000Z",
    });

    const res = await fetch(`${base}/specs/aide/${archivedFolder}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(">Open the test server</a>");
    expect(html).toContain("Stop test server");
  });

  // The ports-full case escapes `startTestServer`'s own try/catch
  // today (`lifecycle.ts` has none around `findFreePort`), so this route
  // returns a bare 500 with no message. `testServersPortProbe: () => false`
  // makes every port in the pool read as taken, without binding
  // anything on this machine.
  test("every test-server port already in use refuses with a message, not a 500", async () => {
    const { base, dir } = start({
      testServersAvailable: true,
      testServersPortProbe: () => false,
    });
    branchOnOrigin(dir);

    const res = await postEmpty(`${base}/api/queue/specs/aide/${folder}/test-server`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Test servers");
    // The refusal also states the running count (0 —
    // nothing is tracked in this fixture) and the pool's limit.
    expect(body.error).toContain("0");
    expect(body.error).toContain("6");
  });
});

// The held-for-Checks row's own link reaches `startTestServer()`
// through a GET a person can actually click — `?startTestServer=1` on the
// spec page itself, not the POST route above, which a plain
// `target="_blank"` link can never reach.
describe("the spec page's own ?startTestServer=1 trigger", () => {
  test("starts a board and 303s to the clean Steps-tab URL, once", async () => {
    const board = fakeSpawn();
    const base = await startWithOpenBranch({ testServersSpawn: board.spawn });

    try {
      const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      // The tab the reader opened WAITS here. It used to be sent
      // back to the spec page to find the address for itself.
      expect(res.status).toBe(200);
      const waiting = await res.text();
      expect(waiting).toContain("Starting a test server");
      expect(waiting).toContain("data-reload-every=");
      expect(waiting).toContain("spin");
      expect(board.calls).toHaveLength(1);

      // A repeat GET while it is still STARTING reaches the same,
      // still-alive entry (`startTestServer()`'s own dedup) rather than
      // spawning again — and goes back to the tab where the wait is
      // visible, because there is no address yet to go to.
      const res2 = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      // The reload the waiting page makes: still waiting, still no
      // second round. This is the one that matters — the page reloads
      // onto this URL every few seconds, so anything that starts a
      // board here starts one every few seconds.
      expect(res2.status).toBe(200);
      expect(await res2.text()).toContain("Starting a test server");
      expect(board.calls).toHaveLength(1);

      // Ten more reloads, and still one round.
      for (let i = 0; i < 10; i++) {
        await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
          redirect: "manual",
        });
      }
      expect(board.calls).toHaveLength(1);

      // Once the round says the board is up, the click ends at
      // the BOARD. It could not on the first one — a board takes
      // minutes and has no address until it has started.
      writeFileSync(
        board.boardLog(),
        `left running: pid 4242, http://127.0.0.1:8801/?token=t0ken — serving aide/${folder} @ abc1234\n`,
      );
      const res3 = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(res3.status).toBe(303);
      expect(res3.headers.get("location")).toBe("http://127.0.0.1:8801/?token=t0ken");
      // And nothing was started for it: the redirect happens before
      // `startTestServer()` is reached at all.
      expect(board.calls).toHaveLength(1);
    } finally {
      board.killAll();
    }
  });

  test("the round being unavailable skips the call and still redirects cleanly", async () => {
    const { base } = start({ testServersAvailable: false });
    const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/specs/aide/${folder}?tab=steps`);
  });

  // Today this falls through to `waitingForTestServerPage`, which
  // polls forever with no message at all, since `startTestServer()`'s result
  // is discarded here. `testServerFailedPage` is what it must show instead —
  // the page already built for exactly this kind of failure. The GET
  // route's own `capable` check needs a job whose result actually
  // carries `branchUrls` (`branchesFor()`'s only source) — the same
  // fake-runner scaffolding the sibling "starts a board and 303s" test
  // above already builds, with `testServersPortProbe` the one thing changed.
  test("every test-server port already in use shows testServerFailedPage, not an endless wait", async () => {
    const base = await startWithOpenBranch({ testServersPortProbe: () => false });

    const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Could not start a test server for "aide:81"');
    expect(html).toContain("Test servers");
    expect(html).not.toContain("data-reload-every=");
    // The outright-refusal shape — nothing was ever
    // stored — still carries a "Try again" link.
    expect(html).toContain('href="');
    expect(html).toContain("retryTestServer=1");
  });

  // A stored "failed" entry's own page now carries a way back
  // in, and following it actually clears and restarts the board — the
  // same fake-spawn/fake-`git` harness the "starts a board and 303s..."
  // test above builds, since the retry has to reach a real `capable`
  // spec and a real branch on origin the same way a first start does.
  test("a failed board's retry link clears it and starts a new one, landing on the waiting page", async () => {
    const board = fakeSpawn();
    const base = await startWithOpenBranch({ testServersSpawn: board.spawn });

    try {
      // The first attempt: starts a board.
      const first = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(first.status).toBe(200);
      expect(board.calls).toHaveLength(1);

      // It dies without ever reporting an address — the round's own log
      // has no "left running" line, and its wrapper has exited.
      writeFileSync(board.boardLog(), "boom: the round never started a listener\n");
      process.kill(-board.spawned[0]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));

      // The plain URL now shows the failed page, carrying its own
      // retry link.
      const failedRes = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(failedRes.status).toBe(200);
      const failedHtml = await failedRes.text();
      expect(failedHtml).toContain('Could not start a test server for "aide:81"');
      expect(failedHtml).toContain('href="');
      expect(failedHtml).toContain("retryTestServer=1");
      expect(board.calls).toHaveLength(1);

      // Following the retry link — built from known parts,
      // never scraped out of `esc()`'s escaped HTML — clears the failed
      // entry and starts a new one for the SAME branch.
      const retryUrl = `${base}/specs/aide/${folder}?tab=steps&startTestServer=1&retryTestServer=1`;
      const retryRes = await fetch(retryUrl, { redirect: "manual" });
      expect(board.calls).toHaveLength(2);
      expect(board.calls[1]!.cmd).toContain(`aide/${folder}`);
      expect(retryRes.status).toBe(303);
      expect(retryRes.headers.get("location")).toBe(`/specs/aide/${folder}?tab=steps&startTestServer=1`);

      // Following that redirect lands on the identical waiting page a
      // first start renders — never a URL still carrying the flag.
      const waitingRes = await fetch(`${base}${retryRes.headers.get("location")}`, {
        redirect: "manual",
      });
      expect(waitingRes.status).toBe(200);
      expect(await waitingRes.text()).toContain("Starting a test server");
    } finally {
      board.killAll();
    }
  });

  // The capability-refused path: a
  // retry pressed against a spec no longer capable of a board is
  // refused exactly as a first-time start already is, never sent to the
  // waiting page. Seeded straight into the registry, the same shortcut
  // the first-start test above uses — nothing about this outcome depends on a
  // real spawn or a real branch on origin.
  test("a retry on a spec that is no longer capable of a board is refused, not sent to the waiting page", async () => {
    const archivedFolder = "82-archived";
    const { base, server } = harness.start({
      extra: {},
      archivedSpecs: { [archivedFolder]: {} },
    });
    server.testServersStore().set("aide", archivedFolder, {
      branch: `aide/${archivedFolder}`,
      commit: "abc1234deadbeef",
      port: 8801,
      wrapperPid: 1,
      workDir: "/tmp/aide-board-489-capability-test",
      logPath: "/tmp/aide-board-489-capability-test/board.log",
      status: "failed",
      error: "could not start the board",
      startedAt: "2026-09-09T00:00:00.000Z",
    });

    const res = await fetch(
      `${base}/specs/aide/${archivedFolder}?tab=steps&startTestServer=1&retryTestServer=1`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/specs/aide/${archivedFolder}?tab=steps`);
  });

  // Loop-safety: the waiting page's own
  // 5-second self-refresh reloads the PLAIN URL, never the one carrying
  // `retryTestServer=1` — so a board that fails again after a successful
  // retry must stop and offer its own fresh "Try again", not be cleared
  // and respawned on every poll forever.
  test("a board that fails again after a retry is never auto-retried by the waiting page's own refresh", async () => {
    const board = fakeSpawn();
    const base = await startWithOpenBranch({ testServersSpawn: board.spawn });

    try {
      // First attempt, first failure, one retry — the same round-trip
      // the test above pins, brought here only far enough to reach a
      // SECOND failure to test the loop-safety guarantee against.
      await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, { redirect: "manual" });
      writeFileSync(board.boardLog(), "boom: the round never started a listener\n");
      process.kill(-board.spawned[0]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));
      const retryUrl = `${base}/specs/aide/${folder}?tab=steps&startTestServer=1&retryTestServer=1`;
      await fetch(retryUrl, { redirect: "manual" });
      expect(board.calls).toHaveLength(2);

      // The retried board fails too.
      writeFileSync(board.boardLog(), "boom again: still no listener\n");
      process.kill(-board.spawned[1]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));

      // Ten reloads of the PLAIN URL — the waiting page's own refresh,
      // never the retry link — and not one of them spawns again.
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
          redirect: "manual",
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Could not start a test server for "aide:81"');
        expect(html).toContain("retryTestServer=1");
      }
      expect(board.calls).toHaveLength(2);
    } finally {
      board.killAll();
    }
  });
});
