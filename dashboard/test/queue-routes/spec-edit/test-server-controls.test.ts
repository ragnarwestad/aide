// Spec 388: the board's own start/stop routes, following the shape
// `run-controls.ts`'s own reset-route suite already tests against —
// a real `createServer`, real fixture files, real HTTP.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-board-routes-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** The job's own record, polled until `done` holds (the same idiom
 *  `landing-window-and-repo-lock.test.ts` uses) — `branchUrls` only
 *  reaches `ctx.queue.branchesFor()` once the step's result has landed
 *  on the job. */
async function settleDone(base: string, id: string): Promise<void> {
  for (let n = 0; n < 100; n++) {
    const body = (await (await fetch(`${base}/api/queue/${id}`)).json()) as {
      job: { state: string };
    };
    if (body.job.state === "done") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the job never settled");
}

const folder = "81-queue-and-runner";

describe("spec 388: the board start/stop routes", () => {
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
      const res = await fetch(`${base}/api/queue/specs/aide/${archivedFolder}/${path}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      if (path === "test-server") {
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
    const { base } = start({ testServersAvailable: true });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; spec: string };
    expect(body.error).toContain("no such branch on origin");
    expect(body.spec).toBe(`aide/${folder}`);
  });

  test("the round being unavailable on this host refuses cleanly", async () => {
    const { base } = start({ testServersAvailable: false });
    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
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
    const spawnCalls: { cmd: string[] }[] = [];
    const spawned: number[] = [];
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
      testServersSpawn: (cmd) => {
        spawnCalls.push({ cmd });
        const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
        proc.unref();
        spawned.push(proc.pid);
        return { pid: proc.pid };
      },
    });
    // Give the fixture's own project root an `aide/<folder>` branch on
    // "origin" — `startTestServer`'s own `headCommit` reads `git ls-remote
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
      const startRes = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      expect(startRes.status).toBe(200);
      const started = (await startRes.json()) as { ok: boolean; testServer: { status: string; wrapperPid: number } };
      expect(started.ok).toBe(true);
      expect(started.testServer.status).toBe("starting");
      expect(started.testServer.wrapperPid).toBe(spawned[0]);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.cmd).toContain(`aide/${folder}`);
      // The injected probe decided the port, so nothing was bound on
      // this machine to find one.
      expect(probed).toContain(8801);

      const stopRes = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server/stop`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: "{}",
      });
      expect(stopRes.status).toBe(200);

      // A second start after the stop spawns again — the registry entry
      // was cleared.
      const restartRes = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
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

  // REQ-1 (spec 425): a board already tracked for a spec must keep its
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
  test("REQ-1: an archived spec's already-tracked board keeps its link and Stop form", async () => {
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
    expect(html).toContain("This spec has been archived");
    expect(html).toContain(">Open the test server</a>");
    expect(html).toContain("Stop test server");
  });

  // REQ-5: the ports-full case escapes `startTestServer`'s own try/catch
  // today (`lifecycle.ts` has none around `findFreePort`), so this route
  // returns a bare 500 with no message. `testServersPortProbe: () => false`
  // makes every port in the pool read as taken, without binding
  // anything on this machine.
  test("REQ-5: every test-server port already in use refuses with a message, not a 500", async () => {
    const { base, dir } = start({
      testServersAvailable: true,
      testServersPortProbe: () => false,
    });
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

    const res = await fetch(`${base}/api/queue/specs/aide/${folder}/test-server`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Test servers");
    // REQ-2 (spec 428): the refusal also states the running count (0 —
    // nothing is tracked in this fixture) and the pool's limit.
    expect(body.error).toContain("0");
    expect(body.error).toContain("6");
  });
});

// Spec 411: the held-for-Checks row's own link reaches `startTestServer()`
// through a GET a person can actually click — `?startTestServer=1` on the
// spec page itself, not the POST route above, which a plain
// `target="_blank"` link can never reach.
describe("spec 411: the spec page's own ?startTestServer=1 trigger", () => {
  test("starts a board and 303s to the clean Steps-tab URL, once", async () => {
    const spawnCalls: { cmd: string[] }[] = [];
    const spawned: number[] = [];
    let boardLog = "";
    const results = mkdtempSync(join(tmpdir(), "aide-411-board-trigger-"));
    ownDirs.push(results);
    // Every git call this harness's own job-and-landing pipeline makes
    // succeeds trivially, except: `ls-remote --heads origin aide/<folder>`,
    // which needs a real SHA back for `startTestServer()`'s own `headCommit()`
    // not to refuse "no such branch on origin"; and the merge itself,
    // held open the same way `landing-window-and-repo-lock.test.ts` holds
    // it (never released) — a landing that actually finished would merge
    // this very branch into the default one and wipe `branchUrls` behind
    // it (`land-branch/merge.ts`'s own "Landed" branch), and this test's
    // whole point is a spec whose code branch is still open.
    const gitRun = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith(`ls-remote --heads origin aide/${folder}`)) {
        return { code: 0, stdout: `abc123deadbeef1234567890abcdef123456789\trefs/heads/aide/${folder}\n` };
      }
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        return new Promise(() => {
          // Never resolves — held for the life of the test.
        });
      }
      return { code: 0, stdout: "" };
    };
    const { base, dir } = start({
      testServersAvailable: true,
      gitRun: gitRun as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      testServersSpawn: (cmd, logPath) => {
        spawnCalls.push({ cmd });
        // What a round that got its board up actually writes. Without
        // it the board stays "starting" for ever, and the click that
        // follows has no address to be sent to.
        boardLog = logPath;
        const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
        proc.unref();
        spawned.push(proc.pid);
        return { pid: proc.pid };
      },
    });
    // `ctx.testServers.aideCheckout("aide")` resolves to this same path (no
    // owned checkout exists in this fixture, so it falls back to the
    // display checkout, `queueProjectRoot/aide`) — `branchesFor()` has
    // to report a branch open on exactly this root for the GET route's
    // capability check to pass.
    const root = join(dir, "root", "aide");

    // A real step, run straight through the fake runner binary, so its
    // result lands on the job the same way a real `aide-run-spec` run
    // would — `branchesFor()` reads `job.branchUrls`, set only once a
    // step's own result has actually settled.
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    await Bun.write(
      join(results, `${made.job.id}.json`),
      JSON.stringify({
        ok: true,
        exitCode: 0,
        costUsd: 0.1,
        costMeasured: true,
        terminalReason: "completed",
        branch: `aide/${folder}`,
        branchUrls: [{ root, url: "https://example.test/aide" }],
        repos: [],
      }),
    );
    await settleDone(base, made.job.id);

    try {
      const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      // REQ-4: the tab the reader opened WAITS here. It used to be sent
      // back to the spec page to find the address for itself.
      expect(res.status).toBe(200);
      const waiting = await res.text();
      expect(waiting).toContain("Starting a test server");
      expect(waiting).toMatch(/http-equiv="refresh"/);
      expect(waiting).toContain("spin");
      expect(spawnCalls).toHaveLength(1);

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
      expect(spawnCalls).toHaveLength(1);

      // Ten more reloads, and still one round.
      for (let i = 0; i < 10; i++) {
        await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
          redirect: "manual",
        });
      }
      expect(spawnCalls).toHaveLength(1);

      // REQ-3: once the round says the board is up, the click ends at
      // the BOARD. It could not on the first one — a board takes
      // minutes and has no address until it has started.
      writeFileSync(
        boardLog,
        `left running: pid 4242, http://127.0.0.1:8801/?token=t0ken — serving aide/${folder} @ abc1234\n`,
      );
      const res3 = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(res3.status).toBe(303);
      expect(res3.headers.get("location")).toBe("http://127.0.0.1:8801/?token=t0ken");
      // And nothing was started for it: the redirect happens before
      // `startTestServer()` is reached at all.
      expect(spawnCalls).toHaveLength(1);
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

  test("the round being unavailable skips the call and still redirects cleanly", async () => {
    const { base } = start({ testServersAvailable: false });
    const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/specs/aide/${folder}?tab=steps`);
  });

  // REQ-5: today this falls through to `waitingForTestServerPage`, which
  // polls forever with no message at all, since `startTestServer()`'s result
  // is discarded here. `testServerFailedPage` is what it must show instead —
  // the page already built for exactly this kind of failure. The GET
  // route's own `capable` check needs a job whose result actually
  // carries `branchUrls` (`branchesFor()`'s only source) — the same
  // fake-runner scaffolding the sibling "starts a board and 303s" test
  // above already builds, with `testServersPortProbe` the one thing changed.
  test("REQ-5: every test-server port already in use shows testServerFailedPage, not an endless wait", async () => {
    const results = mkdtempSync(join(tmpdir(), "aide-411-board-ports-full-"));
    ownDirs.push(results);
    const gitRun = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith(`ls-remote --heads origin aide/${folder}`)) {
        return { code: 0, stdout: `abc123deadbeef1234567890abcdef123456789\trefs/heads/aide/${folder}\n` };
      }
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        return new Promise(() => {
          // Never resolves — held for the life of the test, the same
          // as the sibling test above.
        });
      }
      return { code: 0, stdout: "" };
    };
    const { base, dir } = start({
      testServersAvailable: true,
      testServersPortProbe: () => false,
      gitRun: gitRun as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
    });
    const root = join(dir, "root", "aide");

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    await Bun.write(
      join(results, `${made.job.id}.json`),
      JSON.stringify({
        ok: true,
        exitCode: 0,
        costUsd: 0.1,
        costMeasured: true,
        terminalReason: "completed",
        branch: `aide/${folder}`,
        branchUrls: [{ root, url: "https://example.test/aide" }],
        repos: [],
      }),
    );
    await settleDone(base, made.job.id);

    const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`Could not start a test server for "${folder}"`);
    expect(html).toContain("Test servers");
    expect(html).not.toMatch(/http-equiv="refresh"/);
    // AC-1 (spec 489): the outright-refusal shape — nothing was ever
    // stored — still carries a "Try again" link.
    expect(html).toContain('href="');
    expect(html).toContain("retryTestServer=1");
  });

  // Spec 489: a stored "failed" entry's own page now carries a way back
  // in, and following it actually clears and restarts the board — the
  // same fake-spawn/fake-`git` harness the "starts a board and 303s..."
  // test above builds, since the retry has to reach a real `capable`
  // spec and a real branch on origin the same way a first start does.
  test("spec 489: a failed board's retry link clears it and starts a new one, landing on the waiting page", async () => {
    const spawnCalls: { cmd: string[] }[] = [];
    const spawned: number[] = [];
    let boardLog = "";
    const results = mkdtempSync(join(tmpdir(), "aide-489-retry-"));
    ownDirs.push(results);
    const gitRun = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith(`ls-remote --heads origin aide/${folder}`)) {
        return { code: 0, stdout: `abc123deadbeef1234567890abcdef123456789\trefs/heads/aide/${folder}\n` };
      }
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        return new Promise(() => {
          // Held open for the life of the test, as the sibling tests do.
        });
      }
      return { code: 0, stdout: "" };
    };
    const { base, dir } = start({
      testServersAvailable: true,
      gitRun: gitRun as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      testServersSpawn: (cmd, logPath) => {
        spawnCalls.push({ cmd });
        boardLog = logPath;
        const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
        proc.unref();
        spawned.push(proc.pid);
        return { pid: proc.pid };
      },
    });
    const root = join(dir, "root", "aide");

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    await Bun.write(
      join(results, `${made.job.id}.json`),
      JSON.stringify({
        ok: true,
        exitCode: 0,
        costUsd: 0.1,
        costMeasured: true,
        terminalReason: "completed",
        branch: `aide/${folder}`,
        branchUrls: [{ root, url: "https://example.test/aide" }],
        repos: [],
      }),
    );
    await settleDone(base, made.job.id);

    try {
      // The first attempt: starts a board.
      const first = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(first.status).toBe(200);
      expect(spawnCalls).toHaveLength(1);

      // It dies without ever reporting an address — the round's own log
      // has no "left running" line, and its wrapper has exited.
      writeFileSync(boardLog, "boom: the round never started a listener\n");
      process.kill(-spawned[0]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));

      // AC-1: the plain URL now shows the failed page, carrying its own
      // retry link.
      const failedRes = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
        redirect: "manual",
      });
      expect(failedRes.status).toBe(200);
      const failedHtml = await failedRes.text();
      expect(failedHtml).toContain(`Could not start a test server for "${folder}"`);
      expect(failedHtml).toContain('href="');
      expect(failedHtml).toContain("retryTestServer=1");
      expect(spawnCalls).toHaveLength(1);

      // AC-2/AC-3: following the retry link — built from known parts,
      // never scraped out of `esc()`'s escaped HTML — clears the failed
      // entry and starts a new one for the SAME branch.
      const retryUrl = `${base}/specs/aide/${folder}?tab=steps&startTestServer=1&retryTestServer=1`;
      const retryRes = await fetch(retryUrl, { redirect: "manual" });
      expect(spawnCalls).toHaveLength(2);
      expect(spawnCalls[1]!.cmd).toContain(`aide/${folder}`);
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
      for (const pid of spawned) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // already gone, which is the outcome either way
        }
      }
    }
  });

  // Spec 489, AC-3's capability-refused path (Risk analysis item 2): a
  // retry pressed against a spec no longer capable of a board is
  // refused exactly as a first-time start already is, never sent to the
  // waiting page. Seeded straight into the registry, the same shortcut
  // REQ-1's test above uses — nothing about this outcome depends on a
  // real spawn or a real branch on origin.
  test("spec 489: a retry on a spec that is no longer capable of a board is refused, not sent to the waiting page", async () => {
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

  // Spec 489, Risk analysis item 1 (loop-safety): the waiting page's own
  // 5-second self-refresh reloads the PLAIN URL, never the one carrying
  // `retryTestServer=1` — so a board that fails again after a successful
  // retry must stop and offer its own fresh "Try again", not be cleared
  // and respawned on every poll forever.
  test("spec 489: a board that fails again after a retry is never auto-retried by the waiting page's own refresh", async () => {
    const spawnCalls: { cmd: string[] }[] = [];
    const spawned: number[] = [];
    let boardLog = "";
    const results = mkdtempSync(join(tmpdir(), "aide-489-loop-safety-"));
    ownDirs.push(results);
    const gitRun = async (_dir: string, args: string[]) => {
      const a = args.join(" ");
      if (a.startsWith(`ls-remote --heads origin aide/${folder}`)) {
        return { code: 0, stdout: `abc123deadbeef1234567890abcdef123456789\trefs/heads/aide/${folder}\n` };
      }
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
        return new Promise(() => {
          // Held open for the life of the test, as the sibling tests do.
        });
      }
      return { code: 0, stdout: "" };
    };
    const { base, dir } = start({
      testServersAvailable: true,
      gitRun: gitRun as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      testServersSpawn: (cmd, logPath) => {
        spawnCalls.push({ cmd });
        boardLog = logPath;
        const proc = Bun.spawn({ cmd: ["sleep", "60"], stdio: ["ignore", "ignore", "ignore"], detached: true });
        proc.unref();
        spawned.push(proc.pid);
        return { pid: proc.pid };
      },
    });
    const root = join(dir, "root", "aide");

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ project: "aide", specFolder: folder, steps: ["analyze"] }),
      })
    ).json()) as { job: { id: string } };
    await Bun.write(
      join(results, `${made.job.id}.json`),
      JSON.stringify({
        ok: true,
        exitCode: 0,
        costUsd: 0.1,
        costMeasured: true,
        terminalReason: "completed",
        branch: `aide/${folder}`,
        branchUrls: [{ root, url: "https://example.test/aide" }],
        repos: [],
      }),
    );
    await settleDone(base, made.job.id);

    try {
      // First attempt, first failure, one retry — the same round-trip
      // the test above pins, brought here only far enough to reach a
      // SECOND failure to test the loop-safety guarantee against.
      await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, { redirect: "manual" });
      writeFileSync(boardLog, "boom: the round never started a listener\n");
      process.kill(-spawned[0]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));
      const retryUrl = `${base}/specs/aide/${folder}?tab=steps&startTestServer=1&retryTestServer=1`;
      await fetch(retryUrl, { redirect: "manual" });
      expect(spawnCalls).toHaveLength(2);

      // The retried board fails too.
      writeFileSync(boardLog, "boom again: still no listener\n");
      process.kill(-spawned[1]!, "SIGKILL");
      await new Promise((r) => setTimeout(r, 100));

      // Ten reloads of the PLAIN URL — the waiting page's own refresh,
      // never the retry link — and not one of them spawns again.
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${base}/specs/aide/${folder}?tab=steps&startTestServer=1`, {
          redirect: "manual",
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`Could not start a test server for "${folder}"`);
        expect(html).toContain("retryTestServer=1");
      }
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
