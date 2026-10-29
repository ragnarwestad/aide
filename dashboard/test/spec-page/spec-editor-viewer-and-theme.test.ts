// The client script's editable construction path and its
// dark-mode/mode-switch wiring. This bundle only ever
// mounts over an editable `<textarea>` sibling — the read-only branch
// that used to live here (`Editor.factory({ viewer: true })`) moved to
// spec-viewer-client.ts/spec-viewer-client.test.ts, built on the
// vendor's own dedicated Viewer entry point instead.
//
// Exercised against the REAL, MINIFIED bundle `static.ts` builds for
// the browser — not the source file directly, which cannot resolve
// `@toast-ui/editor`'s bare specifier outside `Bun.build`'s own
// resolve-fix plugin (`static.ts`'s own comment on
// `toastUiEditorResolveFix`; a plain `bun test` import of the bare
// specifier hits the exact same package.json "types"-field bug, and a
// runtime `Bun.plugin({ onResolve })` does not intercept it either —
// verified empirically before writing this file). `new Function(scriptText)()`
// runs the built IIFE exactly as a browser's inlined `<script>` would,
// against a `happy-dom` document set up before each call.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { specEditorClientScript } from "../../src/serve/serve-helpers";

let scriptText: string;

/** A controllable stand-in for what `window.matchMedia` returns: a real
 *  `EventTarget`, so the client script's own
 *  `prefersDark.addEventListener("change", ...)` fires for real when a
 *  test flips `.matches` and dispatches the event — proving
 *  LIVE re-theming, not just the initial read.
 *
 *  Built INSIDE `beforeAll`, after `GlobalRegistrator.register()`,
 *  rather than declared at module scope: a class body evaluated before
 *  registration captures Bun's own `EventTarget`/`Event`, and dispatching
 *  a `new Event(...)` built AFTER registration (happy-dom's own) against
 *  it then throws — the two globals do not recognise each other's
 *  instances. */
type FakeMediaQueryList = EventTarget & { matches: boolean };
let FakeMediaQueryList: new (matches: boolean) => FakeMediaQueryList;
let fakeMql: FakeMediaQueryList;

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  FakeMediaQueryList = class extends EventTarget {
    matches: boolean;
    constructor(matches: boolean) {
      super();
      this.matches = matches;
    }
  };
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
  fakeMql = new FakeMediaQueryList(false);
  window.matchMedia = (() => fakeMql) as unknown as typeof window.matchMedia;
});

/** Runs the built bundle once against whatever DOM the test has set up
 *  — the mount happens synchronously, top-level, exactly as it does
 *  when a browser parses the inlined `<script>`. */
function mount(): void {
  new Function(scriptText)();
}

function setHost(rawMarkup: string): HTMLElement {
  document.body.innerHTML = `<div id="spec-editor-host"></div>${rawMarkup}`;
  return document.getElementById("spec-editor-host")!;
}

// Spec-form-actions.ts's Cancel handler resets the hidden raw
// textarea from outside and asks a mounted editor to redraw from it —
// the only way in, since the WYSIWYG view is a separate DOM tree this
// instance owns.
describe("a \"spec-cancel\" event on the raw textarea redraws the mounted editor", () => {
  test("the visible WYSIWYG content reflects raw.value after the event, not what was mounted with", () => {
    setHost('<textarea class="spec-editor-raw"># original\n</textarea>');
    mount();
    const raw = document.querySelector<HTMLTextAreaElement>(".spec-editor-raw")!;
    const contents = document.querySelector(".toastui-editor-contents")!;
    expect(contents.textContent).toContain("original");

    raw.value = "# replaced\n";
    raw.dispatchEvent(new Event("spec-cancel"));

    expect(contents.textContent).toContain("replaced");
    expect(contents.textContent).not.toContain("original");
  });
});

// Spec-form-actions.ts's one-way dirty latch needs to see an
// "input" on the raw textarea the instant the editor's own content
// changes — cheap and immediate, with no getMarkdown() call of its own.
describe("an editor content change re-dispatches as \"input\" on the raw textarea", () => {
  test("setMarkdown (the same call the Cancel-redraw above makes) fires an \"input\" on raw", () => {
    setHost('<textarea class="spec-editor-raw"># original\n</textarea>');
    mount();
    const raw = document.querySelector<HTMLTextAreaElement>(".spec-editor-raw")!;
    let fired = false;
    raw.addEventListener("input", () => {
      fired = true;
    });

    raw.value = "# changed\n";
    raw.dispatchEvent(new Event("spec-cancel"));

    expect(fired).toBe(true);
  });
});

// A save that is out disables the spec's fields; the editor's typing
// surface is not a field, so the script follows the textarea's `disabled`.
describe("the typing surface follows the raw textarea's disabled state", () => {
  test("not editable while the textarea is disabled, editable again after", async () => {
    setHost('<textarea class="spec-editor-raw"># original\n</textarea>');
    mount();
    const raw = document.querySelector<HTMLTextAreaElement>(".spec-editor-raw")!;
    const surface = document.querySelector<HTMLElement>("[contenteditable]")!;
    expect(surface.getAttribute("contenteditable")).toBe("true");

    raw.disabled = true;
    await new Promise((r) => setTimeout(r, 0));
    expect(surface.getAttribute("contenteditable")).toBe("false");

    raw.disabled = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(surface.getAttribute("contenteditable")).toBe("true");
  });
});

// The editor sits in the Specs list's open row, which shows the spec whole:
// it grows with its text at every width, never a fixed box its text spills
// out of. The library marks the growing mode with `auto-height` on the host.
describe("the editor grows with its text", () => {
  test("a wide screen mounts the editor growing with its text", () => {
    const host = setHost('<textarea class="spec-editor-raw"># original\n</textarea>');
    mount();
    expect(host.classList.contains("auto-height")).toBe(true);
  });
});

