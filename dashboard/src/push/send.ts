// One push to one device: encrypt, sign, POST. What comes back is a
// status, never an exception — a device that cannot be reached must not
// cost the others their message.

import { encrypt } from "./encrypt.ts";
import type { Subscription } from "./subscriptions.ts";
import { signToken, type VapidKeys } from "./vapid.ts";

export type SendOutcome = { status: number; detail: string } | { error: string };

const bytes = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text, "base64url"));

export async function sendPush(
  sub: Subscription,
  payload: string,
  keys: VapidKeys,
  send: typeof fetch,
): Promise<SendOutcome> {
  try {
    const body = await encrypt(new TextEncoder().encode(payload), { p256dh: bytes(sub.p256dh), auth: bytes(sub.auth) });
    const token = await signToken(keys, { endpoint: sub.endpoint, sub: sub.origin });
    const res = await send(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: `vapid t=${token}, k=${keys.publicKey}`,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "86400",
        urgency: "high",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: res.status, detail: "" };
    // The service's own words say why it refused; never the payload.
    return { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 200) };
  } catch (e) {
    return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
