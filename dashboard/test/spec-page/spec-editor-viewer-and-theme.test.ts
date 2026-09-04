// REQ-4/REQ-5: the client script's editable construction path and its
// dark-mode/mode-switch wiring. Since spec 333 this bundle only ever
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
import { specEditorClientScript } from "../../src/serve/serve-helpers/static.ts";

let scriptText: string;

/** A controllable stand-in for what `window.matchMedia` returns: a real
 *  `EventTarget`, so the client script's own
 *  `prefersDark.addEventListener("change", ...)` fires for real when a
 *  test flips `.matches` and dispatches the event — proving REQ-5's
 *  LIVE re-theming, not just its initial read.
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

function injectedCss(): string {
  return [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n");
}

describe("REQ-3: the editable path is unchanged — new Editor(...) on a <textarea> sibling", () => {
  test("still mounts the full toolbar", () => {
    const host = setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    expect(host.dataset.mounted).toBe("true");
    expect(host.querySelector(".toastui-editor-toolbar")).not.toBeNull();
  });
});

describe("REQ-4: the mode switch's CSS is reordered to the top", () => {
  test("the injected stylesheet orders .toastui-editor-mode-switch first via order: -1", () => {
    setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    const css = injectedCss();
    expect(css).toContain(".toastui-editor-mode-switch");
    expect(css).toContain("order: -1");
  });
});

describe("REQ-5: dark mode", () => {
  test("the injected stylesheet carries the dark theme's own CSS text, not just the light one", () => {
    setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    // A selector this dashboard's OWN css/field.css never writes, and
    // the light stylesheet carries no `.toastui-editor-dark` rule at
    // all (2-analysis.md, checked directly) — its presence proves the
    // SEPARATE dark stylesheet was actually imported and injected, not
    // just the class toggled with nothing on the page to style it.
    expect(injectedCss()).toContain(".toastui-editor-dark .toastui-editor-contents");
  });

  test("an explicit dark choice classes the editable editor's own root, not the mount host", () => {
    document.documentElement.dataset.theme = "dark";
    const host = setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(false);
    expect(host.querySelector(".toastui-editor-defaultUI")?.classList.contains("toastui-editor-dark")).toBe(true);
  });

  test("light (the default, no stored choice, no system preference) carries no dark class", () => {
    const host = setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    expect(host.querySelector(".toastui-editor-defaultUI")?.classList.contains("toastui-editor-dark")).toBe(false);
  });

  test("a live theme change re-themes the mounted editable editor with no reload", async () => {
    const host = setHost('<textarea class="spec-editor-raw"># hi\n</textarea>');
    mount();
    const themedEl = host.querySelector(".toastui-editor-defaultUI")!;
    expect(themedEl.classList.contains("toastui-editor-dark")).toBe(false);
    document.documentElement.dataset.theme = "dark";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(themedEl.classList.contains("toastui-editor-dark")).toBe(true);
  });
});
