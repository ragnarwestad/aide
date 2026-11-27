// GET /spec-editor.js: the editor bundle,
// served from its own path instead of inlined into every document tab,
// revalidated by ETag so a browser holding a copy asks "still this?"
// instead of re-downloading ~770 KB.
import { afterEach, describe, expect, test } from "bun:test";
import { etagFor } from "../../../src/serve/serve-helpers";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-spec-editor-asset-route-");
afterEach(() => harness.cleanup());

describe("GET /spec-editor.js", () => {
  // A fresh server that has never answered any request still
  // serves the bundle on its very first request — no warm-up step.
  test("a fresh server's first request returns the bundle with an ETag", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-editor.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("etag")).toBeTruthy();
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000);
  });

});

// Second clause: two different bundle texts must never share an
// ETag — that is what makes a stale If-None-Match (computed by a browser
// against a PRIOR process's build) fall through to the fresh-body path
// above rather than a wrongly-served 304.
describe("etagFor", () => {
  test("two different texts produce two different ETags", () => {
    expect(etagFor("a")).not.toBe(etagFor("b"));
  });

  test("the same text always produces the same ETag", () => {
    expect(etagFor("same text")).toBe(etagFor("same text"));
  });
});
