// The project page's Wiki tab: what a build does, and the button that queues
// one. The form is a plain post — a build is a row on the Specs list, so the
// answer is a navigation there, and a refusal comes back to this tab.

import { btn, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t } from "../../../i18n";
import type { ProjectPageOptions } from "./types.ts";

export function wikiSection(name: string, opts: ProjectPageOptions): string {
  const lang = opts.lang ?? "en";
  const refusal = opts.wikiError ? rowMessage("failed", opts.wikiError, { hook: "refusal wiki-error", tag: "p" }) : "";
  const form =
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/wiki" data-wikiform>` +
    btn({ label: t(lang, "project.wikiButton"), variant: "primary" }) +
    `</form>`;
  return (
    `<h3>${esc(t(lang, "project.wikiHeading"))}</h3>` +
    `<div class="deploypanel">${refusal}${rowMessage("info", t(lang, "project.wikiNote"))}${form}</div>`
  );
}
