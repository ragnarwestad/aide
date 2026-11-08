// The server's identity to the push services (RFC 8292, VAPID): an
// ES256 key pair made once and kept, and a short-lived signed token that
// goes with every request. WebCrypto only — no dependency.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface VapidKeys {
  /** The uncompressed public point, base64url — what a browser is given
   *  as `applicationServerKey` and what the token's `k=` carries. */
  publicKey: string;
  privateKey: CryptoKey;
}

const CURVE = { name: "ECDSA", namedCurve: "P-256" } as const;
const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const text = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

async function fromJwk(jwk: JsonWebKey): Promise<VapidKeys> {
  const privateKey = await crypto.subtle.importKey("jwk", jwk, CURVE, true, ["sign"]);
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  return { publicKey: b64u(new Uint8Array([4, ...x, ...y])), privateKey };
}

/** Reads the pair at `path`, or makes one and writes it with mode 0600.
 *  A missing or unreadable file makes a new pair: every subscription
 *  made under the old one is dropped when the subscriptions are read
 *  (`subscriptions.ts`), and each device turns notifications on again.
 *  No path keeps the pair in memory only. */
export async function loadOrCreateKeys(path: string | undefined): Promise<VapidKeys> {
  if (path && existsSync(path)) {
    try {
      const jwk = JSON.parse(readFileSync(path, "utf-8")) as JsonWebKey;
      if (jwk.d && jwk.x && jwk.y) return await fromJwk(jwk);
    } catch {
      // fall through: a corrupt file is replaced, never thrown over
    }
  }
  const pair = (await crypto.subtle.generateKey(CURVE, true, ["sign"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (path) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(jwk), { mode: 0o600 });
      chmodSync(path, 0o600); // `mode` is ignored when the file already exists
    } catch {
      // The pair still works for this run; only a restart would lose it.
    }
  }
  return fromJwk(jwk);
}

/** The `Authorization` token for one push: audience the endpoint's
 *  origin, at most 24 hours to live, `sub` the contact URL. */
export async function signToken(
  keys: VapidKeys,
  o: { endpoint: string; sub: string; now?: number },
): Promise<string> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const header = b64u(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(text(JSON.stringify({ aud: new URL(o.endpoint).origin, exp: now + 12 * 60 * 60, sub: o.sub })));
  const signed = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, text(signed)));
  return `${signed}.${b64u(signature)}`;
}
