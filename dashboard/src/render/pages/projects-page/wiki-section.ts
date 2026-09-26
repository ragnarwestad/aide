// The project page's Wiki tab: what a build does, the button that queues
// one, and the latest build — a build is a job of the project's, never a row
// on the Specs list, so this tab is where it is followed. A press, a Cancel
// and a refusal all come back here.

import { badge, btn, rowMessage } from "../../ui/components";
import { stepResults } from "../job-page";
import { RELOAD_SECONDS } from "../spec-page/tabs.ts";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import type { ProjectPageOptions } from "./types.ts";

type WikiBuild = NonNullable<ProjectPageOptions["wikiBuild"]>;

const UNFINISHED = new Set(["queued", "running"]);

/** The latest build: running with Cancel, last built, or how it ended. Its
 *  log is drawn below it, on this tab. */
function latestBuild(b: WikiBuild, lang: Language): string {
  if (UNFINISHED.has(b.state)) {
    const cancel =
      `<form method="post" action="/api/queue/${esc(b.id)}/cancel">` +
      btn({ label: t(lang, "list.cancel") }) +
      `</form>`;
    // The running badge's own spinner, the one every running row on the
    // board carries, so the tab reads as work under way at a glance.
    const text = t(lang, "project.wikiRunning");
    const spinner = badge("running", t(lang, "state.running"));
    return rowMessage("waiting", text, { html: `${spinner} ${esc(text)}`, actions: cancel });
  }
  if (b.state === "done") {
    const date = (b.finishedAt ?? "").slice(0, 10);
    const text = t(lang, "project.wikiLastBuilt", { date });
    return rowMessage("info", text);
  }
  const why = b.error ?? t(lang, "project.wikiLastEnded", { state: b.state });
  return rowMessage("failed", why);
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
  const log = opts.wikiLog
    ? stepResults(opts.wikiLog.results, undefined, {
        tabHref: esc(`/projects/${encodeURIComponent(name)}?tab=wiki`),
        openStep: opts.wikiLog.step,
        runningStep: opts.wikiLog.runningStep,
        steptab: opts.wikiLog.steptab,
        lang,
      })
    : "";
  // While a build runs, the tab reloads itself as the spec page's Logs tab
  // does, so its log keeps up with nobody pressing reload; it stops once
  // the build is over.
  const live = building && opts.script ? `<span hidden data-reload-every="${RELOAD_SECONDS}"></span>` : "";
  return (
    live +
    `<h3>${esc(t(lang, "project.wikiHeading"))}</h3>` +
    `<div class="deploypanel">${refusal}${rowMessage("info", t(lang, "project.wikiNote"))}${latest}${form}</div>` +
    log
  );
}
