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
describe("a click that leaves the page waiting says so at once (spec 208)", () => {
  // Criterion 12. The sort and filter links go through `navigate()`,
  // which swaps the rows in place: the page stays, so the container is
  // what carries the look.
  test("a sort link marks the rows as waiting before its fetch resolves, and clears it after", async () => {
    let release = (): void => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, hold: held } : { ok: true }));
    const swapping = h.clickHref("/?sort=cost");
    // Synchronously — the click has not yielded to the network yet.
    expect(h.rows.classList.contains("awaiting")).toBe(true);
    release();
    await swapping;
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rows.classList.contains("awaiting")).toBe(false);
  });

  test("a fetch that fails still takes the waiting look off", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, throws: true } : { ok: true }));
    await h.clickHref("/?sort=cost");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rows.classList.contains("awaiting")).toBe(false);
  });
});

// A spec's own › redraws that spec alone, and its chevron is what says
// it is working: a busy mouse pointer is nothing on a phone.
describe("a spec's own › swaps that spec alone", () => {
  test("it asks the server for that spec only", async () => {
    const h = harness(() => ({ ok: true }));
    h.clickFold();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.requests[0]!.url).toContain("only=aide%2F127-one-ai");
  });

  test("the chevron is a spinner until the answer, and the list is not dimmed", async () => {
    let release = (): void => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, hold: held } : { ok: true }));
    h.clickFold();
    expect(h.foldLink.innerHTML).toContain('class="spin"');
    expect(h.rows.classList.contains("awaiting")).toBe(false);
    release();
  });

  test("the chevron comes back when no answer drew the row again", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, throws: true } : { ok: true }));
    h.clickFold();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.foldLink.innerHTML).toBe("<svg></svg>");
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
