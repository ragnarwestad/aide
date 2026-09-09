// Spec 424, REQ-4/REQ-5: the test board's own Stop control.
//
// `selfStopExit` is always INJECTED here, never the real
// `() => process.exit(0)`: a test that let the route actually exit
// would kill the `bun test` runner it is running inside.
//
// `testBoardSpec` goes through `extra`, into `createServer()` itself,
// never a bare `setBoardInfo()` call before `harness.start()`:
// `createServer()` always calls `setBoardInfo(opts.testBoardSpec)`
// unconditionally (spec 424's own anti-leakage rule), which would
// overwrite a value set beforehand right back to `undefined`.
import { afterEach, describe, expect, test } from "bun:test";
import { queueHarness } from "../helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const auth = { headers: { "x-aide-token": TOKEN } };
const TEST_BOARD = "424-headeren-sier-hvilket-board";

const harness = queueHarness("aide-self-stop-");

afterEach(() => harness.cleanup());

describe("POST /api/self-stop", () => {
  test("requires the token like every other queue route", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD } });
    const res = await fetch(`${base}/api/self-stop`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("a GET is refused, method not allowed", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD } });
    const res = await fetch(`${base}/api/self-stop`, auth);
    expect(res.status).toBe(405);
  });

  // REQ-5: an ordinary (prod) server never draws the Stop button, but a
  // request can be sent by hand regardless of what the page draws.
  test("with no board info, answers 404 and never calls the exit hook", async () => {
    let exitCalled = false;
    const { base } = harness.start({
      extra: { queueToken: TOKEN, selfStopExit: () => { exitCalled = true; } },
    });
    const res = await fetch(`${base}/api/self-stop`, { method: "POST", ...auth });
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 100));
    expect(exitCalled).toBe(false);
  });

  // REQ-4. The response is read to completion, and the exit hook is
  // checked as still unfired at that point, before the test waits for
  // it: the concrete proof that the body left the socket before the
  // process-ending call, not merely that both eventually happen.
  test("with board info set, responds 200 and calls the exit hook only after the body is received", async () => {
    let exitCalled = false;
    const { base } = harness.start({
      extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD, selfStopExit: () => { exitCalled = true; } },
    });
    const res = await fetch(`${base}/api/self-stop`, { method: "POST", ...auth });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Test server stopped");
    expect(exitCalled).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(exitCalled).toBe(true);
  });
});
