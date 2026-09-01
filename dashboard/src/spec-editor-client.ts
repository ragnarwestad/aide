// Every document tab's WYSIWYG editor (spec 292, extended by spec 303
// to Analysis/Solution/Status): mounts Toast UI Editor over the mount
// point `descriptionPanel()`/`documentPanel()` render, keeps the real
// `<textarea name="text">` in sync so the Description tab's save route
// needs no change, and gets out of the way — with JS off, or if this
// bundle fails to build, the raw textarea/`<pre>` is what the reader
// sees (and, for Description, saves).
//
// One shared script for both cases (spec 303): the raw sibling's own
// tag name tells editable from read-only — a `<textarea>` on the
// Description tab, a `<pre>` on the other three — so there is no second
// bundle entry point to give this dashboard's "one script per page"
// design (`static.ts`) a second script to route.
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
// relies on — verified against the installed version (3.2.2). Applies
// only to the editable Description tab: the read-only Viewer renders no
// toolbar or mode switch to move.
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
const raw = document.querySelector<HTMLElement>(".spec-editor-raw");

if (host && raw) {
  // The Description tab's `<textarea>` is the one editable case; the
  // other three document tabs pair the mount with a read-only `<pre>`
  // (`documentPanel`, spec 303).
  const editable = raw instanceof HTMLTextAreaElement;
  const initialValue = editable ? raw.value : (raw.textContent ?? "");

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

  // REQ-2: `new Editor({ viewer: true })` silently ignores `viewer` —
  // only the class's static `factory()` branches on it (verified
  // against the compiled bundle, 2-analysis.md: the type declaration
  // makes `viewer` look like a plain constructor option that works on
  // either call form, but the constructor itself never reads it). The
  // read-only path therefore has to go through `Editor.factory(...)`,
  // not `new Editor(...)` — an implementation that got this backwards
  // would silently render a full editable toolbar on Analysis/Solution/
  // Status instead of a read-only view.
  const instance = editable
    ? new Editor({
        el: host,
        height: "auto",
        initialEditType: "wysiwyg",
        previewStyle: "tab",
        // `usageStatistics` defaults to true and would send this
        // dashboard's own hostname to Google Analytics on every mount
        // (2-analysis.md, Risk analysis) — not a feature this
        // integration wants, and not something a self-hosted tool
        // should phone home about.
        usageStatistics: false,
        initialValue,
        customMarkdownRenderer,
      })
    : Editor.factory({ el: host, viewer: true, initialValue, usageStatistics: false });

  host.dataset.mounted = "true";
  // No preventDefault(): form-busy.ts's shared submit listener must
  // still see this submit as untouched, or the Save button loses its
  // busy state.
  if (editable) {
    document.addEventListener("submit", (event) => {
      if (event.target === (raw as HTMLTextAreaElement).form) {
        (raw as HTMLTextAreaElement).value = (instance as InstanceType<typeof Editor>).getMarkdown();
      }
    });
  }

  // REQ-5: the library's own `theme` option is construction-time
  // only (2-analysis.md) — this dashboard's theme changes live, with no
  // reload (`theme-script.ts`), so the dark class is managed by hand
  // from mount time instead of passed to the constructor.
  //
  // The class belongs on different elements for the two construction
  // paths, because the two constructors build different DOM (verified
  // against the compiled bundles, 2-analysis.md): the editable `Editor`
  // wraps its UI in a `.toastui-editor-defaultUI` descendant of `host`,
  // while the read-only `Viewer` (reached through `Editor.factory`)
  // renders no such wrapper — the class lands on `host` itself there.
  const themedEl = editable ? host.querySelector(".toastui-editor-defaultUI") : host;
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
