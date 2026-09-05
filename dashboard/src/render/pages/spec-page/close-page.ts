// The close confirmation page (spec 406). Structural sibling of
// reset-page.ts, but with a reason `<textarea>` and the standard
// `specform` Save/Cancel pair (REQ-4) in place of `typedConfirm()` —
// see 3-solution.md's own "Confirmation shape, within Approach A" for
// why this page, not a modal, is the right shape for Close.

import { backLink, field, rowMessage, saveCancelActions, tokenField } from "../../ui/components.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { specPagePath } from "./tabs.ts";

/** The one sentence stated wherever a reader meets Close or Reset
 *  (REQ-2): on this confirmation page's own body text, and again — via
 *  `overview.ts`'s `resetCloseNote` — beside the two controls on the
 *  spec's own page. One string, so the two places can never say it
 *  differently. */
export const CLOSE_VS_RESET_SENTENCE =
  "Reset starts this spec over and keeps it active; Close says it will not work and archives it as a record.";

export function renderCloseSpecPage(
  project: string,
  specFolder: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: { token?: string; error?: string; script?: string } = {},
): string {
  const back = specPagePath(project, specFolder);
  const title = `Close ${specFolder}`;
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      `${CLOSE_VS_RESET_SENTENCE} Closing merges this spec's files into archive/ as the record, and deletes its code branch (never merges it) — none of that work will be used.`,
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue${back}/close" class="newspecform specform">` +
    tokenField(opts.token) +
    `<div class="panelhead"><h2>Close</h2>${saveCancelActions()}</div>` +
    `<span class="frow">` +
    field("Reason", `<textarea name="reason" rows="4" required></textarea>`) +
    `</span></form>`;
  return pageShell(title, entries, "/", body, generatedAt, undefined, { script: opts.script, hideHeading: true });
}
