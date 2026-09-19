// What the server accepts as a subscription, and what it keeps
// (AC-6, criterion 15). The endpoint is a URL this server will POST to,
// so the check on it is the security boundary of the whole feature.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSubscribe, readSubscriptions, writeSubscriptions, type Subscription } from "../../src/push/subscriptions.ts";
import { b64u, subscribeBody, tempDir } from "./fixtures.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("a subscribe request is checked before anything is stored (criterion 15)", () => {
  test("a good one is accepted, with its language and the origin it was made to", async () => {
    const body = await subscribeBody({ lang: "nb" });
    const parsed = parseSubscribe(body, "https://board.test");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.sub).toMatchObject({ endpoint: body.endpoint, lang: "nb", origin: "https://board.test" });
  });

  test.each([
    "http://fcm.googleapis.com/fcm/send/x",
    "https://example.com/fcm/send/x",
    "https://127.0.0.1/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://evil.test/fcm.googleapis.com",
    "not a url",
  ])("the endpoint %s is refused", async (endpoint) => {
    expect(parseSubscribe(await subscribeBody({ endpoint }), "https://board.test").ok).toBe(false);
  });

  test.each([
    "https://fcm.googleapis.com/fcm/send/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ])("the push service %s is accepted", async (endpoint) => {
    expect(parseSubscribe(await subscribeBody({ endpoint }), "https://board.test").ok).toBe(true);
  });

  test("keys of the wrong size or the wrong kind are refused", async () => {
    const good = await subscribeBody();
    const shortPoint = { ...good, keys: { ...good.keys, p256dh: b64u(new Uint8Array(64).fill(4)) } };
    const notUncompressed = { ...good, keys: { ...good.keys, p256dh: b64u(new Uint8Array(65).fill(7)) } };
    const shortSecret = { ...good, keys: { ...good.keys, auth: b64u(new Uint8Array(15)) } };
    for (const bad of [shortPoint, notUncompressed, shortSecret, { endpoint: good.endpoint }, null, "x", { ...good, keys: null }]) {
      expect(parseSubscribe(bad, "https://board.test").ok).toBe(false);
    }
  });

  test("an unknown language falls back to English rather than being stored as sent", async () => {
    const parsed = parseSubscribe(await subscribeBody({ lang: "<script>" }), "https://board.test");
    expect(parsed.ok && parsed.sub.lang).toBe("en");
  });
});

describe("the file", () => {
  const make = async (over: Partial<Subscription> = {}): Promise<Subscription> => {
    const b = await subscribeBody();
    return { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, lang: "en", origin: "https://board.test", key: "KEY-1", ...over };
  };
  const pathOf = () => {
    const t = tempDir();
    cleanups.push(t.done);
    return join(t.dir, "push-subscriptions.json");
  };

  test("round-trips", async () => {
    const path = pathOf();
    const a = await make();
    writeSubscriptions(path, [a]);
    expect(readSubscriptions(path, "KEY-1")).toEqual([a]);
  });

  test("one subscription is kept per endpoint", async () => {
    const path = pathOf();
    const a = await make();
    writeSubscriptions(path, [a, { ...a, lang: "nb" }]);
    const kept = readSubscriptions(path, "KEY-1");
    expect(kept).toHaveLength(1);
    expect(kept[0]!.lang).toBe("nb");
  });

  test("subscriptions made under a key the server no longer has are dropped when read", async () => {
    const path = pathOf();
    const old = await make({ key: "OLD" });
    const current = await make();
    writeSubscriptions(path, [old, current]);
    expect(readSubscriptions(path, "KEY-1").map((s) => s.endpoint)).toEqual([current.endpoint]);
  });

  test("a missing or corrupt file reads as empty and never throws", async () => {
    const path = pathOf();
    expect(readSubscriptions(path, "KEY-1")).toEqual([]);
    await Bun.write(path, "{oops");
    expect(readSubscriptions(path, "KEY-1")).toEqual([]);
    expect(readFileSync(path, "utf-8")).toBe("{oops");
  });
});
