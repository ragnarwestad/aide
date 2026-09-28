// Spec 252: the shared "← Back" primitives — `backLink()`'s markup and
// `resolveBackHref()`'s same-origin resolution of the
// standard `Referer` header. No render file had a test of its own for
// either shape before this.
import { describe, expect, test } from "bun:test";
import { resolveBackHref } from "../../../src/render/ui/components";

describe("resolveBackHref", () => {
  const ORIGIN = "https://dash.example";

  test("a same-origin referer is kept — path and query survive", () => {
    expect(resolveBackHref(`${ORIGIN}/?state=all&q=archive`, ORIGIN, "/")).toBe("/?state=all&q=archive");
  });

  test("no referer at all falls back", () => {
    expect(resolveBackHref(null, ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Criterion 5.
  test("a foreign-origin referer is discarded, not followed", () => {
    expect(resolveBackHref("https://evil.example/", ORIGIN, "/fallback")).toBe("/fallback");
  });

  // Behind the HTTPS proxy the board is reached through, the browser's
  // own `Referer` says https and the server's request says http: the
  // proxy ends TLS and forwards to `127.0.0.1:8788`. Comparing the
  // scheme threw every "← Back" on that address onto the fallback, and
  // took a reader who stopped a test server off the page they were on.
  // The same rule the admission check already follows: host and port,
  // never the scheme (`serve-helpers/request-guard.ts`).
  test("a proxy that ended TLS is the same origin — the scheme is not compared", () => {
    expect(resolveBackHref("https://dash.example/test-servers", "http://dash.example", "/fallback")).toBe(
      "/test-servers",
    );
  });

  test("a different port is a different origin, scheme or no scheme", () => {
    expect(resolveBackHref("https://dash.example:8443/x", "http://dash.example", "/fallback")).toBe("/fallback");
  });

  test("a malformed referer falls back rather than throwing", () => {
    expect(resolveBackHref("not a url", ORIGIN, "/fallback")).toBe("/fallback");
  });
});
