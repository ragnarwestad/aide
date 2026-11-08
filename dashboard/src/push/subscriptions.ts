// What the server keeps about each device that turned notifications on:
// where to send (an endpoint at one of the push services), the keys to
// encrypt with, the language to write in, and the server key it was
// made under. One JSON file, read like every sibling file — a missing or
// corrupt one is empty, never an error.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LANGUAGES, type Language } from "../i18n";

export interface Subscription {
  endpoint: string;
  /** The device's public point, base64url, 65 bytes decoded. */
  p256dh: string;
  /** The device's authentication secret, base64url, 16 bytes decoded. */
  auth: string;
  lang: Language;
  /** The origin the subscribe request was made to; the token's `sub` claim. */
  origin: string;
  /** The server public key this subscription was made under. Once the
   *  server's pair is lost, nothing can be delivered under the old one. */
  key: string;
}

/** The push services a browser's endpoint can name. The endpoint is a
 *  URL this server POSTs to, so anything else — an address on the
 *  machine's own network above all — is refused. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

export function isPushHost(host: string): boolean {
  return PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((s) => host.endsWith(s));
}

const decoded = (text: unknown): Buffer | null => {
  if (typeof text !== "string" || !/^[\w-]+={0,2}$/.test(text)) return null;
  return Buffer.from(text, "base64url");
};

export type ParsedSubscribe = { ok: true; sub: Omit<Subscription, "key"> } | { ok: false; error: string };

/** A subscribe body as a browser's `PushSubscription.toJSON()` plus the
 *  language the page is read in. */
export function parseSubscribe(body: unknown, origin: string): ParsedSubscribe {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null; lang?: unknown } | null;
  if (!b || typeof b !== "object" || typeof b.endpoint !== "string") return { ok: false, error: "no endpoint" };
  let url: URL;
  try {
    url = new URL(b.endpoint);
  } catch {
    return { ok: false, error: "the endpoint is not a URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "the endpoint is not https" };
  if (!isPushHost(url.hostname)) return { ok: false, error: "the endpoint is not a known push service" };
  const p256dh = decoded(b.keys?.p256dh);
  const auth = decoded(b.keys?.auth);
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4) return { ok: false, error: "p256dh is not a P-256 point" };
  if (!auth || auth.length !== 16) return { ok: false, error: "auth is not 16 bytes" };
  const lang = LANGUAGES.includes(b.lang as Language) ? (b.lang as Language) : "en";
  return { ok: true, sub: { endpoint: b.endpoint, p256dh: b.keys!.p256dh as string, auth: b.keys!.auth as string, lang, origin } };
}

/** The subscriptions made under `key`, one per endpoint (the last one
 *  written wins). */
export function readSubscriptions(path: string, key: string): Subscription[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const byEndpoint = new Map<string, Subscription>();
  for (const s of raw as Partial<Subscription>[]) {
    if (!s || typeof s.endpoint !== "string" || typeof s.p256dh !== "string" || typeof s.auth !== "string") continue;
    if (s.key !== key) continue;
    byEndpoint.set(s.endpoint, {
      endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, key,
      lang: LANGUAGES.includes(s.lang as Language) ? (s.lang as Language) : "en",
      origin: typeof s.origin === "string" ? s.origin : "",
    });
  }
  return [...byEndpoint.values()];
}

export function writeSubscriptions(path: string, subs: Subscription[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(subs, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
