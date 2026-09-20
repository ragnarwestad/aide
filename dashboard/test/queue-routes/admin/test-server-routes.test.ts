// Spec 441: the Deploy tab's "Testserver med testspecene" button — the
// two new routes behind it (start/restart, stop) and the GET poll branch
// the started tab waits on, following the shape `board-controls.test.ts`
// already established for the spec-scoped board start/stop pair.
import { afterEach, describe, expect, test } from "bun:test";
import { fakeGit } from "../../helpers/fake-git.ts";
import { MAIN_TEST_SERVER_KEY } from "../../../src/serve/test-servers/lifecycle.ts";
import type { TestServer } from "../../../src/serve/test-servers/store.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-test-board-routes-");
afterEach(() => harness.cleanup());

const AUTH = { "content-type": "application/json", accept: "application/json" };

/** What `defaultBranch()`'s own `symbolic-ref` and `startTestServer()`'s own
 *  `headCommit()` (`ls-remote`) need to resolve and find "main". */
const onMain = () =>
  fakeGit({
    "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
    "ls-remote": { code: 0, stdout: "abc123deadbeef\trefs/heads/main\n" },
  });

const mainEntry = (overrides: Partial<TestServer> = {}): TestServer => ({
  branch: "main",
  commit: "abc123deadbeef",
  port: 8801,
  wrapperPid: 4242,
  workDir: "/tmp/aide-test-board-routes",
  logPath: "/tmp/aide-test-board-routes/board.log",
  status: "running",
  startedAt: "2026-09-13T00:00:00.000Z",
  ...overrides,
});

describe("POST /api/queue/projects/<name>/test-server (AC-3, AC-5, AC-6)", () => {
  test("refuses for a project this dashboard does not know", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/projects/nosuch/test-server`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404);
  });

  test("only POST — the route takes no other method", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/projects/aide/test-server`, { headers: AUTH });
    expect(res.status).toBe(405);
  });

  test("the round being unavailable answers testServerFailedPage", async () => {
    const git = onMain();
    const { base } = start({ gitRun: git.run, testServersAvailable: false });
    const res = await fetch(`${base}/api/queue/projects/aide/test-server`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("does not carry the dashboard's source");
  });

  test("success resolves the default branch, spawns on it, and 303s to the waiting URL", async () => {
    const git = onMain();
    const spawnCalls: { cmd: string[] }[] = [];
    const { base } = start({
      gitRun: git.run,
      testServersAvailable: true,
      testServersPortProbe: () => true,
      testServersSpawn: (cmd) => {
        spawnCalls.push({ cmd });
        return { pid: 4242 };
      },
    });
    const res = await fetch(`${base}/api/queue/projects/aide/test-server`, {
      method: "POST",
      redirect: "manual",
      headers: AUTH,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?startTestServer=1");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toContain("main");
  });

  // AC-6: pressing the button again stops whatever is tracked and starts
  // fresh, rather than leaving the first board running beside a second.
  test("a second press restarts rather than starting a second board", async () => {
    const git = onMain();
    const spawnCalls: { cmd: string[] }[] = [];
    let nextPid = 4242;
    const { base } = start({
      gitRun: git.run,
      testServersAvailable: true,
      testServersPortProbe: () => true,
      testServersIsAlive: () => true,
      testServersSpawn: (cmd) => {
        spawnCalls.push({ cmd });
        return { pid: nextPid++ };
      },
    });
    const first = await fetch(`${base}/api/queue/projects/aide/test-server`, {
      method: "POST",
      redirect: "manual",
      headers: AUTH,
    });
    expect(first.status).toBe(303);
    const second = await fetch(`${base}/api/queue/projects/aide/test-server`, {
      method: "POST",
      redirect: "manual",
      headers: AUTH,
    });
    expect(second.status).toBe(303);
    expect(spawnCalls).toHaveLength(2);
  });

  test("cannot resolve the default branch: testServerFailedPage, no spawn", async () => {
    const git = fakeGit({ "ls-remote": { code: 0, stdout: "abc123\trefs/heads/main\n" } }); // no symbolic-ref/show-ref answer at all
    const spawnCalls: unknown[] = [];
    const { base } = start({
      gitRun: git.run,
      testServersAvailable: true,
      testServersSpawn: (cmd) => {
        spawnCalls.push(cmd);
        return { pid: 1 };
      },
    });
    const res = await fetch(`${base}/api/queue/projects/aide/test-server`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("cannot work out the default branch");
    expect(spawnCalls).toHaveLength(0);
  });
});

describe("POST /api/queue/projects/<name>/test-server/stop (AC-7)", () => {
  test("refuses for a project this dashboard does not know", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/projects/nosuch/test-server/stop`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(404);
  });

  test("only POST — the route takes no other method", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/projects/aide/test-server/stop`, { headers: AUTH });
    expect(res.status).toBe(405);
  });

  // AC-7: no spec ref is involved at all — the case the spec-scoped
  // route (board-controls.ts) cannot handle.
  test("stops a tracked main-board with no spec ref, redirecting for a no-script POST", async () => {
    const { base, server } = start();
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry());
    const res = await fetch(`${base}/api/queue/projects/aide/test-server/stop`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=deploy");
    expect(server.testServersStore().get("aide", MAIN_TEST_SERVER_KEY)).toBeUndefined();
  });

  // Stopping a board must not move the reader: the Test servers page
  // posts this same route with no script, and a fixed redirect to the
  // Deploy tab took them off the page they were standing on.
  test("a no-script POST comes back to the page it was posted from", async () => {
    const { base, server } = start();
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry());
    const res = await fetch(`${base}/api/queue/projects/aide/test-server/stop`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: `${base}/test-servers` },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/test-servers");
  });

  // A Referer from anywhere else is not followed: a string from the
  // client, reflected into a redirect, is an open-redirect surface.
  test("a Referer from another origin falls back to the Deploy tab", async () => {
    const { base, server } = start();
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry());
    const res = await fetch(`${base}/api/queue/projects/aide/test-server/stop`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: "https://elsewhere.example/test-servers" },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=deploy");
  });

  // The Test servers list's own Stop form carries class="actionform",
  // which specs-client.ts posts as a JSON-wanting XHR — this route must
  // answer that shape too, not only the no-script redirect.
  test("answers JSON for the actionform's own XHR", async () => {
    const { base, server } = start();
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry());
    const res = await fetch(`${base}/api/queue/projects/aide/test-server/stop`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(server.testServersStore().get("aide", MAIN_TEST_SERVER_KEY)).toBeUndefined();
  });
});

describe("GET /projects/<name>?startTestServer=1 (AC-5)", () => {
  test("nobody posted: redirects back to the Deploy tab without starting anything", async () => {
    const spawnCalls: unknown[] = [];
    const { base } = start({
      testServersAvailable: true,
      testServersSpawn: (cmd) => {
        spawnCalls.push(cmd);
        return { pid: 1 };
      },
    });
    const res = await fetch(`${base}/projects/aide?startTestServer=1`, {
      headers: {},
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=deploy");
    expect(spawnCalls).toHaveLength(0);
  });

  test("already running with a url: redirects to the board", async () => {
    const { base, server } = start({ testServersIsAlive: () => true });
    server.testServersStore().set(
      "aide",
      MAIN_TEST_SERVER_KEY,
      mainEntry({ status: "running", pid: 4242, url: "http://127.0.0.1:8801/?token=t0ken" }),
    );
    const res = await fetch(`${base}/projects/aide?startTestServer=1`, {
      headers: {},
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:8801/?token=t0ken");
  });

  test("failed: shows testServerFailedPage", async () => {
    const { base, server } = start();
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry({ status: "failed", error: "cannot check out main" }));
    const res = await fetch(`${base}/projects/aide?startTestServer=1`, {
      headers: {},
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("cannot check out main");
  });

  test("still starting: shows the waiting page", async () => {
    const { base, server } = start({ testServersIsAlive: () => true });
    server.testServersStore().set("aide", MAIN_TEST_SERVER_KEY, mainEntry({ status: "starting", pid: undefined, url: undefined }));
    const res = await fetch(`${base}/projects/aide?startTestServer=1`, {
      headers: {},
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Starting a test server");
    expect(html).toMatch(/http-equiv="refresh"/);
  });
});
