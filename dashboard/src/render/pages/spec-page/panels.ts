// The document tabs: Description, plus (spec 310) Analysis, Solution and
// Status — all four with the same editor, Save and JS-off fallback.

import { field, tokenField, saveCancelActions } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { fileStamp, specFilePanel, type SpecFileView } from "../job-page.ts";
import { activeJob, EDITABLE_SPEC_FILE } from "./tabs.ts";
import type { SpecPageView } from "./types.ts";

/** The read-only shape every document tab falls back to: archived, a
 *  job in flight, or (spec 303) the same WYSIWYG mount/raw pair a
 *  writable tab carries, so the client script renders it read-only
 *  rather than raw markup. */
function readOnlyDocument(file: SpecFileView, now: number, mark = ""): string {
  return (
    `<h2>${esc(file.label)}${fileStamp(file, now)}${mark}</h2>` +
    // Read-only counterpart of editableDocumentForm's mount/textarea
    // pair — same fallback CSS (field.css), same JS-off/build-failure
    // fallback (REQ-6), just no `<form>` around it.
    `<div class="spec-editor-mount" id="spec-editor-host"></div>` +
    `<pre class="specfile spec-editor-raw">${esc(file.text ?? "")}</pre>`
  );
}

/** The form every document tab's Save shares (spec 310): the token, the
 *  hidden `file`/`baseSha` fields the route reads (REQ-2/REQ-3), the
 *  heading and Save/Cancel on one line (spec 391), the mount/textarea
 *  pair below it. `extra` is markup inserted between the hidden fields
 *  and the panel head — nothing uses it today (the Description tab's
 *  own depends-on picker moved to the banner, spec 394), kept for a
 *  future tab that needs one.
 *
 *  Modelled on `new-spec-page.ts`, which is the other page here that is
 *  nothing but a form: same `field()`/`tokenField()` helpers. The
 *  Save-busy behaviour and the Save/Cancel enable-disable both come from
 *  the shell's own head scripts (`form-busy.ts`, `spec-form-actions.ts`),
 *  which listen on `document`, so nothing here has to wire either up. */
function editableDocumentForm(
  view: SpecPageView,
  label: string,
  headingHtml: string,
  text: string,
  extra = "",
): string {
  return (
    `<form method="post" action="${esc(view.saveAction)}" class="newspecform specform">` +
    tokenField(view.token) +
    // Which file this Save is about (REQ-2) — the allowlist the route
    // checks it against.
    `<input type="hidden" name="file" value="${esc(label)}">` +
    // Empty rather than absent when git has never committed the file:
    // an absent field and an empty one say the same thing to the route,
    // and one of them is a field that cannot be there.
    `<input type="hidden" name="baseSha" value="${esc(view.formBaseSha ?? "")}">` +
    `<div class="panelhead">${headingHtml}${saveCancelActions()}</div>` +
    extra +
    `<span class="frow">` +
    field(
      label,
      // The mount point spec-editor-client.ts fills in. Hidden until the
      // client script sets data-mounted on it — a reader with JS off, or a
      // failed bundle, gets the raw textarea beside it, unchanged.
      `<div class="spec-editor-mount" id="spec-editor-host"></div>` +
        // No newline between the tag and the text: an HTML parser eats a
        // single leading one, which would silently drop the first line of
        // a file that begins with a blank one.
        `<textarea name="text" rows="30" spellcheck="false" wrap="off" class="spec-editor-raw">${esc(text)}</textarea>`,
      { wide: true },
    ) +
    `</span>` +
    `</form>`
  );
}

/** One document tab: Analysis, Solution or Status (spec 310 — the same
 *  editor, Save and JS-off fallback the Description tab has always had).
 *  A tab whose file the view does not carry at all, or that has never
 *  been written, keeps `specFilePanel`'s plain "not written yet" note —
 *  nothing to mount an editor over. Archived or a job in flight draws
 *  the read-only shape instead — the route refuses either anyway
 *  (spec-edit.ts), but a control that only ever gets refused is not a
 *  control to draw. */
export function documentPanel(view: SpecPageView, label: string, now: number, mark = ""): string {
  const found = view.files.find((f) => f.label === label);
  const file = found ?? { label, text: null };
  if (file.text === null) return specFilePanel(file, now, mark);
  if (view.archived || activeJob(view)) return readOnlyDocument(file, now, mark);
  const heading = `<h2>${esc(file.label)}${fileStamp(file, now)}${mark}</h2>`;
  return editableDocumentForm(view, label, heading, file.text);
}

/** The Description tab (spec 162, moved onto this page by spec 212).
 *
 *  The depends-on picker that used to sit above this tab's own Save
 *  moved into the banner above the tab row (spec 394, REQ-1): a
 *  dependency is a fact about the SPEC, not about this one document,
 *  and now lives beside the acceptance switch, the other whole-spec
 *  fact. This panel is left with exactly the shape every other document
 *  tab already has.
 *
 *  An archived spec, or one with a job in flight, gets the read-only
 *  panel instead: an archived spec is a RECORD, and a Save on either
 *  would have written, committed and pushed underneath a run. The
 *  refusal itself is on the route — hiding a control is never the guard
 *  — but a box that only ever gets refused is not a box to draw. */
export function descriptionPanel(view: SpecPageView, now: number, mark = ""): string {
  const file = view.files.find((f) => f.label === EDITABLE_SPEC_FILE);
  if (view.archived || activeJob(view)) return documentPanel(view, EDITABLE_SPEC_FILE, now, mark);
  const heading =
    `<h2>${esc(EDITABLE_SPEC_FILE)}${fileStamp(file ?? { label: EDITABLE_SPEC_FILE, text: null }, now)}${mark}</h2>`;
  return editableDocumentForm(view, EDITABLE_SPEC_FILE, heading, file?.text ?? "");
}
