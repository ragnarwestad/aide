// The dashboard's one admission rule: a Host that is its own, and — for a
// request that changes something — an Origin that is its own Host.
import { describe, expect, test } from "bun:test";
import { checkRequest } from "../../../src/serve/serve-helpers/request-guard.ts";
import { createHostAllowlist } from "../../../src/serve/serve-helpers/tailscale-name.ts";

const hosts = createHostAllowlist({ extra: [], lookup: async () => undefined });

const req = (method: string, headers: Record<string, string>, path = "/x") =>
  new Request(`http://127.0.0.1:8788${path}`, { method, headers });

describe("Host (AC-3)", () => {
  test("localhost, 127.0.0.1 and [::1] are admitted, in any case, with or without a port", async () => {
    for (const host of ["localhost:8788", "LOCALHOST:8788", "127.0.0.1:8788", "127.0.0.1", "[::1]:8788", "[::1]"]) {
      expect(await checkRequest(req("GET", { host }), hosts)).toBeNull();
    }
  });

  test("another name is refused with 403, and the body names it", async () => {
    const res = await checkRequest(req("GET", { host: "evil.example" }), hosts);
    expect(res?.status).toBe(403);
    expect(await res!.text()).toContain("evil.example");
  });

  test("no Host and an empty Host are refused and never throw", async () => {
    expect((await checkRequest(new Request("http://127.0.0.1:8788/x"), hosts))?.status).toBe(403);
    expect((await checkRequest(req("GET", { host: "" }), hosts))?.status).toBe(403);
    expect((await checkRequest(req("GET", { host: ":80" }), hosts))?.status).toBe(403);
  });
});

describe("Origin on a request that changes something (AC-2)", () => {
  const host = "127.0.0.1:8788";

  test("an Origin equal to its own Host is admitted; no Origin is admitted", async () => {
    expect(await checkRequest(req("POST", { host, origin: "http://127.0.0.1:8788" }), hosts)).toBeNull();
    expect(await checkRequest(req("POST", { host }), hosts)).toBeNull();
    // the scheme is ignored: tailscale serve terminates TLS
    expect(await checkRequest(req("POST", { host, origin: "https://127.0.0.1:8788" }), hosts)).toBeNull();
  });

  test("a foreign Origin, null, garbage and the same name on another port answer 403", async () => {
    for (const origin of [
      "https://evil.example",
      "null",
      "not a url",
      "http://127.0.0.1:1",
      "http://localhost:8788",
      "http://localhost:9999",
    ]) {
      expect((await checkRequest(req("POST", { host, origin }), hosts))?.status).toBe(403);
    }
  });

  test("PUT, PATCH and DELETE are held to the same rule", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect((await checkRequest(req(method, { host, origin: "https://evil.example" }), hosts))?.status).toBe(403);
    }
  });

  test("GET, HEAD and OPTIONS with a foreign Origin or cross-site are not refused by this rule", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const headers = { host, origin: "https://evil.example", "sec-fetch-site": "cross-site" };
      expect(await checkRequest(req(method, headers), hosts)).toBeNull();
    }
  });

  test("a POST with Sec-Fetch-Site cross-site or same-site is refused; same-origin and none pass", async () => {
    for (const site of ["cross-site", "same-site"]) {
      expect((await checkRequest(req("POST", { host, "sec-fetch-site": site }), hosts))?.status).toBe(403);
    }
    for (const site of ["same-origin", "none"]) {
      expect(await checkRequest(req("POST", { host, "sec-fetch-site": site }), hosts)).toBeNull();
    }
  });
});

describe("the one GET that starts a test board (AC-2)", () => {
  const host = "127.0.0.1:8788";
  const path = "/specs/aide/1-x?tab=steps&startTestServer=1";

  test("cross-site and same-site are refused", async () => {
    for (const site of ["cross-site", "same-site"]) {
      expect((await checkRequest(req("GET", { host, "sec-fetch-site": site }, path), hosts))?.status).toBe(403);
    }
  });

  test("same-origin, none and no header are not refused; the same GET without the parameter never is", async () => {
    const variants: Record<string, string>[] = [{ host, "sec-fetch-site": "same-origin" }, { host, "sec-fetch-site": "none" }, { host }];
    for (const headers of variants) {
      expect(await checkRequest(req("GET", headers, path), hosts)).toBeNull();
    }
    expect(await checkRequest(req("GET", { host, "sec-fetch-site": "cross-site" }, "/specs/aide/1-x?tab=steps"), hosts)).toBeNull();
  });
});
