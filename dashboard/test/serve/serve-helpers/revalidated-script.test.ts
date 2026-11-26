// `serveRevalidatedScript`: the one response the Editor and Viewer
// bundles share — a missing build is a 404, a present one is served with
// `no-cache` and its ETag, and a matching If-None-Match gets a bodiless 304.

import { describe, expect, test } from "bun:test";
import { etagFor, serveRevalidatedScript } from "../../../src/serve/serve-helpers/static.ts";

const text = "console.log('bundle');";
const built = { text, etag: etagFor(text) };
const request = (ifNoneMatch?: string): Request =>
  new Request("http://localhost/bundle.js", ifNoneMatch ? { headers: { "if-none-match": ifNoneMatch } } : {});

describe("serveRevalidatedScript", () => {
  test("a built bundle is served as JavaScript with no-cache and its ETag (AC-1)", async () => {
    const res = serveRevalidatedScript(request(), built);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBe(built.etag);
    expect(await res.text()).toBe(text);
  });

  test("a matching If-None-Match gets 304 with no body, and a stale one the current bundle (AC-2)", async () => {
    const notModified = serveRevalidatedScript(request(built.etag), built);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(built.etag);
    expect(await notModified.text()).toBe("");

    const stale = serveRevalidatedScript(request('"not-a-real-etag"'), built);
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(text);
  });

  test("a bundle that failed to build is answered 404 not found (AC-3)", async () => {
    const res = serveRevalidatedScript(request(), undefined);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });
});
