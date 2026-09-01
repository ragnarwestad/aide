// REQ-1/REQ-2/REQ-3/REQ-6: a click on a toolbar button counts only when the
// mouse went down on that SAME button — the library gives a toolbar button
// a "click" with no "mousedown" of its own in front of it whenever the
// toolbar redraws and steals focus mid-interaction (1-description.md,
// 2-analysis.md). REQ-5 (the read-only path mounts no toolbar at all,
// since spec 333 it never reaches this script) is already covered by
// spec-editor-viewer-and-theme.test.ts and is not re-asserted here.
//
// Exercised against the REAL, MINIFIED bundle, same pattern as
// spec-editor-viewer-and-theme.test.ts — see that file's own header
// comment for why `new Function(scriptText)()` against a bundle built by
// `specEditorClientScript()` is the only way to reach this code path.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { specEditorClientScript } from "../src/serve/serve-helpers/static.ts";

let scriptText: string;

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  const text = await specEditorClientScript();
  if (!text) throw new Error("the editor bundle failed to build");
  scriptText = text;
});

afterAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((s) => s.remove());
  delete document.documentElement.dataset.theme;
  window.matchMedia = (() => ({ matches: false, addEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

/** Runs the built bundle once against whatever DOM the test has set up
 *  — the mount happens synchronously, top-level, exactly as it does
 *  when a browser parses the inlined `<script>`. */
function mount(): HTMLElement {
  document.body.innerHTML = `<div id="spec-editor-host"></div><textarea class="spec-editor-raw"># hi\n</textarea>`;
  new Function(scriptText)();
  return document.getElementById("spec-editor-host")!;
}

function dispatchMousedown(target: Element): void {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
}

function dispatchClick(target: Element, detail = 1): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
}

function popupDisplay(host: HTMLElement): string | undefined {
  return (host.querySelector(".toastui-editor-popup") as HTMLElement | null)?.style.display;
}

describe("REQ-1: a click that lands on a toolbar button with no mousedown of its own does not act", () => {
  test("mousedown in the text, then a click on the Headings button, does not open the popup", () => {
    const host = mount();
    const contents = host.querySelector(".toastui-editor-contents")!;
    const heading = host.querySelector(".toastui-editor-toolbar-icons.heading")!;

    dispatchMousedown(contents);
    dispatchClick(heading);

    expect(popupDisplay(host)).toBe("none");
  });
});

describe("REQ-2/REQ-3: a mousedown and click on the SAME toolbar button still works", () => {
  test("mousedown then click on the Headings button opens the popup", () => {
    const host = mount();
    const heading = host.querySelector(".toastui-editor-toolbar-icons.heading")!;

    dispatchMousedown(heading);
    dispatchClick(heading);

    expect(popupDisplay(host)).toBe("block");
  });

  test("mousedown then click on a different button (Bold) closes an already-open popup", () => {
    const host = mount();
    const heading = host.querySelector(".toastui-editor-toolbar-icons.heading")!;
    const bold = host.querySelector(".toastui-editor-toolbar-icons.bold")!;

    dispatchMousedown(heading);
    dispatchClick(heading);
    expect(popupDisplay(host)).toBe("block");

    dispatchMousedown(bold);
    dispatchClick(bold);

    expect(popupDisplay(host)).toBe("none");
  });
});

describe("REQ-6: a keyboard-activated click (detail: 0) is not blocked", () => {
  test("a detail: 0 click on the Headings button, with no preceding mousedown, still opens the popup", () => {
    const host = mount();
    const heading = host.querySelector(".toastui-editor-toolbar-icons.heading")!;

    dispatchClick(heading, 0);

    expect(popupDisplay(host)).toBe("block");
  });
});
