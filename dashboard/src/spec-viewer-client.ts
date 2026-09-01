// The read-only counterpart of spec-editor-client.ts (spec 333,
// finishing the split spec 315 started): a locked document tab's own
// bundle, built from @toast-ui/editor's dedicated Viewer export rather
// than the full Editor class, so REQ-4/REQ-5 hold because there is no
// editor code in this file to ship, not because nothing calls it.
//
// The import specifier below is `@toast-ui/editor/dist/toastui-editor-viewer`,
// NOT the package's own `@toast-ui/editor/viewer` export — verified
// directly (2-analysis.md): the latter bundles fine with `Bun.build`
// but fails `tsc --noEmit` (`TS7016`, the package's `"./viewer"` export
// carries no `"types"` condition, the same class of gap this project's
// own `tsconfig.json:12-19` already documents for the bare
// `@toast-ui/editor` specifier), while the `dist/` path used here
// matches an ambient declaration the package ships
// (`types/toastui-editor-viewer.d.ts`) and passes both tools cleanly.
import viewerCss from "@toast-ui/editor/dist/toastui-editor-viewer.css" with { type: "text" };
// REQ-5: the light stylesheet carries no `.toastui-editor-dark` rule at
// all — the dark theme is a SEPARATE file, same as spec-editor-client.ts's
// own two-stylesheet import.
import editorDarkCss from "@toast-ui/editor/dist/theme/toastui-editor-dark.css" with { type: "text" };
import Viewer from "@toast-ui/editor/dist/toastui-editor-viewer";

const host = document.getElementById("spec-editor-host");
const raw = document.querySelector<HTMLElement>(".spec-editor-raw");

if (host && raw) {
  const style = document.createElement("style");
  style.textContent = viewerCss + editorDarkCss;
  document.head.appendChild(style);

  new Viewer({ el: host, initialValue: raw.textContent ?? "", usageStatistics: false });
  host.dataset.mounted = "true";

  // REQ-5: the same live light/dark/auto wiring spec-editor-client.ts
  // carries for the editable path — but the class lands on `host`
  // itself here, since the Viewer renders no `.toastui-editor-defaultUI`
  // wrapper to put it on instead.
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  const currentTheme = (): string =>
    document.documentElement.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
  const applyTheme = (): void => {
    host.classList.toggle("toastui-editor-dark", currentTheme() === "dark");
  };
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributeFilter: ["data-theme"] });
  prefersDark.addEventListener("change", applyTheme);
}
