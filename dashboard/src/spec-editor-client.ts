// The Description tab's WYSIWYG editor (spec 290): mounts Crepe over
// the mount-point `descriptionPanel()` renders, keeps the real
// `<textarea name="text">` in sync so the existing save route needs no
// change, and gets out of the way — with JS off, or if this bundle
// fails to build, the raw textarea is what the reader sees and saves.
//
// The two theme CSS files are pulled in as raw TEXT (`with { type:
// "text" }`), not as a CSS import: `Bun.build({ format: "iife" })`
// splits a plain CSS import into a SEPARATE output asset, which
// `specEditorClientScript()` (`serve-helpers/static.ts`) has no second
// place to serve — this dashboard inlines exactly one script per page
// and nothing else. Importing the two files as text instead folds
// their content into this same bundle, so one script, appended once at
// mount time, is still the whole story.
import commonThemeCss from "@milkdown/crepe/theme/common/style.css" with { type: "text" };
import frameThemeCss from "@milkdown/crepe/theme/frame.css" with { type: "text" };
import { Crepe } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";

const host = document.getElementById("spec-editor-host");
const raw = document.querySelector<HTMLTextAreaElement>("textarea.milkdown-raw");

if (host && raw) {
  const style = document.createElement("style");
  style.textContent = commonThemeCss + frameThemeCss;
  document.head.appendChild(style);

  const crepe = new Crepe({
    root: host,
    defaultValue: raw.value,
    // No REQ asks for LaTeX math or image upload, and "Ikke i scope"
    // rules out any Tiptap-Pro-equivalent feature — disable both.
    //
    // LinkTooltip is disabled too: found live (2026-08-31, right after
    // this shipped) rendering its "Paste link..." input already OPEN
    // on a completely fresh page load, with no click or selection at
    // all — a genuine mounting bug in this Crepe version, not
    // something a link-specific config option here can steer around.
    // A hand-typed `[text](url)` still round-trips fine (the roundtrip
    // test covers plain links); only the click-a-toolbar-icon-to-add-
    // one convenience is gone, and REQ-1's formatting-affordance
    // criterion is still met by Bold/Italic/Code.
    features: {
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.LinkTooltip]: false,
    },
  });
  // This repo's own spec files use `-` for both bullets and `---`
  // section rules; the serializer's own default (`*`/`***`) would
  // silently break withDependsOnLine()'s anchor regex on the very next
  // save through this editor (2-analysis.md, Codebase analysis —
  // empirically verified against this spec's own 1-description.md,
  // test/spec-editor-roundtrip.test.ts).
  crepe.editor.config((ctx) => {
    ctx.set(remarkStringifyOptionsCtx, { bullet: "-", rule: "-" });
  });
  crepe.create().then(() => {
    host.dataset.mounted = "true";
    // No preventDefault(): form-busy.ts's shared submit listener must
    // still see this submit as untouched, or the Save button loses its
    // busy state.
    document.addEventListener("submit", (event) => {
      if (event.target === raw.form) raw.value = crepe.getMarkdown();
    });
  });
}
