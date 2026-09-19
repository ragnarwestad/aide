// The dashboard asks for no token: it refuses a request whose Host is not its
// own and a state-changing request whose Origin is not its own Host.
import { afterEach, describe, expect, test } from "bun:test";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

const hostOf = (base: string) => new URL(base).host;

describe("no credential is asked for (AC-1)", () => {
  test("the pages answer 200 with nothing but a request, and set no token cookie", async () => {
    const { base } = start();
    for (const path of ["/", "/new", "/projects", "/settings", "/schedule"]) {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie") ?? "").not.toContain("aide_token");
    }
  });

  test("an old ?token= bookmark answers 200, sets no cookie, and no page carries a token field", async () => {
    const { base } = start();
    const res = await fetch(`${base}/?token=abc`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("token");
    for (const path of ["/", "/new", "/projects", "/settings", "/schedule", "/specs/aide/81-queue-and-runner"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).not.toContain('name="token"');
    }
  });
});

describe("a request from another site is refused (AC-2)", () => {
  const FOREIGN = { origin: "https://evil.example" };

  test("a POST to one route of each family answers 403 and nothing is enqueued", async () => {
    const { base } = start();
    for (const path of [
      "/api/queue",
      "/api/queue/abc/cancel",
      "/api/queue/projects",
      "/api/queue/settings",
      "/schedule/new",
      "/api/self-stop",
      "/api/queue/specs/aide/81-queue-and-runner/model",
    ]) {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: FOREIGN, body: JSON.stringify(JOB) });
      expect(res.status).toBe(403);
    }
    const list = (await (await fetch(`${base}/api/queue`)).json()) as { jobs?: unknown[] } | unknown[];
    expect(Array.isArray(list) ? list : (list.jobs ?? [])).toEqual([]);
  });

  test("a POST whose Origin is its own Host is let through to the route", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { origin: `http://${hostOf(base)}` },
      body: JSON.stringify(JOB),
    });
    expect(res.status).not.toBe(403);
  });

  test("the GET that starts a test board is refused when it comes from another site", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/81-queue-and-runner?tab=steps&startTestServer=1`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });
});

describe("a Host that is not its own is refused (AC-3)", () => {
  test("on every route, the static site, /live and the emitter's POST included", async () => {
    const { base } = start();
    const headers = { host: "evil.example" };
    for (const path of ["/", "/api/queue", "/projects.html", "/live", "/api/version"]) {
      expect((await fetch(`${base}${path}`, { headers })).status).toBe(403);
    }
    const emitted = await fetch(`${base}/api/aide-run`, { method: "POST", headers, body: "{}" });
    expect(emitted.status).toBe(403);
  });

  test("the loopback names are admitted, with the port", async () => {
    const { base } = start();
    const port = new URL(base).port;
    for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}`]) {
      expect((await fetch(`${base}/api/queue`, { headers: { host } })).status).toBe(200);
    }
  });

  test("the machine's Tailscale name is admitted, with and without a port; a sibling is not", async () => {
    const name = "rw-macmini.tail1234.ts.net";
    const { base } = start({ tailscaleName: async () => name });
    for (const host of [name, `${name}:8801`]) {
      expect((await fetch(`${base}/api/queue`, { headers: { host } })).status).toBe(200);
    }
    for (const host of ["other.tail1234.ts.net", `evil.${name}`]) {
      expect((await fetch(`${base}/api/queue`, { headers: { host } })).status).toBe(403);
    }
  });

  test("a name in allowedHosts is admitted, in any case", async () => {
    const { base } = start({ allowedHosts: ["board.example.com"] });
    expect((await fetch(`${base}/api/queue`, { headers: { host: "Board.Example.com" } })).status).toBe(200);
    expect((await fetch(`${base}/api/queue`, { headers: { host: "other.example.com" } })).status).toBe(403);
  });
});
