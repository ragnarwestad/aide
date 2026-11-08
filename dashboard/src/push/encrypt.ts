// Message encryption for Web Push (RFC 8291, `aes128gcm` content coding
// of RFC 8188), on WebCrypto. One record only: a notification is a few
// hundred bytes, and a payload that would not fit is refused rather than
// split.

const RECORD_SIZE = 4096;
/** The record holds the payload, one delimiter byte and a 16-byte tag. */
export const MAX_PAYLOAD = RECORD_SIZE - 16 - 1;

/** WebCrypto takes a view over a plain `ArrayBuffer`, not a shared one. */
type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export interface DeviceKeys {
  /** The device's public point, 65 bytes. */
  p256dh: Bytes;
  /** The device's 16-byte authentication secret. */
  auth: Bytes;
}

export interface Ephemeral {
  publicRaw: Bytes;
  privateKey: CryptoKey;
}

/** The whole request body for one push. `opts` exists so the RFC's own
 *  example can be reproduced; a real send leaves it out and gets a fresh
 *  key and salt. */
export async function encrypt(
  payload: Bytes,
  device: DeviceKeys,
  opts: { ephemeral?: Ephemeral; salt?: Bytes } = {},
): Promise<Bytes> {
  if (payload.length > MAX_PAYLOAD) throw new Error(`push payload of ${payload.length} bytes does not fit one record`);
  let ephemeral = opts.ephemeral;
  if (!ephemeral) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    ephemeral = { publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: pair.privateKey };
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const theirs = await crypto.subtle.importKey("raw", device.p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, ephemeral.privateKey, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), device.p256dh, ephemeral.publicRaw);
  const ikm = await hkdf(device.auth, secret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (here the only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = ephemeral.publicRaw.length;
  return concat(header, ephemeral.publicRaw, sealed);
}
