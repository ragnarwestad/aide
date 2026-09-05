import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, JOB, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("no token configured", () => {
  test("every queue route is 503; /api/aide-runs and POST /api/aide-run are unaffected", async () => {
    const { base } = start();
    for (const [path, init] of [
      // Spec 100: `/` is the list now, so it is behind the token like
      // every other read route on the queue surface — including the two
      // old addresses, which redirect to it only once the token is in.
      ["/", {}],
      ["/queue", {}],
      ["/specs", {}],
      ["/specs/abc", {}],
      ["/api/queue", {}],
      ["/api/queue/abc/approve", { method: "POST" }],
      ["/api/queue/abc/cancel", { method: "POST" }],
      // Spec 189's stream is on the same surface and behind the same
      // guard — a held-open connection outside it would be a bypass
      // that told anyone who could reach the port when work moved.
      ["/api/queue/events", {}],
    ] as const) {
      const res = await fetch(`${base}${path}`, init);
      expect(res.status).toBe(503);
      expect((await res.text()).toLowerCase()).toContain("token");
    }
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
    // The static overview kept its own address and its own openness: it
    // moved off `/`, not behind the token.
    expect((await fetch(`${base}/projects.html`)).status).toBe(200);
    const emitted = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "implement", spec: "81" }),
    });
    expect(emitted.status).toBe(200);
  });
});

describe("token configured", () => {
  test("a queue request without the token is 401", async () => {
    const { base } = start({ queueToken: TOKEN });
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/queue`)).status).toBe(401);
    expect((await fetch(`${base}/specs`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue`, { method: "POST", body: JSON.stringify(JOB) })).status).toBe(401);
    expect((await fetch(`${base}/?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/queue?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/specs?token=wrong`)).status).toBe(401);
    // Spec 189: and the event stream, which `EventSource` reaches with
    // the page's cookie and nothing else.
    expect((await fetch(`${base}/api/queue/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/queue/events?token=wrong`)).status).toBe(401);
  });

  test("the spec 80 emitter route stays open — a 401 there would empty /api/aide-runs silently", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/aide-run`, {
      method: "POST",
      body: JSON.stringify({ host: "h", sessionId: "s1", command: "analyze", spec: "81" }),
    });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/api/aide-runs`)).status).toBe(200);
  });

  test("GET /?token=… returns 200 and sets an HttpOnly cookie; the cookie then suffices", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`aide_token_${server.port}=`);
    expect(cookie).toContain("HttpOnly");
    // Lax, never Strict: a Strict cookie is withheld on a top-level
    // navigation that started somewhere else, and an installed app
    // launched from the home screen is one — the dashboard opened on
    // "unauthorized" on a phone whose browser was signed in
    // (2026-08-22). Lax still keeps it off a cross-site POST.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("SameSite=Strict");
    const jar = cookie.split(";")[0];
    expect((await fetch(`${base}/`, { headers: { cookie: jar } })).status).toBe(200);
  });

  test("the header works for API callers", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobs: [] });
  });
});
