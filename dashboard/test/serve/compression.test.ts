// compressResponse (spec 315, REQ-3): gzip applied once, centrally, to
// every response the server answers — never to the one response
// (/api/queue/events, text/event-stream) that must stay unbuffered.
import { afterEach, describe, expect, test } from "bun:test";
import { compressResponse } from "../../src/serve/serve-helpers.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const gzipReq = () => new Request("http://x/", { headers: { "accept-encoding": "gzip, deflate, br" } });
const plainReq = () => new Request("http://x/");

const big = (type: string, bytes = 2000) =>
  new Response("x".repeat(bytes), { headers: { "content-type": type } });

describe("compressResponse (unit)", () => {
  test("gzips a compressible, over-threshold response when the client asked for gzip", async () => {
    const original = big("text/html; charset=utf-8");
    const originalBytes = new Uint8Array(await original.clone().arrayBuffer()).byteLength;
    const res = await compressResponse(gzipReq(), original);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("accept-encoding");
    const gzippedBytes = new Uint8Array(await res.arrayBuffer()).byteLength;
    expect(gzippedBytes).toBeLessThan(originalBytes);
  });

  test("leaves the response alone when the client did not ask for gzip", async () => {
    const res = await compressResponse(plainReq(), big("text/html"));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves a response under the size threshold alone, even with gzip requested", async () => {
    const res = await compressResponse(gzipReq(), big("text/html", 100));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves a non-whitelisted content-type alone, even over threshold with gzip requested", async () => {
    const res = await compressResponse(gzipReq(), big("application/octet-stream"));
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("leaves a response that already carries a content-encoding alone", async () => {
    const already = new Response("x".repeat(2000), {
      headers: { "content-type": "text/html", "content-encoding": "br" },
    });
    const res = await compressResponse(gzipReq(), already);
    expect(res.headers.get("content-encoding")).toBe("br");
  });

  test("leaves a HEAD response alone without reading its body", async () => {
    const headReq = new Request("http://x/", {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    });
    const original = big("text/html");
    const res = await compressResponse(headReq, original);
    expect(res).toBe(original);
  });

  test("leaves a 304 alone", async () => {
    const notModified = new Response(null, { status: 304, headers: { "content-type": "text/html" } });
    const res = await compressResponse(gzipReq(), notModified);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("never touches a streaming response — the SSE route's own shape", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": open\n\n"));
        // deliberately never closed: an SSE body stays open for as
        // long as the connection lives.
      },
    });
    const sse = new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
    const res = await compressResponse(gzipReq(), sse);
    expect(res).toBe(sse);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  for (const type of ["text/javascript", "application/json", "application/manifest+json", "image/svg+xml"]) {
    test(`compresses ${type} too`, async () => {
      const res = await compressResponse(gzipReq(), big(type));
      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  }
});

describe("compressResponse, wired into the real server", () => {
  const TOKEN = "s3cret-token";
  const harness = queueHarness("aide-compression-");
  afterEach(() => harness.cleanup());

  test("a document tab's HTML is served gzipped when the client asks for it", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/specs/aide/81-queue-and-runner?tab=description`, {
      headers: { "x-aide-token": TOKEN, "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("a small, non-whitelisted response (405) carries no content-encoding", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/spec-editor.js`, {
      method: "DELETE",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  // The one response a compression wrapper must never buffer: SSE holds
  // the body open indefinitely, so gzipping it would mean waiting
  // forever for a "whole body" that never comes.
  test("GET /api/queue/events keeps streaming, uncompressed, with gzip requested", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/events?token=${TOKEN}`, {
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("content-encoding")).toBeNull();
    await res.body!.cancel();
  });
});
