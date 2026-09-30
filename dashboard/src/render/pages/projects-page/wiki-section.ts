// The project page's Wiki tab: Pages, Graph and Build panels behind a
// sub-tab bar of their own, nested one level under `?tab=wiki` the way a
// job step's own Log/Files/Errors strip nests under `?step=` (`wikitab`,
// beside `steptab`). A project with no wiki draws no bar at all and shows
// the Build panel alone. A build is a job of the project's, never a row on
// the Specs list, so the Build panel is where it is followed — a press, a
// Cancel and a refusal all come back there, posted by the page script
// (`specs-client/reload-form/`) and the panel loaded again.

import { badge, buttonForm, messageSlot, rowMessage } from "../../ui/components";
import { stepResults } from "../job-page";
import { reloadMarker } from "../spec-page/tabs.ts";
import { esc } from "../../ui/html.ts";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { t, type Language } from "../../../i18n";
import { wikiGraph } from "./wiki-graph.ts";
import { wikiPages } from "./wiki-pages.ts";
import type { ProjectPageOptions } from "./types.ts";

type WikiBuild = NonNullable<ProjectPageOptions["wikiBuild"]>;

/** The Build panel's refusal line, which Build wiki and Cancel name. */
const WIKI_REFUSED_LINE = "wiki-refused";

const UNFINISHED = new Set(["queued", "running"]);
const WIKI_TABS = ["pages", "graph", "build"] as const;
type WikiSubTab = (typeof WIKI_TABS)[number];

/** The latest build: running with Cancel, last built, or how it ended. Its
 *  log is drawn below it, on the Build panel. */
function latestBuild(b: WikiBuild, lang: Language): string {
  if (UNFINISHED.has(b.state)) {
    const cancel = buttonForm({
      action: `/api/queue/${b.id}/cancel`,
      hook: "reloadform",
      data: { line: WIKI_REFUSED_LINE },
      button: { label: t(lang, "list.cancel"), pending: t(lang, "list.cancelling") },
    });
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

/** The Build panel: what the wiki is, the button, the latest build and its
 *  log — today's whole tab, before Pages and Graph grew beside it. */
function buildPanel(name: string, opts: ProjectPageOptions, lang: Language, building: boolean): string {
  const refusal = messageSlot("refused", "failed", { id: WIKI_REFUSED_LINE });
  const form = building
    ? ""
    : buttonForm({
        action: `/api/queue/projects/${encodeURIComponent(name)}/wiki`,
        hook: "reloadform",
        data: { line: WIKI_REFUSED_LINE },
        button: { label: t(lang, "project.wikiButton"), variant: "primary", pending: "building…" },
      });
  const latest = opts.wikiBuild ? latestBuild(opts.wikiBuild, lang) : "";
  const log = opts.wikiLog
    ? stepResults(opts.wikiLog.results, undefined, {
        tabHref: `/projects/${encodeURIComponent(name)}?tab=wiki&wikitab=build`,
        openStep: opts.wikiLog.step,
        runningStep: opts.wikiLog.runningStep,
        steptab: opts.wikiLog.steptab,
        lang,
      })
    : "";
  return (
    `<h3>${esc(t(lang, "project.wikiHeading"))}</h3>` +
    `<div class="deploypanel">${refusal}${rowMessage("info", t(lang, "project.wikiNote"))}${latest}${form}</div>` +
    log
  );
}

/** The Pages/Graph/Build strip. `data-wikisubtabs` marks it apart from the
 *  outer project tab bar (Deploy/Config/Schedule/Wiki), which carries the
 *  same two classes one level up. */
function wikiSubTabBar(name: string, current: WikiSubTab, building: boolean, lang: Language): string {
  const label: Record<WikiSubTab, string> = {
    pages: t(lang, "project.wikiTabPages"),
    graph: t(lang, "project.wikiTabGraph"),
    build: `${t(lang, "project.wikiTabBuild")}${building ? ` (${t(lang, "state.running")})` : ""}`,
  };
  return tabBar(WIKI_TABS, (tab) => `/projects/${encodeURIComponent(name)}?tab=wiki&wikitab=${tab}`, current, {}, "", {
    label: (tab) => label[tab],
    data: { wikisubtabs: "" },
  });
}

export function wikiSection(name: string, opts: ProjectPageOptions): string {
  const lang = opts.lang ?? "en";
  const hasWiki = !!opts.wiki;
  const building = !!opts.wikiBuild && UNFINISHED.has(opts.wikiBuild.state);
  // No wiki: the Build panel is the only thing there is to show — the tab
  // a first-ever build is watched from. An open page always wins over the
  // address's own `wikitab`, so a graph point's link (which names no
  // `wikitab`) still lands where AC-5 wants it.
  const current: WikiSubTab = !hasWiki ? "build" : opts.wiki?.open ? "pages" : pickTab(WIKI_TABS, opts.wikiTab, "pages");

  const panel =
    current === "pages"
      ? wikiPages(name, opts.wiki!, lang)
      : current === "graph"
        ? wikiGraph(name, opts.wiki!.pages)
        : buildPanel(name, opts, lang, building);

  // While a build runs, the Build panel reloads itself as the spec page's
  // Logs tab does, so its log keeps up with nobody pressing reload. Pages
  // and Graph never carry this: nothing on either changes while a build
  // runs elsewhere, and a reload would only interrupt a drag or a hover on
  // the graph, or remount an open page's viewer and lose the reader's place.
  const live = current === "build" && building ? reloadMarker() : "";

  return live + (hasWiki ? wikiSubTabBar(name, current, building, lang) : "") + panel;
}
