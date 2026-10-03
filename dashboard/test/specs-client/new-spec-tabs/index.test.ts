// The New spec page's tabs, switched in place by the page script: a click
// on a tab shows its panel without a page load, and a required field the
// browser finds empty in the hidden panel brings that panel forward.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage } from "../../../src/render";
import { bindNewSpecTabs } from "../../../src/specs-client/new-spec-tabs";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

/** The New spec page opened on `tab`, with the tabs bound. */
function page(tab: "spec" | "options"): { doc: Document; win: Window } {
  const win = new Window();
  windows.push(win);
  win.document.write(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"], tab }));
  const doc = win.document as unknown as Document;
  bindNewSpecTabs(doc);
  return { doc, win };
}

const panel = (doc: Document, key: string) => doc.querySelector(`[data-tab-panel="${key}"]`) as HTMLElement;
const tabLink = (doc: Document, index: number) =>
  doc.querySelectorAll("nav[data-new-spec-tabs] a.tab")[index] as HTMLAnchorElement;
const current = (doc: Document) =>
  [...doc.querySelectorAll("nav[data-new-spec-tabs] a.tab")].findIndex((a) => a.getAttribute("aria-current") === "page");

/** An `invalid` event at `el`, as the browser fires it: no bubbling. */
function invalid(win: Window, el: Element): void {
  el.dispatchEvent(new win.Event("invalid", { bubbles: false, cancelable: true }) as unknown as Event);
}

describe("switching the New spec page's tabs in place", () => {
  test("a click on Options shows its panel, marks it current and loads no page (AC-1)", () => {
    const { doc, win } = page("spec");
    const click = new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    tabLink(doc, 1).dispatchEvent(click as unknown as Event);
    expect(click.defaultPrevented).toBe(true);
    expect(panel(doc, "options").hidden).toBe(false);
    expect(panel(doc, "spec").hidden).toBe(true);
    expect(current(doc)).toBe(1);
  });

  test("an empty Title found while Options is shown brings the Spec tab forward (AC-5)", () => {
    const { doc, win } = page("options");
    invalid(win, doc.querySelector('input[name="title"]')!);
    expect(panel(doc, "spec").hidden).toBe(false);
    expect(panel(doc, "options").hidden).toBe(true);
    expect(current(doc)).toBe(0);
  });

  test("an empty field in the panel already shown changes nothing (AC-5)", () => {
    const { doc, win } = page("options");
    invalid(win, doc.querySelector("#new-spec-criteria-checks")!);
    expect(panel(doc, "options").hidden).toBe(false);
    expect(panel(doc, "spec").hidden).toBe(true);
    expect(current(doc)).toBe(1);
  });
});
