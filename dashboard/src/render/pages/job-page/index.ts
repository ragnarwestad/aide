// The views a step's result and a spec file are drawn from
// (types.ts), a step's log (step-tabs.ts) and a spec file's panel.
// Kept as a barrel at this path because most of the render layer
// imports from it.

import { esc, relTime } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import type { SpecFileView } from "./types.ts";

export type { JobStepResultView, SpecFileView, JobDetailView, PhaseAttemptIdentity } from "./types.ts";
export { pickTab, tabBar, tabbedBody } from "../../ui/tabs.ts";

/** One spec file, preformatted and escaped, under its own name and —
 *  when somebody asked git — the commit that last changed it.
 *  Markdown is deliberately not rendered: the description put
 *  that out of scope, and a reader checking WHICH VERSION is up wants
 *  the text as written. */
export function specFilePanel(file: SpecFileView, now: number, mark = "", lang: Language = "en"): string {
  return (
    `<h2>${esc(file.label)}${fileStamp(file, now, lang)}${mark}</h2>` +
    (file.text === null
      ? `<p class="muted">${esc(t(lang, "job.notWrittenYet", { file: file.label }))}</p>`
      : `<pre class="specfile">${esc(file.text)}</pre>`)
  );
}

/** WHICH VERSION a file's panel is showing, as the heading's own
 *  suffix. Its own function because the Description tab is a
 *  textarea rather than a `<pre>`, and it carries the same stamp for
 *  the same reason — a reader has to be able to tell what they are
 *  about to edit from what a step wrote. */
export function fileStamp(file: SpecFileView, now: number, lang: Language = "en"): string {
  if (file.sha && file.at) {
    return ` <span class="muted small">${esc(t(lang, "job.committed"))} ${relTime(file.at, now, lang)} · ${esc(file.sha.slice(0, 7))}</span>`;
  }
  return "";
}
