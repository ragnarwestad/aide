import { describe, expect, test } from "bun:test";
import { harness, flush } from "./fixtures.ts";

// --- spec 368: a restarted server behind a proxy heals itself too -----------
//
// A dropped network retries on its own — `readyState` goes back to
// CONNECTING and the browser's own reconnect fires `open`, which
// `live-redraw.test.ts` already covers. A proxy's non-200 answer while the
// server process is not there to answer at all is different: the browser
// treats it as a "fail the connection" case, `readyState` goes to CLOSED,
// and `error` fires once with no retry of its own. These tests are the
// client noticing that and reopening the connection.

const fresh = () => harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));

describe("a closed source is replaced (spec 368)", () => {
  test("REQ-1: error with readyState CLOSED opens a new source, no reload", () => {
    const h = fresh();
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);

    h.live()!.fail();

    expect(h.timeouts).toHaveLength(1);
    h.timeouts[0]!.fn();

    expect(h.sources).toHaveLength(2);
    // No navigation happened — `location.href` is the fixture's own
    // marker for "the page reloaded", and this path never touches it.
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("REQ-5: the replacement's own open event redraws the rows", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.fail();
    h.timeouts[0]!.fn();
    expect(h.sources).toHaveLength(2);

    h.live()!.emit("open");
    await flush();

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
  });

  test("REQ-2: the wait doubles on each further failure, up to a ceiling", () => {
    const h = fresh();
    h.visibility("visible");

    h.live()!.fail();
    expect(h.timeouts[0]!.delayMs).toBe(1000);
    h.timeouts[0]!.fn();

    h.live()!.fail();
    expect(h.timeouts[1]!.delayMs).toBe(2000);
    h.timeouts[1]!.fn();

    h.live()!.fail();
    expect(h.timeouts[2]!.delayMs).toBe(4000);
    h.timeouts[2]!.fn();
  });

  test("REQ-2: the wait ceiling stops growing past its cap", () => {
    const h = fresh();
    h.visibility("visible");

    // Five failures in a row: 1000, 2000, 4000, 8000, 16000 would be the
    // uncapped sequence — the fifth wait must not exceed the ceiling.
    for (let i = 0; i < 5; i++) {
      h.live()!.fail();
      h.timeouts[i]!.fn();
    }
    expect(h.timeouts[4]!.delayMs).toBeLessThanOrEqual(30_000);

    h.live()!.fail();
    expect(h.timeouts[5]!.delayMs).toBe(30_000);
  });

  test("REQ-2: a successful reconnect resets the wait back to the base", () => {
    const h = fresh();
    h.visibility("visible");

    h.live()!.fail();
    expect(h.timeouts[0]!.delayMs).toBe(1000);
    h.timeouts[0]!.fn();

    h.live()!.fail();
    expect(h.timeouts[1]!.delayMs).toBe(2000);
    h.timeouts[1]!.fn();

    // This reconnect succeeds — `open` fires — so the NEXT failure's wait
    // starts back at the base value instead of continuing to grow.
    h.live()!.emit("open");

    h.live()!.fail();
    expect(h.timeouts[2]!.delayMs).toBe(1000);
  });

  test("REQ-3: a reconnect that opens redraws the rows, catching up with no reload", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.fail();
    h.timeouts[0]!.fn();

    h.live()!.emit("open");
    await flush();

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("REQ-4: a hidden tab drops a pending reconnect and does not retry", () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.fail();
    expect(h.timeouts).toHaveLength(1);
    expect(h.timeouts[0]!.cancelled).toBe(false);

    h.visibility("hidden");
    expect(h.timeouts[0]!.cancelled).toBe(true);

    // Firing the (cancelled) callback by hand still must not open a
    // connection on a hidden tab — `connect()`'s own visibility guard
    // is the second line of defence behind the cancelled timer.
    h.timeouts[0]!.fn();
    expect(h.sources).toHaveLength(1);
  });

  test("REQ-4: becoming visible again after a hidden pending reconnect opens fresh", () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.fail();
    h.visibility("hidden");
    h.visibility("visible");

    expect(h.sources).toHaveLength(2);
    expect(h.live()).not.toBeNull();
  });
});
