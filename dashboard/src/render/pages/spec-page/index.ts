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
// The Status tab draws the acceptance criteria as real boxes with a
// Save of their own, above its file. Update, the title, whether the spec is archived,
// what it depends on and whether it requires acceptance ticking (spec
// 394) are the banner's, visible on every tab rather than one.
//
// The reload went with that split. This page refreshed itself every ten
// seconds on every tab, which is why editing the description lived on a
// page of its own: a timer wipes a half-typed textarea and a half-ticked
// list. No tab reloads now. The Steps tab, which moves while a step runs
// and holds no form, follows its job in place through the page script
// (`renderSpecStepsFollowParts`). Every banner fact — what the spec depends
// on, whether it requires acceptance ticking, whether it is archived — is
// only as fresh as the last time the page was asked for, with the Update
// button beside it.
//
// Activity and Steps are the lead job's, through the JOB page's own
// functions. Not copies of them: `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring mistake, and a second tab bar would be the fourth.
//
// Split by theme into spec-page/ (split spec-page.ts by theme):
// types.ts (the view types), tabs.ts (paths, tabs, file/phase maps),
// overview.ts (the banner's own facts — archived read-only, the
// depends-on/acceptance tracking control editable — the checklist,
// Reopen), panels.ts (the document tabs) and ask-dialog.ts (the
// dialog Close and Reopen ask in). `renderSpecPage` itself — the one
// function that assembles all of them — stays here.

import { badge, buttonForm, helpPopover, messageSlot, rowMessage } from "../../ui/components";
import { projectLink } from "../../ui/components/spec-name.ts";
import { gerund } from "../../../format/gerund.ts";
import { esc } from "../../ui/html.ts";
import type { Language } from "../../../i18n";
import { pageShell, shellHead, shellRest, type NavEntry } from "../../ui/shell.ts";
import { LOADING_HIDE_RULE, loadingBlock } from "../../ui/loading.ts";
import { t } from "../../../i18n";
import { landingRefusal, stepResults, tabBar, tabbedBody } from "../job-page";
import { followMarker, followPart } from "../job-page/follow.ts";
import {
  actionsHelp, archivedLine, testServerStatus, closedLine, closeControl, pdfControl,
  reopenControl, trackingControl,
} from "./overview.ts";
import { descriptionPanel, documentPanel } from "./panels.ts";
import {
  resolveSpecTab, SPEC_LINES, SPEC_NOTICE_LINE, SPEC_REFUSED_LINE, SPEC_TABS, specPagePath, specTabPath, TAB_FILES, TAB_HELP, type SpecTab,
} from "./tabs.ts";
import type { SpecPageView } from "./types.ts";

export type { SpecCheckView, SpecChecksView, SpecPageView } from "./types.ts";
export {
  EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, FILE_TABS, resolveSpecTab, TAB_FILES,
  documentTabScript, specPagePath, specTabPath,
} from "./tabs.ts";

interface SpecPageOpts {
  tab?: string;
  step?: string;
  steptab?: string;
  now?: number;
  script?: string;
  scriptSrc?: string;
  lang?: Language;
  currentUrl?: string;
}

/** What the Steps tab draws of a spec: its lead job and every step of the
 *  round. The follow answer builds only these two, not the whole page's view. */
export type SpecStepsView = Pick<SpecPageView, "project" | "specFolder" | "lead" | "steps">;

/** The index the lead job's running step has among the round's steps once it
 *  finishes — what keys its row and what the follow marker names. */
const runningIndexOf = (view: SpecStepsView): number | undefined =>
  view.lead?.runningStep ? (view.steps?.length ?? 0) : undefined;

/** Where the spec stands, on the line that names it: while a phase is
 *  running, what it is doing, in the reader's own language. The page said
 *  this only in the Logs tab, one click away, so a spec you had just started
 *  looked exactly like one that had never run. */
function runningBadge(view: SpecStepsView, lang: Language): string {
  const running = view.lead?.runningStep?.step;
  return running ? badge("running", gerund(lang, running)) : "";
}

/** The Steps tab's table, with the tab's own "(?)" in its first line. */
function stepsTable(view: SpecStepsView, opts: Pick<SpecPageOpts, "step" | "steptab" | "lang">): string {
  const lead = view.lead;
  return stepResults(view.steps ?? [], lead?.archiveHeldBack, {
    tabHref: specTabPath(view.project, view.specFolder, "steps"),
    openStep: opts.step,
    runningStep: lead?.runningStep,
    steptab: opts.steptab,
    lang: opts.lang,
    mark: helpPopover("What this tab shows", TAB_HELP.steps),
    // The same table, so the same answer: a step whose merge was
    // refused must not read "ok" here either.
    landingRefused: lead ? landingRefusal(lead, opts.lang ?? "en") : undefined,
  });
}

/** What `?follow=1` answers on the Steps tab: the marker and the parts the
 *  page script swaps, drawn by the same functions as the page. */
export function renderSpecStepsFollowParts(view: SpecStepsView, opts: Pick<SpecPageOpts, "step" | "steptab" | "lang"> = {}): string {
  return (
    (view.lead ? followMarker(view.lead, { tab: "steps", step: opts.step, runningIndex: runningIndexOf(view) }) : "") +
    followPart("head", runningBadge(view, opts.lang ?? "en"), "span") +
    followPart("panel", stepsTable(view, opts))
  );
}

/** The page's body and the tab it is on — what `renderSpecPage` and the
 *  streamed second half (`renderSpecPageRest`) both draw. */
function specPageBody(view: SpecPageView, opts: SpecPageOpts): { body: string; tab: SpecTab } {
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
    archivedLine(view, opts.lang ?? "en") +
    closedLine(view, opts.lang ?? "en") +
    trackingControl(view, opts.lang ?? "en") +
    // What a board asked for is doing, in words. Its button lives in
    // the tab row below, which holds buttons only.
    testServerStatus(view) +
    // The Steps tab follows a job that is in flight; the page script reads
    // the marker.
    (tab === "steps" && lead
      ? followMarker(lead, { tab, step: opts.step, runningIndex: runningIndexOf(view) })
      : "") +
    (view.error ? rowMessage("failed", view.error, { tag: "p" }) : "") +
    (view.warning ? rowMessage("waiting", view.warning, { tag: "p" }) : "") +
    // Where the page script writes what a press on this page answered:
    // Update, Save, the banner, the Status tab's tick, Stop test server.
    messageSlot("refused", "failed", { id: SPEC_REFUSED_LINE }) +
    messageSlot("notice", "info", { id: SPEC_NOTICE_LINE });

  // The spec's own actions, at the end of the tab row (spec 300; sat on
  // a line of its own above the tabs until then). Reopen goes BEFORE
  // Update, so the control that is always there keeps the same spot: an
  // Update that slid left whenever a spec was archived would be a
  // button moving because something else appeared.
  // Every "(?)" first, then every button: a mark between two buttons
  // reads as belonging to the one before it.
  const actions =
    actionsHelp(view) +
    (view.archived ? reopenControl(view, opts.lang ?? "en") : "") +
    closeControl(view, opts.lang ?? "en") +
    // A GET would let a reload re-run the pull, so this is a form and
    // not a link, exactly as every other action on this dashboard is.
    buttonForm({ action: view.updateAction, hook: "reloadform", data: SPEC_LINES, button: { label: "Update", pending: "updating…" } });

  // Every tab says what it is for (spec 311): a "(?)" at the right end of
  // the tab's own first line, using the same shared component the search
  // field's own popover is built on — threaded into whichever function
  // draws that line rather than prepended ahead of it (spec 360).
  const mark = helpPopover("What this tab shows", TAB_HELP[tab]);
  const panel =
    tab === "steps"
      ? followPart("panel", stepsTable(view, opts))
      : tab === "description"
        ? descriptionPanel(view, now, opts.lang ?? "en", mark)
        : documentPanel(view, TAB_FILES[tab]!, now, opts.lang ?? "en", mark);

  // The end of the title line (2026-09-09): what is running, and the
  // PDF link at the far right — the phase pips that stood there said
  // nothing the tabs below do not, and the PDF is not an action on the
  // spec the way Close and Update are. On the Steps tab the badge is the
  // `head` part the page script swaps, so it follows its job too.
  const badgeHtml = runningBadge(view, opts.lang ?? "en");
  const headTrailing = (tab === "steps" ? followPart("head", badgeHtml, "span") : badgeHtml) + pdfControl(view);

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
    { html: `${projectLink(view.project)}:${esc(view.specFolder)}` },
    // The spec page's content is FIELDS — the depends-on picker, the
    // acceptance switch, the description editor — and they cap
    // themselves narrower than `.doc`'s default. One right edge means
    // taking theirs, or the tab row's own buttons end a hand's width
    // to the right of everything they act on.
    true,
    headTrailing,
  );

  return { body, tab };
}

export function renderSpecPage(
  view: SpecPageView,
  generatedAt: string,
  entries: NavEntry[],
  opts: SpecPageOpts = {},
): string {
  const { body } = specPageBody(view, opts);
  return pageShell(view.specFolder, entries, "/specs", body, generatedAt, {
    script: opts.script,
    scriptSrc: opts.scriptSrc,
    hideHeading: true,
    hideTabBar: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

/** The spec page's first chunk (spec 515): the document up to `<body>`, the
 *  stylesheet and scripts, and the loading element. Needs only what the
 *  route knows before any view data exists. */
export function renderSpecPageHead(specFolder: string, lang: Language): string {
  return shellHead(specFolder, { lang }) + loadingBlock(lang);
}

/** The second chunk: the same document `renderSpecPage` draws, from the
 *  header on, with the rule that hides the loading element right after
 *  `</main>`. */
export function renderSpecPageRest(
  view: SpecPageView,
  _generatedAt: string,
  entries: NavEntry[],
  opts: SpecPageOpts = {},
): string {
  const { body } = specPageBody(view, opts);
  return shellRest(entries, "/specs", view.specFolder, body, {
    script: opts.script,
    scriptSrc: opts.scriptSrc,
    hideHeading: true,
    hideTabBar: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
    afterMain: LOADING_HIDE_RULE,
  });
}

/** What ends a spec page whose second half failed after the head was sent:
 *  the loading element hidden and one sentence saying what to do. */
export function renderSpecPageFailedRest(entries: NavEntry[], lang: Language, currentUrl?: string): string {
  return shellRest(entries, "/specs", "", rowMessage("failed", t(lang, "shell.pageFailed"), { tag: "p" }), {
    hideHeading: true,
    hideTabBar: true,
    lang,
    currentUrl,
    afterMain: LOADING_HIDE_RULE,
  });
}
