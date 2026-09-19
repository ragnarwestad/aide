// The two POST routes a device talks to (AC-1, AC-6), through a real
// server: what they accept, what they refuse, and that the request
// guard in front of every queue route covers them too.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { fakeFetch, subscribeBody } from "./fixtures.ts";

const h = queueHarness("aide-push-routes-");
const dirs: string[] = [];
afterEach(() => {
  h.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function served() {
  const seen = fakeFetch();
  const tmp = mkdtempSync(join(tmpdir(), "aide-push-files-"));
  dirs.push(tmp);
  const subscriptionsPath = join(tmp, "push-subscriptions.json");
  const keyPath = join(tmp, "push-key.json");
  const { base } = h.start({ extra: { pushSubscriptionsPath: subscriptionsPath, pushKeyPath: keyPath, pushFetch: seen.fetch } });
  return { base, subscriptionsPath, keyPath, tmp };
}

describe("POST /api/push/subscribe", () => {
  test("stores a good subscription and answers ok", async () => {
    const s = served();
    const body = await subscribeBody();
    const res = await post(s.base, "/api/push/subscribe", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(readFileSync(s.subscriptionsPath, "utf-8")).toContain(body.endpoint);
  });

  test("the same endpoint twice is one subscription", async () => {
    const s = served();
    const body = await subscribeBody();
    await post(s.base, "/api/push/subscribe", body);
    await post(s.base, "/api/push/subscribe", { ...body, lang: "nb" });
    const stored = JSON.parse(readFileSync(s.subscriptionsPath, "utf-8")) as { endpoint: string; lang: string }[];
    expect(stored.filter((x) => x.endpoint === body.endpoint)).toEqual([expect.objectContaining({ lang: "nb" })]);
  });

  test.each([
    ["an endpoint that is not https", { endpoint: "http://fcm.googleapis.com/x" }],
    ["an endpoint that is not a push service", { endpoint: "https://169.254.169.254/latest" }],
    ["keys of the wrong size", { keys: { p256dh: "AAAA", auth: "AAAA" } }],
  ])("%s is refused with 400 and stores nothing", async (_name, over) => {
    const s = served();
    const res = await post(s.base, "/api/push/subscribe", { ...(await subscribeBody()), ...over });
    expect(res.status).toBe(400);
    expect(existsSync(s.subscriptionsPath)).toBe(false);
  });

  test("a body that is not JSON is refused with 400", async () => {
    const s = served();
    expect((await post(s.base, "/api/push/subscribe", "not json")).status).toBe(400);
  });

  test("a GET is not allowed", async () => {
    const s = served();
    expect((await fetch(`${s.base}/api/push/subscribe`)).status).toBe(405);
  });

  test("a cross-site POST is refused by the guard, before the route", async () => {
    const s = served();
    const res = await post(s.base, "/api/push/subscribe", await subscribeBody(), { origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(existsSync(s.subscriptionsPath)).toBe(false);
  });
});

describe("POST /api/push/unsubscribe", () => {
  test("removes the device's subscription and answers ok, also for one it never had", async () => {
    const s = served();
    const body = await subscribeBody();
    await post(s.base, "/api/push/subscribe", body);
    const res = await post(s.base, "/api/push/unsubscribe", { endpoint: body.endpoint });
    expect(res.status).toBe(200);
    expect(readFileSync(s.subscriptionsPath, "utf-8")).not.toContain(body.endpoint);
    expect((await post(s.base, "/api/push/unsubscribe", { endpoint: body.endpoint })).status).toBe(200);
  });

  test("a body with no endpoint is refused with 400", async () => {
    const s = served();
    expect((await post(s.base, "/api/push/unsubscribe", {})).status).toBe(400);
  });
});
