import { describe, expect, test } from "bun:test";
import { harness } from "../fixtures.ts";

// Spec 208: every action says at once that it registered.
//
// Buttons have done this since spec 96/101 — the `busy` look, set
// synchronously on the press, before the answer exists. This file
// covers the in-place case: opening a row, folding or sorting the
// list. A real navigation — a spec's own name, a tab bar link — is
// `nav-busy.ts`'s own since spec 312, tested in
// `test/render/ui/nav-busy.test.ts`.

// A spec's own › redraws that spec alone, and its chevron is what says
// it is working: a busy mouse pointer is nothing on a phone.
describe("a spec's own › swaps that spec alone", () => {
  test("it asks the server for that spec only", async () => {
    const h = harness(() => ({ ok: true }));
    h.clickFold();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.requests[0]!.url).toContain("only=aide%2F127-one-ai");
  });

  // After a › swapped its own spec, every other link on the page still
  // names the folds as they were before it; pressing one must not shut
  // the row that was just opened.
  test("another link keeps the folds the address has, not the ones its href was drawn with", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?open=aide%2Fa&checks=aide%2Fb");
    void h.clickHref("/?sort=cost&open=aide%2Fold");
    const q = new URLSearchParams(h.location.search);
    expect(q.get("open")).toBe("aide/a");
    expect(q.get("checks")).toBe("aide/b");
    expect(q.get("sort")).toBe("cost");
  });

  test("a second › adds its spec to the ones the address already has open", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?open=aide%2Fa");
    h.clickFold();
    expect(new URLSearchParams(h.location.search).get("open")).toBe("aide/a,aide/127-one-ai");
  });
});
