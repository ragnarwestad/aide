// The Description tab's WYSIWYG editor (spec 292): mounts Toast UI
// Editor over the mount-point `descriptionPanel()` renders, keeps the
// real `<textarea name="text">` in sync so the existing save route
// needs no change, and gets out of the way — with JS off, or if this
// bundle fails to build, the raw textarea is what the reader sees and
// saves.
//
// The editor's own stylesheet is pulled in as raw TEXT (`with { type:
// "text" }`), not as a CSS import: `Bun.build({ format: "iife" })`
// splits a plain CSS import into a SEPARATE output asset, which
// `specEditorClientScript()` (`serve-helpers/static.ts`) has no second
// place to serve — this dashboard inlines exactly one script per page
// and nothing else. Importing the file as text instead folds its
// content into this same bundle, so one script, appended once at mount
// time, is still the whole story.
import editorCss from "@toast-ui/editor/dist/toastui-editor.css" with { type: "text" };
import Editor from "@toast-ui/editor";
import type { ToMdConvertorMap } from "@toast-ui/editor";

const host = document.getElementById("spec-editor-host");
const raw = document.querySelector<HTMLTextAreaElement>("textarea.spec-editor-raw");

if (host && raw) {
  const style = document.createElement("style");
  style.textContent = editorCss;
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

  const editor = new Editor({
    el: host,
    height: "auto",
    initialEditType: "wysiwyg",
    previewStyle: "tab",
    // `usageStatistics` defaults to true and would send this
    // dashboard's own hostname to Google Analytics on every mount
    // (2-analysis.md, Risk analysis) — not a feature this integration
    // wants, and not something a self-hosted tool should phone home
    // about.
    usageStatistics: false,
    initialValue: raw.value,
    customMarkdownRenderer,
  });

  host.dataset.mounted = "true";
  // No preventDefault(): form-busy.ts's shared submit listener must
  // still see this submit as untouched, or the Save button loses its
  // busy state.
  document.addEventListener("submit", (event) => {
    if (event.target === raw.form) raw.value = editor.getMarkdown();
  });
}
