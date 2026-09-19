// The server's identity to the push services (RFC 8292): a key pair that
// is made once and kept, and a signed token per request (criterion 16).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadOrCreateKeys, signToken } from "../../src/push/vapid.ts";
import { fromB64u, tempDir } from "./fixtures.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const dirOf = () => {
  const t = tempDir();
  cleanups.push(t.done);
  return t.dir;
};

describe("the key pair", () => {
  test("is written once with mode 0600, and the same one is read back", async () => {
    const path = join(dirOf(), "push-key.json");
    const first = await loadOrCreateKeys(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const again = await loadOrCreateKeys(path);
    expect(again.publicKey).toBe(first.publicKey);
    expect(fromB64u(first.publicKey)).toHaveLength(65);
  });

  test("a corrupt file is replaced by a new pair instead of throwing", async () => {
    const path = join(dirOf(), "push-key.json");
    await Bun.write(path, "{not json");
    const keys = await loadOrCreateKeys(path);
    expect(fromB64u(keys.publicKey)).toHaveLength(65);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toBeTruthy();
  });

  test("with no path the pair lives in memory and no file appears", async () => {
    const dir = dirOf();
    const keys = await loadOrCreateKeys(undefined);
    expect(keys.publicKey).toBeTruthy();
    expect(existsSync(join(dir, "push-key.json"))).toBe(false);
  });
});

describe("the signed token", () => {
  test("header, audience, expiry, subject and signature all verify against the public key sent with it", async () => {
    const keys = await loadOrCreateKeys(undefined);
    const now = 1_800_000_000;
    const token = await signToken(keys, { endpoint: "https://fcm.googleapis.com/fcm/send/abc", sub: "https://board.test", now });
    const [h, p, s] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { aud: string; exp: number; sub: string };
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("https://board.test");
    expect(claims.exp).toBeGreaterThan(now);
    expect(claims.exp).toBeLessThanOrEqual(now + 24 * 60 * 60);

    const publicKey = await crypto.subtle.importKey("raw", fromB64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signature = fromB64u(s);
    expect(signature).toHaveLength(64);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    // A different message does not verify: the check is not vacuous.
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(`${h}.x${p}`))).toBe(false);
  });
});
