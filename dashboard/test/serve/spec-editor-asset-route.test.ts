// GET /spec-editor.js (spec 315, REQ-1/REQ-2/REQ-5): the editor bundle,
// served from its own path instead of inlined into every document tab,
// revalidated by ETag so a browser holding a copy asks "still this?"
// instead of re-downloading ~770 KB.
import { afterEach, describe, expect, test } from "bun:test";
import { etagFor } from "../../src/serve/serve-helpers.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-spec-editor-asset-route-");
afterEach(() => harness.cleanup());

describe("GET /spec-editor.js", () => {
  // REQ-5: a fresh server that has never answered any request still
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

  // REQ-2, reuse half: a repeat request carrying the first response's
  // own ETag is told nothing has changed, rather than sent the bundle
  // again.
  test("a repeat GET with If-None-Match set to the prior ETag returns 304 with an empty body", async () => {
    const { base } = harness.start();
    const first = await fetch(`${base}/spec-editor.js`);
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${base}/spec-editor.js`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("a stale If-None-Match gets the full body back, not a 304", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-editor.js`, { headers: { "if-none-match": '"not-a-real-etag"' } });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  test("HEAD answers the same way GET does, without a body", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-editor.js`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

// REQ-2, second clause: two different bundle texts must never share an
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
