import { describe, expect, test } from "bun:test";
import { harness, OK_ACTION } from "../fixtures.ts";

// The `changed` event a queue move sends carries how many specs wait for a
// person. The live client does not touch the app's icon itself: it hands the
// number to the head script as an `aide:waiting` event on the document.

const fresh = () => {
  const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
  h.visibility("visible");
  return h;
};
const heard = (h: ReturnType<typeof fresh>) => h.dispatchedEvents.filter((e) => e.type === "aide:waiting");

describe("a changed event with a count becomes aide:waiting (AC-4)", () => {
  test("a number is announced with the number as detail (AC-4)", () => {
    const h = fresh();
    h.tickWith('{"waiting":3}');
    expect(heard(h)).toEqual([{ type: "aide:waiting", detail: 3 }]);
  });

  test("0 is announced, not dropped as false (AC-6)", () => {
    const h = fresh();
    h.tickWith('{"waiting":0}');
    expect(heard(h)).toEqual([{ type: "aide:waiting", detail: 0 }]);
  });

  test("an event without a count announces nothing (AC-4)", () => {
    const h = fresh();
    h.tickWith("{}");
    h.tickWith("");
    h.tickWith("not json");
    h.tickWith('{"waiting":"3"}');
    expect(heard(h)).toEqual([]);
  });

  test("a press in flight holds the redraw but not the number (AC-4)", async () => {
    let releasePress: () => void = () => {};
    const pressHeld = new Promise<void>((r) => (releasePress = r));
    const h = harness((url) =>
      url.includes("/cancel") ? { ok: true, body: OK_ACTION, hold: pressHeld } : { ok: true, text: "<tr>fresh</tr>" },
    );
    h.visibility("visible");
    const pressed = h.submit();
    await Promise.resolve();
    const redraws = h.requests.filter((r) => r.url.includes("rows=1")).length;
    h.tickWith('{"waiting":2}');
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(redraws);
    expect(heard(h)).toEqual([{ type: "aide:waiting", detail: 2 }]);
    releasePress();
    await pressed;
  });
});
