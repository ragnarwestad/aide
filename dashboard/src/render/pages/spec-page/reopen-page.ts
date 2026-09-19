// The reopen confirmation page (spec 511): one question, one box, unticked.

import { backLink, btn, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { type Language } from "../../../i18n";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { specPagePath } from "./tabs.ts";

export function renderReopenSpecPage(
  project: string,
  specFolder: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: {
    error?: string;
    script?: string;
    lang?: Language;
    currentUrl?: string;
    /** The list row's own fields (`fromList` and the filter), posted on
     *  unchanged so the answer comes back to the list it was asked from. */
    handOn?: Record<string, string>;
  } = {},
): string {
  const back = specPagePath(project, specFolder);
  const title = `Reopen ${specFolder}`;
  const handOn = Object.entries(opts.handOn ?? {})
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      "Reopen takes this spec back into the active list for another round. It keeps the description, " +
        "the analysis, the plan and the status as they are, and removes its old branch. " +
        "Tick the box to start the round from a clean slate instead.",
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue" class="newspecform">` +
    handOn +
    `<input type="hidden" name="project" value="${esc(project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(specFolder)}">` +
    `<input type="hidden" name="steps" value="reopen">` +
    `<p><label class="checkbox"><input type="checkbox" name="resetFiles" value="1"> ` +
    `Also reset the analysis, the plan and the status</label></p>` +
    `<span class="factions">` +
    btn({ label: "Reopen", variant: "primary", pending: "reopening…" }) +
    `<a class="btn" href="${esc(back)}">Cancel</a>` +
    `</span></form>`;
  return pageShell(title, entries, "/", body, generatedAt, undefined, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
