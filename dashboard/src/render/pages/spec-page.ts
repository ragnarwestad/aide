// /specs/<project>/<specFolder>: the whole spec, as it stands now (spec
// 150).
//
// The dashboard never showed a spec — it showed jobs. Every link on a
// spec's row went to one queue RUN, whose Overview held the
// `## Description` prose and then that run's own figures, and nothing
// anywhere showed 2-analysis.md, 3-solution.md or 4-status.md: the
// files the analyze and implement steps exist to write. A
// reader who wanted to know what a phase produced left the dashboard
// for GitHub or the filesystem.
//
// So: the four files, each stamped with the commit that last changed
// it — because the specs checkout this page reads is pulled by a cron
// every two minutes, and "which version am I looking at" had no answer
// at all. The Update button is the other half of that: it pulls, and
// the reader can SEE the dashboard has the change before pressing Run.
//
// ONE TAB EACH since spec 212, where they used to be stacked in full on
// Overview: for a spec of any size that was thousands of lines of
// preformatted text before the reader reached whatever they came for.
// The renamed Checks tab (spec 294) carries no file text either — just
// the checks that are still holding the spec back, as real boxes with a
// Save of their own. Update, the title, what the spec depends on and
// whether it is archived are the banner's, visible on every tab rather
// than one.
//
// The reload went with that split. This page refreshed itself every ten
// seconds on every tab, which is why editing the description lived on a
// page of its own: a timer wipes a half-typed textarea and a half-ticked
// list. Checks and the four document tabs no longer refresh; Activity
// and Steps still do, because they are the two that move while a step
// runs and neither holds a form. The price is every banner fact — what
// the spec depends on, whether it is archived — only as fresh as the
// last time the page was asked for, with the Update button beside it.
//
// Activity and Steps are the lead job's, through the JOB page's own
// functions. Not copies of them: `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring mistake, and a second tab bar would be the fourth.
//
// Split by theme into spec-page/ (split spec-page.ts by theme):
// types.ts (the view types), tabs.ts (paths, tabs, file/phase maps),
// overview.ts (the banner's read-only facts, the Checks tab, Reopen/
// Reset), panels.ts (the document tabs), reset-page.ts (the reset
// confirmation page). `renderSpecPage` itself — the one function that
// assembles all of them — stays here.

import { rowMessage } from "../ui/components.ts";
import { esc } from "../ui/html.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { pickTab, stepResults, tabBar, tabbedBody } from "./job-page.ts";
import { archivedLine, checklist, dependsOnLine, reopenControl, resetControl } from "./spec-page/overview.ts";
import { descriptionPanel, documentPanel } from "./spec-page/panels.ts";
import { RELOADING_TABS, SPEC_TABS, specPagePath, specTabPath, TAB_FILES } from "./spec-page/tabs.ts";
import type { SpecPageView } from "./spec-page/types.ts";

export type { SpecCheckView, SpecChecksView, SpecPageView } from "./spec-page/types.ts";
export { EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, PHASE_TAB, specPagePath, specTabPath } from "./spec-page/tabs.ts";
export { renderResetSpecPage } from "./spec-page/reset-page.ts";

export function renderSpecPage(
  view: SpecPageView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; step?: string; now?: number; script?: string } = {},
): string {
  const now = opts.now ?? Date.now();
  // Description, whatever is running. The JOB page opens on the
  // activity while a step runs, because that page is about the run;
  // this one is about the spec, and the spec's own prose is what most
  // readers come for first.
  const tab = pickTab(SPEC_TABS, opts.tab, "description");
  const lead = view.lead;

  // A `<div>`, not the job page's `<p>`: `.pagehead` already lays its
  // children out at the two ends of the line, and a `<form>` inside a
  // paragraph is not markup a browser has to keep.
  const banner =
    // The spec's own actions, together at the end of the line
    // (2026-08-23). Reopen used to sit further down, under the archived
    // note that explains it, which put the page's two buttons in two
    // places for no reason a reader could see.
    //
    // Reopen goes BEFORE Update, so the control that is always there
    // keeps the same spot: an Update that slid left whenever a spec was
    // archived would be a button moving because something else
    // appeared.
    `<div class="pagehead"><span class="row">` +
    (view.archived ? reopenControl(view) : "") +
    resetControl(view) +
    // A GET would let a reload re-run the pull, so this is a form and
    // not a link, exactly as every other action on this dashboard is.
    `<form class="actionform" method="post" action="${esc(view.updateAction)}">` +
    `<button class="btn" type="submit" title="pull the specs repository and show what it says now">` +
    `Update</button></form>` +
    `</span></div>` +
    (view.title ? `<p class="desc"><strong>${esc(view.title)}</strong></p>` : "") +
    // Where the description's editor would have been, in words: a
    // reader who came looking for it should not have to work out from a
    // missing textarea that the spec is closed.
    archivedLine(view) +
    dependsOnLine(view) +
    (view.error ? rowMessage("err", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "warn", view.notice.note, { tag: "p" }) : "");

  const tabHref = specTabPath(view.project, view.specFolder, "steps");
  const panel =
    tab === "steps"
      ? stepResults(view.steps ?? [], lead?.archiveHeldBack, {
          tabHref,
          openStep: opts.step,
          runningStep: lead?.runningStep,
        })
      : tab === "description"
        ? descriptionPanel(view, now)
        : TAB_FILES[tab]
          ? documentPanel(view, TAB_FILES[tab]!, now)
          // Checks: no file text at all, and no facts of its own — those
          // (archived, depends-on) moved into the banner, visible on
          // every tab, when this tab lost its old "Overview" name.
          : checklist(view);

  const body = tabbedBody(
    banner,
    tabBar(
      SPEC_TABS,
      specPagePath(view.project, view.specFolder),
      tab,
      { steps: (view.steps?.length ?? 0) + (lead?.runningStep ? 1 : 0) },
    ),
    panel,
    view.backHref ?? "/",
    view.specFolder,
  );

  return pageShell(
    view.specFolder,
    entries,
    "/",
    body,
    generatedAt,
    RELOADING_TABS.includes(tab) ? 10 : undefined,
    { script: opts.script, hideHeading: true },
  );
}
