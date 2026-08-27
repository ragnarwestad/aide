import { describe, expect, test } from "bun:test";
import { harness } from "./fixtures.ts";

// Spec 208: every action says at once that it registered.
//
// Buttons have done this since spec 96/101 — the `busy` look, set
// synchronously on the press, before the answer exists. The three
// actions `1-description.md` names got none of it: opening a row,
// folding or sorting the list, and moving between the top-level tabs.
// Seven silent seconds read as a dead app.
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

  // Criterion 13. A spec's own name and the tab bar's links are REAL
  // navigations — a different document, which no script can swap in.
  // So the click is marked and the browser is left to get on with it.
  test("a spec's name marks itself and does not stop the browser navigating", () => {
    const h = harness(() => ({ ok: true }));
    const link = h.gotoLink("/specs/aide/208-the-app-answers-at-once");
    const prevented = h.clickGoto(link);
    expect(link.classList.contains("awaiting")).toBe(true);
    // The whole point: the navigation still happens. Intercepting it
    // would mean re-implementing a page load in script.
    expect(prevented).toBe(false);
  });

  test("a tab bar link does the same, though it sits outside #jobrows", () => {
    const h = harness(() => ({ ok: true }));
    const tab = h.gotoLink("/projects");
    const prevented = h.clickGoto(tab);
    expect(tab.classList.contains("awaiting")).toBe(true);
    expect(prevented).toBe(false);
  });

  // A click already spoken for — a modifier held, a middle button, or
  // something upstream having called `preventDefault` — opens a new tab
  // or does nothing at all. Marking the link in either case would leave
  // a permanent look on a page nobody navigated away from.
  test("a click that is not a plain navigation is left alone", () => {
    const h = harness(() => ({ ok: true }));
    const link = h.gotoLink("/projects");
    h.clickGoto(link, { defaultPrevented: true });
    expect(link.classList.contains("awaiting")).toBe(false);
  });
});
