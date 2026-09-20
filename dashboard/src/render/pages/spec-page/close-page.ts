// The close confirmation page (spec 406). Structural sibling of
// reopen-page.ts, but with a reason `<textarea>` and the standard
// `specform` Save/Cancel pair (REQ-4) in place of `typedConfirm()` —
// see 3-solution.md's own "Confirmation shape, within Approach A" for
// why this page, not a modal, is the right shape for Close.

import { backLink, field, rowMessage, saveCancelActions } from "../../ui/components";
import { DESCRIPTION_MAX } from "../../../queue/parse-request.ts";
import { t, type Language } from "../../../i18n";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { specPagePath } from "./tabs.ts";

/** The one sentence stated wherever a reader meets Close (REQ-2): on
 *  this confirmation page's own body text, and again — via
 *  `overview.ts`'s `actionsHelp` — beside the control on the spec's own
 *  page. One string, so the two places can never say it
 *  differently. */
export const CLOSE_SENTENCE =
  "Close says this spec will not work and archives it as a record; another round is how a spec that is still worth doing goes on.";

export function renderCloseSpecPage(
  project: string,
  specFolder: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: { error?: string; script?: string; lang?: Language; currentUrl?: string } = {},
): string {
  const back = specPagePath(project, specFolder);
  const title = `Close ${specFolder}`;
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      `${CLOSE_SENTENCE} Closing merges this spec's files into archive/ as the record, and deletes its code branch (never merges it) — none of that work will be used.`,
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue${back}/close" class="newspecform specform" ` +
      `data-overlay="${t(opts.lang ?? "en", "shell.overlayClosing")}">` +
    `<div class="panelhead"><h2>Close</h2>${saveCancelActions()}</div>` +
    `<span class="frow">` +
    // A data attribute, not maxlength: with script off the server's own
    // refusal stays what a too-long reason meets; the script reads it and
    // applies the bound.
    field("Reason", `<textarea name="reason" rows="4" required data-maxlength="${DESCRIPTION_MAX}"></textarea>`) +
    `</span></form>`;
  return pageShell(title, entries, "/", body, generatedAt, undefined, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
