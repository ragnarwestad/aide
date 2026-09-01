// GET /spec-viewer.js (spec 333, finishing spec 315's split): the
// read-only rendering bundle, served from its own path and revalidated
// by ETag exactly the way /spec-editor.js already is —
// spec-editor-asset-route.test.ts's own pattern, mirrored onto the
// second route.
import { afterEach, describe, expect, test } from "bun:test";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-spec-viewer-asset-route-");
afterEach(() => harness.cleanup());

describe("GET /spec-viewer.js", () => {
  // REQ-5: a fresh server that has never answered any request still
  // serves the bundle on its very first request — no warm-up step.
  test("a fresh server's first request returns the bundle with an ETag", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-viewer.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("etag")).toBeTruthy();
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000);
  });

  test("a repeat GET with If-None-Match set to the prior ETag returns 304 with an empty body", async () => {
    const { base } = harness.start();
    const first = await fetch(`${base}/spec-viewer.js`);
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${base}/spec-viewer.js`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("a stale If-None-Match gets the full body back, not a 304", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-viewer.js`, { headers: { "if-none-match": '"not-a-real-etag"' } });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  test("HEAD answers the same way GET does, without a body", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-viewer.js`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  // Risk analysis: the bundle must import the vendor's dedicated Viewer
  // entry point, never the full Editor class — a silent regression back
  // to the ~767 KB editor bundle would still render correctly, so a
  // functional test would not catch it. This size ceiling would.
  test("stays under 500 KB — a regression back to the full Editor class would blow this", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/spec-viewer.js`);
    const body = await res.text();
    expect(body.length).toBeLessThan(500_000);
  });
});
