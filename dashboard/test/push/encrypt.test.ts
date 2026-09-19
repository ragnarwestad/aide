// The message encryption is pinned by the RFC's own example (RFC 8291,
// section 5 and appendix A), not by the code agreeing with itself
// (criterion 16). `encrypt()` takes the ephemeral key and the salt as
// arguments only so this vector can be reproduced.
import { describe, expect, test } from "bun:test";
import { encrypt } from "../../src/push/encrypt.ts";
import { b64u, decryptPush, deviceKeys, fromB64u } from "./fixtures.ts";

const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function ephemeral(privateB64: string, publicB64: string) {
  const pub = fromB64u(publicB64);
  const jwk = { kty: "EC", crv: "P-256", d: privateB64, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { publicRaw: pub, privateKey };
}

describe("encrypt() against RFC 8291 (criterion 16)", () => {
  test("the RFC's example message comes out byte for byte", async () => {
    const body = await encrypt(
      new TextEncoder().encode(VECTOR.plaintext),
      { p256dh: fromB64u(VECTOR.uaPublic), auth: fromB64u(VECTOR.auth) },
      { ephemeral: await ephemeral(VECTOR.asPrivate, VECTOR.asPublic), salt: fromB64u(VECTOR.salt) },
    );
    expect(b64u(body)).toBe(VECTOR.body);
  });

  test("a message for a real device decrypts back to the payload, with a fresh key and salt each time", async () => {
    const device = await deviceKeys();
    const sub = { p256dh: fromB64u(device.p256dh), auth: fromB64u(device.auth) };
    const payload = JSON.stringify({ title: "aide · 81", body: "Implement failed — press Implement again.", url: "/specs/aide/81" });
    const a = await encrypt(new TextEncoder().encode(payload), sub);
    const b = await encrypt(new TextEncoder().encode(payload), sub);
    expect(await decryptPush(a, device)).toBe(payload);
    expect(b64u(a)).not.toBe(b64u(b));
  });

  test("a payload too long for one record is refused rather than sent wrong", async () => {
    const device = await deviceKeys();
    const sub = { p256dh: fromB64u(device.p256dh), auth: fromB64u(device.auth) };
    await expect(encrypt(new Uint8Array(4100), sub)).rejects.toThrow();
  });
});
