// /specs/<project>/<specFolder>: the whole spec, as it stands now (spec
// 150).
//
// The dashboard never showed a spec — it showed jobs. Every link on a
// spec's row went to one queue RUN, whose Overview held the
// `## Description` prose and then that run's own figures, and nothing
// anywhere showed 2-analysis.md, 3-solution.md or 4-status.md: the
// files the analyze, review-plan and implement steps exist to write. A
// reader who wanted to know what a phase produced left the dashboard
// for GitHub or the filesystem.
//
// So: the four files, in order, each stamped with the commit that last
// changed it — because the specs checkout this page reads is pulled by
// a cron every two minutes, and "which version am I looking at" had no
// answer at all. The Update button is the other half of that: it pulls,
// and the reader can SEE the dashboard has the change before pressing
// Run.
//
// Activity and Steps are the lead job's, through the JOB page's own
// functions. Not copies of them: `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring mistake, and a second tab bar would be the fourth.

import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { notStartedChip, stateChip } from "./job-state.ts";
import { rowMessage } from "./components.ts";
import {
  activityPanel,
  pickTab,
  specFilePanel,
  stepResults,
  tabBar,
  tabbedBody,
  type JobDetailView,
  type SpecFileView,
} from "./job-page.ts";

export interface SpecPageView {
  project: string;
  specFolder: string;
  /** The spec's H1, when 1-description.md has one. */
  title?: string;
  /** The four files, in the order they are written and read. */
  files: SpecFileView[];
  /** Whatever is in flight, or failing that the last thing that
   *  happened. Absent for a spec nothing has ever run — which is the
   *  whole reason this page is keyed on the spec and not on a job id. */
  lead?: JobDetailView;
  /** Where the Update button posts. Built by the server, because only
   *  it knows the action's own path. */
  updateAction: string;
  /** Why the last pull changed nothing, and what it did when it did —
   *  both off the query string, the same round-trip Approve, Cancel and
   *  Merge already use. */
  error?: string;
  notice?: { note: string; ok: boolean };
}

/** The path this page lives at. One function, because the server routes
 *  on it and the list links to it. */
export const specPagePath = (project: string, specFolder: string): string =>
  `/specs/${encodeURIComponent(project)}/${encodeURIComponent(specFolder)}`;

export function renderSpecPage(
  view: SpecPageView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  // Overview, whatever is running. The JOB page opens on the activity
  // while a step runs, because that page is about the run; this one is
  // about the spec, and the spec is what the reader came for.
  const tab = pickTab(opts.tab, "overview");
  const lead = view.lead;

  // A `<div>`, not the job page's `<p>`: `.pagehead` already lays its
  // children out at the two ends of the line, and a `<form>` inside a
  // paragraph is not markup a browser has to keep.
  const banner =
    `<div class="pagehead">${lead ? stateChip(lead) : notStartedChip()}` +
    // A GET would let a reload re-run the pull, so this is a form and
    // not a link, exactly as every other action on this dashboard is.
    `<form class="actionform" method="post" action="${esc(view.updateAction)}">` +
    `<button class="btn" type="submit" title="pull the specs repository and show what it says now">` +
    `Update</button></form></div>` +
    (view.title ? `<p class="desc"><strong>${esc(view.title)}</strong></p>` : "") +
    (view.error ? rowMessage("err", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "warn", view.notice.note, { tag: "p" }) : "");

  const panel =
    tab === "activity"
      ? activityPanel(lead ?? { results: [] })
      : tab === "steps"
        ? stepResults(lead?.results ?? [], lead?.archiveHeldBack)
        : view.files.map((f) => specFilePanel(f, now)).join("");

  const body = tabbedBody(
    banner,
    tabBar(
      specPagePath(view.project, view.specFolder),
      tab,
      { activity: lead?.activity?.length ?? 0, steps: lead?.results.length ?? 0 },
      "Spec",
    ),
    panel,
  );

  return pageShell(view.specFolder, entries, "/", body, generatedAt, 10);
}
