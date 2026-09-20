// Spec 515: streamedPage sends the head at once and the rest when it is
// ready, starts the rest without waiting to be read, and ends a page whose
// rest fails with the fallback instead of leaving it hanging.
import { describe, expect, spyOn, test } from "bun:test";
import { streamedPage } from "../../../src/serve/serve-helpers";

const HEADERS = () => new Headers({ "content-type": "text/html; charset=utf-8" });

describe("streamedPage", () => {
  test("the rest is already being built before any chunk is read (AC-4)", () => {
    let calls = 0;
    streamedPage({ head: "<head>", rest: async () => { calls++; return "<rest>"; }, failedRest: "<failed>", headers: HEADERS() });
    expect(calls).toBe(1);
  });

  test("the head is readable while the rest is still held back (AC-4)", async () => {
    let release!: (s: string) => void;
    const held = new Promise<string>((r) => { release = r; });
    const res = streamedPage({ head: "<head>", rest: () => held, failedRest: "<failed>", headers: HEADERS() });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("<head>");
    release("<rest>");
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("<rest>");
    expect((await reader.read()).done).toBe(true);
  });

  test("closing the stream while the rest is held back cancels cleanly (AC-4)", async () => {
    let release!: (s: string) => void;
    const held = new Promise<string>((r) => { release = r; });
    const res = streamedPage({ head: "<head>", rest: () => held, failedRest: "<failed>", headers: HEADERS() });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    release("<rest>");
    await held;
  });

  test("a rest that rejects still ends the page, with the fallback, and is logged (AC-1)", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = streamedPage({
        head: "<head>",
        rest: async () => { throw new Error("git fell over"); },
        failedRest: "<failed>",
        headers: HEADERS(),
      });
      expect(await res.text()).toBe("<head><failed>");
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]!.join(" "))).toContain("git fell over");
    } finally {
      log.mockRestore();
    }
  });

  test("the headers are the ones given, and the status is 200", () => {
    const res = streamedPage({ head: "h", rest: async () => "r", failedRest: "f", headers: HEADERS() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
