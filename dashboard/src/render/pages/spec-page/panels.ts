// The document tabs: one file read-only, and the Description tab's own
// form.

import { field, tokenField, btn } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { dependsOnField } from "../new-spec-page.ts";
import { fileStamp, specFilePanel } from "../job-page.ts";
import { EDITABLE_SPEC_FILE } from "./tabs.ts";
import type { SpecPageView } from "./types.ts";

/** One document, read-only — under its own name and commit stamp, and
 *  (spec 303) the same WYSIWYG mount/raw pair `descriptionPanel` below
 *  carries, so the client script renders it read-only rather than raw
 *  markup. A tab whose file the view does not carry at all, or that has
 *  never been written, keeps `specFilePanel`'s plain "not written yet"
 *  note — nothing to mount an editor over. */
export function documentPanel(view: SpecPageView, label: string, now: number): string {
  const found = view.files.find((f) => f.label === label);
  const file = found ?? { label, text: null };
  if (file.text === null) return specFilePanel(file, now);
  return (
    `<h2>${esc(file.label)}${fileStamp(file, now)}</h2>` +
    // Read-only counterpart of descriptionPanel's mount/textarea pair —
    // same fallback CSS (field.css), same JS-off/build-failure fallback
    // (REQ-6), just no `<form>` around it.
    `<div class="spec-editor-mount" id="spec-editor-host"></div>` +
    `<pre class="specfile spec-editor-raw">${esc(file.text)}</pre>`
  );
}

/** The Description tab: the one file of the four a person owns, in a
 *  textarea, with the Save that commits and pushes it (spec 162, moved
 *  onto this page by spec 212).
 *
 *  Modelled on `new-spec-page.ts`, which is the other page here that is
 *  nothing but a form: same `field()`/`tokenField()` helpers, and no
 *  script at all — a real form posting to a real route, following a 303
 *  back. The Save-busy behaviour comes from the shell's own head script,
 *  which listens on `document`, so nothing here has to wire it.
 *
 *  An archived spec gets the read-only panel instead: it is a RECORD,
 *  and a Save would have written, committed and pushed into `archive/`.
 *  The refusal itself is on the route — hiding a control is never the
 *  guard — but a box that only ever gets refused is not a box to draw. */
export function descriptionPanel(view: SpecPageView, now: number): string {
  const file = view.files.find((f) => f.label === EDITABLE_SPEC_FILE);
  if (view.archived) return documentPanel(view, EDITABLE_SPEC_FILE, now);
  const picker = dependsOnField(view.dependsOnOptions ?? [], new Set(view.dependsOn ?? []));
  return (
    `<h2>${esc(EDITABLE_SPEC_FILE)}${fileStamp(file ?? { label: EDITABLE_SPEC_FILE, text: null }, now)}</h2>` +
    `<form method="post" action="${esc(view.saveAction)}" class="newspecform specform">` +
    tokenField(view.token) +
    // Empty rather than absent when git has never committed the file:
    // an absent field and an empty one say the same thing to the route,
    // and one of them is a field that cannot be there.
    `<input type="hidden" name="baseSha" value="${esc(view.descriptionBaseSha ?? "")}">` +
    // Spec 166: above the file, because a dependency is about the spec
    // rather than about the prose — and because the line it writes is
    // the one line the textarea below no longer shows. The control is
    // the New-spec page's own since spec 174.
    //
    // The note goes with the picker rather than standing on its own: a
    // project with nothing to depend on draws neither, and a sentence
    // about a control that is not there is one more thing to read past.
    (picker
      ? `<span class="frow">${picker}</span>` +
        `<p class="muted">A dependency applies from this spec's next gated step ` +
        `(implement, resolve, archive) — never to a step already running.</p>`
      : "") +
    `<span class="frow">` +
    field(
      EDITABLE_SPEC_FILE,
      // The mount point spec-editor-client.ts fills in. Hidden until the
      // client script sets data-mounted on it — a reader with JS off, or a
      // failed bundle, gets the raw textarea beside it, unchanged.
      `<div class="spec-editor-mount" id="spec-editor-host"></div>` +
        // No newline between the tag and the text: an HTML parser eats a
        // single leading one, which would silently drop the first line of
        // a file that begins with a blank one.
        `<textarea name="text" rows="30" spellcheck="false" wrap="off" class="spec-editor-raw">${esc(file?.text ?? "")}</textarea>`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}</span>` +
    `</form>`
  );
}
