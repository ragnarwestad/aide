import { describe, expect, test } from "bun:test";
import { harness } from "./fixtures.ts";

// Spec 208: every action says at once that it registered.
//
// Buttons have done this since spec 96/101 — the `busy` look, set
// synchronously on the press, before the answer exists. This file
// covers the in-place case: opening a row, folding or sorting the
// list. A real navigation — a spec's own name, a tab bar link — is
// `nav-busy.ts`'s own since spec 312, tested in
// `test/render/ui/nav-busy.test.ts`.
describe("a click that leaves the page waiting says so at once (spec 208)", () => {
  // Criterion 12. The fold and sort links go through `navigate()`, which
  // swaps the rows in place: the page stays, so the container is what
  // carries the look.
  test("navigate() marks the rows as waiting before its fetch resolves, and clears it after", async () => {
    let release = (): void => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, hold: held } : { ok: true }));
    const swapping = h.clickFold();
    // Synchronously — the click has not yielded to the network yet.
    expect(h.rows.classList.contains("awaiting")).toBe(true);
    release();
    await swapping;
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rows.classList.contains("awaiting")).toBe(false);
  });

  test("a fetch that fails still takes the waiting look off", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: true, throws: true } : { ok: true }));
    await h.clickFold();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rows.classList.contains("awaiting")).toBe(false);
  });
});
