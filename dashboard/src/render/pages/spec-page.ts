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
// Save of their own. Update, the title, whether the spec is archived,
// what it depends on and whether it requires acceptance ticking (spec
// 394) are the banner's, visible on every tab rather than one.
//
// The reload went with that split. This page refreshed itself every ten
// seconds on every tab, which is why editing the description lived on a
// page of its own: a timer wipes a half-typed textarea and a half-ticked
// list. Checks and the four document tabs no longer refresh; Activity
// and Steps still do, because they are the two that move while a step
// runs and neither holds a form. The price is every banner fact — what
// the spec depends on, whether it requires acceptance ticking, whether
// it is archived — only as fresh as the last time the page was asked
// for, with the Update button beside it.
//
// Activity and Steps are the lead job's, through the JOB page's own
// functions. Not copies of them: `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring mistake, and a second tab bar would be the fourth.
//
// Split by theme into spec-page/ (split spec-page.ts by theme):
// types.ts (the view types), tabs.ts (paths, tabs, file/phase maps),
// overview.ts (the banner's own facts — archived read-only, the
// depends-on/acceptance tracking control editable — the Checks tab,
// Reopen/Reset), panels.ts (the document tabs), reset-page.ts (the
// reset confirmation page). `renderSpecPage` itself — the one function
// that assembles all of them — stays here.

import { badge, helpPopover, rowMessage } from "../ui/components.ts";
import { gerund } from "../ui/job-state/resting.ts";
import { esc } from "../ui/html.ts";
import type { Language } from "../../i18n";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { landingRefusal, stepResults, tabBar, tabbedBody } from "./job-page.ts";
import {
  archivedLine, boardStatus, checklist, closedLine, closeControl, pdfControl, reopenControl,
  resetControl, resetCloseNote, trackingControl,
} from "./spec-page/overview.ts";
import { descriptionPanel, documentPanel } from "./spec-page/panels.ts";
import {
  RELOADING_TABS, resolveSpecTab, SPEC_TABS, specPagePath, specTabPath, TAB_FILES, TAB_HELP,
} from "./spec-page/tabs.ts";
import type { SpecPageView } from "./spec-page/types.ts";

export type { SpecCheckView, SpecChecksView, SpecPageView } from "./spec-page/types.ts";
export {
  EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, FILE_TABS, PHASE_TAB, resolveSpecTab, TAB_FILES,
  documentTabScript, specPagePath, specTabPath,
} from "./spec-page/tabs.ts";
export { renderResetSpecPage } from "./spec-page/reset-page.ts";
export { renderCloseSpecPage } from "./spec-page/close-page.ts";

export function renderSpecPage(
  view: SpecPageView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; step?: string; now?: number; script?: string; scriptSrc?: string; lang?: Language } = {},
): string {
  const now = opts.now ?? Date.now();
  // Description, whatever is running. The JOB page opens on the
  // activity while a step runs, because that page is about the run;
  // this one is about the spec, and the spec's own prose is what most
  // readers come for first.
  const tab = resolveSpecTab(opts.tab);
  const lead = view.lead;

  // No title line. The project and folder sit directly above it and ARE
  // the title (spec 404: the project leads, matching the identifier
  // every other surface uses for this spec) — so the label spec 301
  // added, to stop a bare bold sentence being read as anything but the
  // title, was answering a question its own neighbour already answers.
  // Three spellings of one name on one page; the document's own heading
  // below is the file's text and stays as it is.
  const banner =
    // Where the description's editor would have been, in words: a
    // reader who came looking for it should not have to work out from a
    // missing textarea that the spec is closed.
    archivedLine(view) +
    closedLine(view) +
    trackingControl(view) +
    // What a board asked for is doing, in words. Its button lives in
    // the tab row below, which holds buttons only.
    boardStatus(view) +
    (view.error ? rowMessage("failed", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "waiting", view.notice.note, { tag: "p" }) : "");

  // The spec's own actions, at the end of the tab row (spec 300; sat on
  // a line of its own above the tabs until then). Reopen goes BEFORE
  // Update, so the control that is always there keeps the same spot: an
  // Update that slid left whenever a spec was archived would be a
  // button moving because something else appeared.
  // Every "(?)" first, then every button: a mark between two buttons
  // reads as belonging to the one before it, and the group's shape
  // changed with whichever marks the spec's state happened to draw.
  const actions =
    resetCloseNote(view) +
    (view.archived ? reopenControl(view) : "") +
    resetControl(view) +
    closeControl(view) +
    // A GET would let a reload re-run the pull, so this is a form and
    // not a link, exactly as every other action on this dashboard is.
    `<form class="actionform" method="post" action="${esc(view.updateAction)}">` +
    `<button class="btn" type="submit" title="pull the specs repository and show what it says now">` +
    `Update</button></form>`;

  const tabHref = specTabPath(view.project, view.specFolder, "steps");
  // Every tab says what it is for (spec 311): a "(?)" at the right end of
  // the tab's own first line, using the same shared component the search
  // field's own popover is built on — threaded into whichever function
  // draws that line rather than prepended ahead of it (spec 360).
  const mark = helpPopover("What this tab shows", TAB_HELP[tab]);
  const panel =
    tab === "steps"
      ? stepResults(view.steps ?? [], lead?.archiveHeldBack, {
          tabHref,
          openStep: opts.step,
          runningStep: lead?.runningStep,
          mark,
          // The same table, so the same answer: a step whose merge was
          // refused must not read "ok" here either.
          landingRefused: lead ? landingRefusal(lead, opts.lang ?? "en") : undefined,
        })
      : tab === "description"
        ? descriptionPanel(view, now, opts.lang ?? "en", mark)
        : TAB_FILES[tab]
          ? documentPanel(view, TAB_FILES[tab]!, now, opts.lang ?? "en", mark)
          // Checks: no file text at all, and no facts of its own — those
          // (archived, depends-on) moved into the banner, visible on
          // every tab, when this tab lost its old "Overview" name.
          : checklist(view, opts.lang ?? "en", mark);

  // Where the spec stands, on the line that names it: the four pips the
  // specs list already draws, and — while a phase is running — what it
  // is doing, in the reader's own language. The page said this only in
  // the Logs tab, one click away, so a spec you had just started looked
  // exactly like one that had never run.
  const running = lead?.runningStep?.step;
  // The end of the title line (2026-09-09): what is running, and the
  // PDF link at the far right — the phase pips that stood there said
  // nothing the tabs below do not, and the PDF is not an action on the
  // spec the way Reset, Close and Update are.
  const headTrailing =
    (running ? badge("running", gerund(opts.lang ?? "en", running)) : "") +
    pdfControl(view);

  const body = tabbedBody(
    banner,
    tabBar(
      SPEC_TABS,
      specPagePath(view.project, view.specFolder),
      tab,
      { steps: (view.steps?.length ?? 0) + (lead?.runningStep ? 1 : 0) },
      actions,
    ),
    panel,
    view.backHref ?? "/",
    `${view.project}:${view.specFolder}`,
    // The spec page's content is FIELDS — the depends-on picker, the
    // acceptance switch, the description editor — and they cap
    // themselves narrower than `.doc`'s default. One right edge means
    // taking theirs, or the tab row's own buttons end a hand's width
    // to the right of everything they act on.
    true,
    headTrailing,
  );

  return pageShell(
    view.specFolder,
    entries,
    "/",
    body,
    generatedAt,
    RELOADING_TABS.includes(tab) ? 10 : undefined,
    { script: opts.script, scriptSrc: opts.scriptSrc, hideHeading: true, lang: opts.lang },
  );
}
