// Every document tab's WYSIWYG editor (spec 292, extended by spec 303
// to Analysis/Solution/Status): mounts Toast UI Editor over the mount
// point `descriptionPanel()`/`documentPanel()` render, keeps the real
// `<textarea name="text">` in sync so the Description tab's save route
// needs no change, and gets out of the way — with JS off, or if this
// bundle fails to build, the raw textarea is what the reader sees (and
// saves).
//
// Only ever reaches an editable tab (spec 333: `documentTabScript`,
// `tabs.ts`) — a locked tab's `<pre>` sibling is spec-viewer-client.ts's
// own mount to make, built on the vendor's dedicated read-only Viewer
// class instead of this file's full `Editor`, so a page that cannot be
// edited never ships editor code at all.
//
// The editor's own stylesheets are pulled in as raw TEXT (`with { type:
// "text" }`), not as a CSS import: `Bun.build({ format: "iife" })`
// splits a plain CSS import into a SEPARATE output asset, and this
// bundle is served from its own route (`GET /spec-editor.js`, spec
// 315) but still as ONE file — a second output asset is still a second
// thing to serve, cache and keep in step with the first. Importing the
// file as text instead folds its content into this same bundle, so one
// script, appended once at mount time, is still the whole story.
import editorCss from "@toast-ui/editor/dist/toastui-editor.css" with { type: "text" };
// REQ-5: the light stylesheet carries no `.toastui-editor-dark` rule at
// all (checked directly) — the dark theme is a SEPARATE file, imported
// and injected alongside the light one, or toggling the class below
// would style nothing.
import editorDarkCss from "@toast-ui/editor/dist/theme/toastui-editor-dark.css" with { type: "text" };
import Editor from "@toast-ui/editor";
import { unescapeMarkdown } from "./spec-editor/unescape-markdown.ts";
import type { ToMdConvertorMap } from "@toast-ui/editor";

// REQ-4: the library exposes no constructor option for the mode
// switch's position, and its own CSS assumes it sits last (rounded at
// the bottom only). The switch's parent is a normal block-flow
// container in `height: "auto"` mode (this integration's own setting,
// below) — the library's flex-column layout for that element is scoped
// to `:not(.auto-height)`, so it never applies here — which makes a
// CSS-only reorder possible with no JS DOM surgery: `order: -1` on a
// flex-column parent. Undocumented library internals, not a public
// API — the same kind of reach `customMarkdownRenderer` below already
// relies on — verified against the installed version (3.2.2).
const MODE_SWITCH_TOP_OVERRIDE = `
.toastui-editor-defaultUI { display: flex; flex-direction: column; }
.toastui-editor-mode-switch {
  order: -1;
  border-top: none;
  border-bottom: 1px solid #dadde6;
  border-radius: 3px 3px 0 0;
}
`;

const host = document.getElementById("spec-editor-host");
const raw = document.querySelector<HTMLTextAreaElement>(".spec-editor-raw");

if (host && raw) {
  const initialValue = raw.value;

  const style = document.createElement("style");
  style.textContent = editorCss + editorDarkCss + MODE_SWITCH_TOP_OVERRIDE;
  document.head.appendChild(style);

  // This repo's own spec files use `-` for both bullets and `---`
  // section rules; `getMarkdown()` re-serializes the WHOLE document on
  // every call from its ProseMirror tree, and the library's own
  // convertor hardcodes `*`/`***` with no constructor option that
  // changes just the character — this override is the documented,
  // public fix (2-analysis.md, Codebase analysis; verified empirically
  // against this spec's own 1-description.md,
  // test/spec-editor-roundtrip.test.ts).
  const customMarkdownRenderer: ToMdConvertorMap = {
    bulletList(_nodeInfo, { origin }) {
      return { ...origin!(), delim: "-" };
    },
    thematicBreak(_nodeInfo, { origin }) {
      return { ...origin!(), delim: "---" };
    },
  };

  const instance = new Editor({
    el: host,
    height: "auto",
    initialEditType: "wysiwyg",
    previewStyle: "tab",
    // `usageStatistics` defaults to true and would send this dashboard's
    // own hostname to Google Analytics on every mount (2-analysis.md,
    // Risk analysis) — not a feature this integration wants, and not
    // something a self-hosted tool should phone home about.
    usageStatistics: false,
    initialValue,
    customMarkdownRenderer,
  });

  host.dataset.mounted = "true";
  // REQ-1/REQ-3: the library gives a toolbar button a "click" with no
  // "mousedown" of its own in front of it whenever the toolbar redraws
  // and steals focus mid-interaction (2-analysis.md, Codebase analysis)
  // — a click on a toolbar button counts only when the mouse went down
  // on that SAME button. `detail === 0` exempts a keyboard-activated
  // click (Tab, then Enter/Space), which has no mousedown of its own
  // either but is a real activation, not the library's phantom one
  // (REQ-6).
  const toolbar = host.querySelector(".toastui-editor-toolbar");
  const toolbarButton = (target: EventTarget | null): HTMLElement | null =>
    target instanceof HTMLElement ? target.closest("button") : null;
  let lastMouseDownTarget: EventTarget | null = null;

  document.addEventListener(
    "mousedown",
    (event) => {
      lastMouseDownTarget = event.target;
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (event.detail === 0 || !toolbar?.contains(event.target as Node)) return;
      const clickedButton = toolbarButton(event.target);
      if (clickedButton && toolbarButton(lastMouseDownTarget) !== clickedButton) {
        event.stopPropagation();
      }
    },
    true,
  );

  // No preventDefault(): form-busy.ts's shared submit listener must
  // still see this submit as untouched, or the Save button loses its
  // busy state.
  document.addEventListener("submit", (event) => {
    // `unescapeMarkdown` is what keeps a pasted `## Requirements` a
    // heading rather than `\#\# Requirements` — see that file for why
    // the editor writes it that way and why these files want it back.
    if (event.target === raw.form) raw.value = unescapeMarkdown(instance.getMarkdown());
  });

  // spec-form-actions.ts's dirty latch listens for "input"/"change" on
  // the FORM, which this editor's own contenteditable surface never
  // fires — cheap and immediate, deliberately not calling getMarkdown()
  // on every edit, which would re-serialize the whole ProseMirror tree
  // for no reader benefit; that value is read off raw.value at submit
  // time exactly as above.
  instance.on("change", () => raw.dispatchEvent(new Event("input", { bubbles: true })));
  // spec-form-actions.ts's Cancel handler resets raw.value from outside
  // and asks a mounted editor to redraw from it — the WYSIWYG view is a
  // separate DOM tree this instance owns, with no other way in.
  raw.addEventListener("spec-cancel", () => instance.setMarkdown(raw.value));

  // REQ-5: the library's own `theme` option is construction-time
  // only (2-analysis.md) — this dashboard's theme changes live, with no
  // reload (`theme-script.ts`), so the dark class is managed by hand
  // from mount time instead of passed to the constructor. The class
  // lands on the `.toastui-editor-defaultUI` descendant of `host` this
  // constructor builds, not on `host` itself (verified against the
  // compiled bundle, 2-analysis.md).
  const themedEl = host.querySelector(".toastui-editor-defaultUI");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  // The same "auto" rule `theme-script.ts` encodes: an explicit
  // `data-theme` on `<html>` wins, and its absence means "follow the
  // system", never a hardcoded default.
  const currentTheme = (): string =>
    document.documentElement.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
  const applyTheme = (): void => {
    themedEl?.classList.toggle("toastui-editor-dark", currentTheme() === "dark");
  };
  applyTheme();
  // Two ways the theme can change while this tab stays open, with no
  // reload: `theme-script.ts`'s own click handler sets `data-theme`
  // directly, and — for a reader on "auto" — the OS's own preference
  // can flip underneath the page.
  new MutationObserver(applyTheme).observe(document.documentElement, { attributeFilter: ["data-theme"] });
  prefersDark.addEventListener("change", applyTheme);
}
