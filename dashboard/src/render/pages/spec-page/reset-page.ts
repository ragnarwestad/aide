// The reset confirmation page.

import { backLink, btn, rowMessage, tokenField } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { specPagePath } from "./tabs.ts";

export function renderResetSpecPage(
  project: string,
  specFolder: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: { token?: string; error?: string; script?: string; lang?: Language; currentUrl?: string } = {},
): string {
  const back = specPagePath(project, specFolder);
  const title = `Reset ${specFolder}`;
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      "Reset keeps 0-README.md and 1-description.md byte for byte. It regenerates the analysis, plan and status, removes old local and remote spec branches, and keeps earlier jobs and commits as history. Project code and default-branch history are unchanged.",
      { tag: "p" },
    ) +
    // An ordinary confirmation: the question in a sentence, then the
    // two answers. It was a field the reader had to type the folder
    // name back into until 2026-09-08 — on a page whose own heading is
    // that name, which proved nothing except that the reader could
    // copy, and asked a reader who does not have the folder name in
    // front of them anywhere else to produce it.
    //
    // Not the `specform` Save/Cancel pair Close uses: that pair enables
    // Save only once a field has changed, and Close has a Reason field
    // to change. This form has none, so its button has to be live from
    // the moment the page is drawn.
    rowMessage("waiting", `Are you sure you want to reset ${specFolder}? This cannot be undone.`, {
      tag: "p",
    }) +
    `<form method="post" action="/api/queue${back}/reset" class="newspecform" ` +
      `data-overlay="${t(opts.lang ?? "en", "shell.overlayResetting")}">` +
    tokenField(opts.token) +
    // Cancel is a LINK wearing the button's look: it submits nothing,
    // and where it goes is the page the reader came from. Inside the
    // form so the two answers sit on one line, the way every other
    // pair on the site does.
    `<span class="factions">` +
    btn({ label: "Reset", variant: "danger", pending: "resetting…" }) +
    `<a class="btn" href="${esc(back)}">Cancel</a>` +
    `</span></form>`;
  return pageShell(title, entries, "/", body, generatedAt, undefined, {
    script: opts.script, hideHeading: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
