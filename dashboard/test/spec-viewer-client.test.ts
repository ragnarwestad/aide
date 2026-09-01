// REQ-1/REQ-2/REQ-3/REQ-5: the read-only mount, spec-viewer-client.ts —
// the read-only counterpart spec-editor-client.ts's dead branch used to
// be, now built on the vendor's own dedicated Viewer entry point
// (`@toast-ui/editor/dist/toastui-editor-viewer`) instead of
// `Editor.factory({ viewer: true })`.
//
// The `<pre>`-sibling mount/dark-theme cases are moved here from
// spec-editor-viewer-and-theme.test.ts (which now only ever mounts an
// editable `<textarea>` sibling) — same technique, same reasoning for
// why the REAL, MINIFIED bundle is what gets exercised: `new
// Function(scriptText)()` runs the built IIFE exactly as a browser's
// inlined `<script>` would.
//
// REQ-3's own describe block below mounts the vendor's real classes
// directly (not through Bun.build), the same technique
// spec-editor-roundtrip.test.ts uses for the editable side: a dynamic
// import AFTER happy-dom registration, since both classes read DOM
// globals (e.g. `Element.prototype`) at module top level.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { specViewerClientScript } from "../src/serve/serve-helpers/static.ts";

let scriptText: string;

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
  const text = await specViewerClientScript();
  if (!text) throw new Error("the viewer bundle failed to build");
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

function mount(): void {
  new Function(scriptText)();
}

function setHost(rawMarkup: string): HTMLElement {
  document.body.innerHTML = `<div id="spec-editor-host"></div>${rawMarkup}`;
  return document.getElementById("spec-editor-host")!;
}

describe("REQ-1/REQ-2: mounts a Viewer over a <pre> sibling with no toolbar or mode switch", () => {
  test("mounts, marks itself mounted, and renders the document", () => {
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.dataset.mounted).toBe("true");
    expect(host.querySelector("h1")?.textContent).toBe("hi");
    expect(host.querySelector(".toastui-editor-toolbar")).toBeNull();
    expect(host.querySelector(".toastui-editor-mode-switch")).toBeNull();
  });
});

describe("REQ-5: dark mode", () => {
  test("an explicit dark choice classes the mount host itself (no .toastui-editor-defaultUI wrapper exists here)", () => {
    document.documentElement.dataset.theme = "dark";
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(true);
  });

  test("light (the default, no stored choice, no system preference) carries no dark class", () => {
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(false);
  });

  test("'auto' (no stored choice) follows prefers-color-scheme at mount time", () => {
    fakeMql.matches = true;
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(true);
  });

  test("a live theme change re-themes the mounted viewer with no reload", async () => {
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(false);
    document.documentElement.dataset.theme = "dark";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.classList.contains("toastui-editor-dark")).toBe(true);
  });

  test("a live 'auto' preference change re-themes the mounted viewer with no reload", () => {
    const host = setHost('<pre class="spec-editor-raw"># hi\n</pre>');
    mount();
    expect(host.classList.contains("toastui-editor-dark")).toBe(false);
    fakeMql.matches = true;
    fakeMql.dispatchEvent(new Event("change"));
    expect(host.classList.contains("toastui-editor-dark")).toBe(true);
  });
});

// --- REQ-3: a locked tab and an editable one render the same document
// the same way, through the same renderer -----------------------------

const FIXTURE = `# Title

## Heading two

A paragraph with **bold**, *em*, and a [link](https://example.com).

- Bullet one
- Bullet two

---

1. Ordered one
2. Ordered two

| A | B |
| --- | --- |
| 1 | 2 |
`;

function norm(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** A structural outline, not a literal HTML-string diff (3-solution.md's
 *  Plan review, feasibility's should-fix): the editable path is
 *  ProseMirror-backed and carries attributes (contenteditable,
 *  data-nodeid, node-view wrappers) the static Viewer never emits, so
 *  only the semantic content — heading/list/table/link node types and
 *  their text — is compared. */
function outline(root: Element) {
  return {
    headings: [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => `${h.tagName}:${norm(h.textContent)}`),
    listItems: [...root.querySelectorAll("li")].map((li) => norm(li.textContent)),
    tableCells: [...root.querySelectorAll("td,th")].map((c) => norm(c.textContent)),
    links: [...root.querySelectorAll("a")].map((a) => `${norm(a.textContent)}|${a.getAttribute("href")}`),
  };
}

describe("REQ-3: the editable preview and the viewer render the same fixture the same way", () => {
  test("their .toastui-editor-contents subtrees match structurally", async () => {
    const editorEntry = join(
      dirname(Bun.resolveSync("@toast-ui/editor/package.json", import.meta.dir)),
      "dist/esm/index.js",
    );
    const Editor = (await import(editorEntry)).default;
    const Viewer = (await import("@toast-ui/editor/dist/toastui-editor-viewer")).default;

    const editorHost = document.createElement("div");
    document.body.appendChild(editorHost);
    new Editor({
      el: editorHost,
      height: "auto",
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      usageStatistics: false,
      initialValue: FIXTURE,
    });

    const viewerHost = document.createElement("div");
    document.body.appendChild(viewerHost);
    new Viewer({ el: viewerHost, initialValue: FIXTURE, usageStatistics: false });

    const editorContents = editorHost.querySelector(".toastui-editor-contents");
    const viewerContents = viewerHost.querySelector(".toastui-editor-contents");
    expect(editorContents).not.toBeNull();
    expect(viewerContents).not.toBeNull();
    expect(outline(viewerContents!)).toEqual(outline(editorContents!));
  });
});
