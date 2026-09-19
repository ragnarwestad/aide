// Shared pieces for the push tests: a device's own keys (real P-256, so
// an encrypted message can be opened again), a `fetch` that records what
// leaves the machine instead of sending it, and a real queue store
// whose changes drive the observer.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job, type QueueDefaults } from "../../src/queue/queue.ts";
import type { WorkflowStep } from "../../src/queue/steps.ts";

export const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

export const SPEC = "81-queue-and-runner";

export const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const fromB64u = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text, "base64url"));

/** A device's half of a subscription: the keys the browser hands over,
 *  and the private key that opens what the server encrypts for it. */
export async function deviceKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, p256dh: b64u(p256dh), auth: b64u(auth) };
}

let counter = 0;
/** The body a browser posts to `/api/push/subscribe`. */
export async function subscribeBody(over: { endpoint?: string; lang?: string } = {}) {
  const keys = await deviceKeys();
  counter += 1;
  return {
    endpoint: over.endpoint ?? `https://fcm.googleapis.com/fcm/send/device-${counter}`,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    lang: over.lang ?? "en",
  };
}

export type Answer = number | Error | "hang";
export interface Call {
  url: string;
  headers: Record<string, string>;
  body: Bytes;
}

/** A `fetch` that answers per endpoint (200-range by default) and keeps
 *  every request, so a test can see what would have left the machine. */
export function fakeFetch(answer: (url: string) => Answer = () => 201) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: new Uint8Array(init?.body as ArrayBuffer),
    });
    const a = answer(url);
    if (a instanceof Error) throw a;
    if (a === "hang") throw new DOMException("timed out", "TimeoutError");
    return new Response("", { status: a });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

const RESOLVE = (project: string) => (project === "aide" ? { specFolders: [SPEC, "82-another-spec"] } : null);

export function tempDir(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "aide-push-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A real store whose every change is handed to `onChange`. */
export function makeStore(onChange: () => void = () => {}, mirrorPath?: string) {
  return new QueueStore({ defaults: DEFAULTS, resolve: RESOLVE, onChange, mirrorPath, allowCreateProject: () => true });
}

/** A queued job for a spec, taken to `running`. */
export function runningJob(store: QueueStore, steps: string[] = ["implement"], specFolder = SPEC): Job {
  const made = store.enqueue({ project: "aide", specFolder, steps });
  if (!made.ok) throw new Error(made.error);
  const started = store.transition(made.job.id, "start", { startedAt: new Date().toISOString() });
  if (!started.ok) throw new Error("start refused");
  return started.job;
}

export const result = (step: WorkflowStep, terminalReason = "completed", ok = true) => ({
  step, ok, costUsd: 0, costMeasured: true, terminalReason, at: new Date().toISOString(),
});

const enc = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** What a device does with a pushed message (RFC 8291 section 3-4),
 *  written from the receiving side so it shares nothing with `encrypt()`
 *  but the RFC. Returns the plain text. */
export async function decryptPush(body: Bytes, device: { privateKey: CryptoKey; p256dh: string; auth: string }): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = fromB64u(device.p256dh);
  const theirs = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, device.privateKey, 256));
  const keyInfo = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(fromB64u(device.auth), secret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  return new TextDecoder().decode(padded.slice(0, end - 1)); // the 0x02 delimiter
}

/** The JSON a delivered push carried, opened with the device's key. */
export const openCall = async (call: Call, device: Parameters<typeof decryptPush>[1]) =>
  JSON.parse(await decryptPush(call.body, device)) as { title: string; body: string; url: string };
