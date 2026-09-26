// The project page's Wiki tab: what a build does, the button that queues
// one, and the latest build — a build is a job of the project's, never a row
// on the Specs list, so this tab is where it is followed. A press, a Cancel
// and a refusal all come back here.

import { badge, btn, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import type { ProjectPageOptions } from "./types.ts";

type WikiBuild = NonNullable<ProjectPageOptions["wikiBuild"]>;

const UNFINISHED = new Set(["queued", "running"]);

/** The latest build: running with Cancel, last built, or how it ended, each
 *  with a link to the job's own page, where its log is. */
function latestBuild(b: WikiBuild, lang: Language): string {
  const log = `<a href="/specs/${esc(b.id)}?tab=steps">${esc(t(lang, "project.wikiLog"))}</a>`;
  if (UNFINISHED.has(b.state)) {
    const cancel =
      `<form method="post" action="/api/queue/${esc(b.id)}/cancel">` +
      btn({ label: t(lang, "list.cancel") }) +
      `</form>`;
    // The running badge's own spinner, the one every running row on the
    // board carries, so the tab reads as work under way at a glance.
    const text = t(lang, "project.wikiRunning");
    const spinner = badge("running", t(lang, "state.running"));
    return rowMessage("waiting", text, { html: `${spinner} ${esc(text)} ${log}`, actions: cancel });
  }
  if (b.state === "done") {
    const date = (b.finishedAt ?? "").slice(0, 10);
    const text = t(lang, "project.wikiLastBuilt", { date });
    return rowMessage("info", text, { html: `${esc(text)} ${log}` });
  }
  const why = b.error ?? t(lang, "project.wikiLastEnded", { state: b.state });
  return rowMessage("failed", why, { html: `${esc(why)} ${log}` });
}

export function wikiSection(name: string, opts: ProjectPageOptions): string {
  const lang = opts.lang ?? "en";
  const refusal = opts.wikiError ? rowMessage("failed", opts.wikiError, { hook: "refusal wiki-error", tag: "p" }) : "";
  const building = opts.wikiBuild && UNFINISHED.has(opts.wikiBuild.state);
  const form = building
    ? ""
    : `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/wiki" data-wikiform>` +
      btn({ label: t(lang, "project.wikiButton"), variant: "primary" }) +
      `</form>`;
  const latest = opts.wikiBuild ? latestBuild(opts.wikiBuild, lang) : "";
  return (
    `<h3>${esc(t(lang, "project.wikiHeading"))}</h3>` +
    `<div class="deploypanel">${refusal}${rowMessage("info", t(lang, "project.wikiNote"))}${latest}${form}</div>`
  );
}
