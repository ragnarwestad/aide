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
// Overview carries no file text at all now — it is where the spec
// STANDS: the state chip, Update, the title, what it depends on, and
// the checks that are still holding it back, as real boxes with a Save
// of their own.
//
// The reload went with that split. This page refreshed itself every ten
// seconds on every tab, which is why editing the description lived on a
// page of its own: a timer wipes a half-typed textarea and a half-ticked
// list. Overview and the four document tabs no longer refresh; Activity
// and Steps still do, because they are the two that move while a step
// runs and neither holds a form. The price is a state chip only as
// fresh as the last time the page was asked for, with the Update button
// beside it.
//
// Activity and Steps are the lead job's, through the JOB page's own
// functions. Not copies of them: `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring mistake, and a second tab bar would be the fourth.

import { btn, field, rowMessage, tokenField } from "./components.ts";
import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { notStartedChip, stateChip } from "./job-state.ts";
import { dependsOnField } from "./new-spec-page.ts";
import type { QueueTarget } from "./queue-list.ts";
import {
  activityPanel,
  fileStamp,
  pickTab,
  specFilePanel,
  stepResults,
  tabBar,
  tabbedBody,
  type JobDetailView,
  type SpecFileView,
} from "./job-page.ts";

/** One row of `4-status.md`'s Tasks tables, as the page shows it (spec
 *  182). `phase` and `line` are the row's identity: the checks form
 *  names the row by them so the server can refuse a row that has
 *  moved. */
export interface SpecCheckView {
  phase: string;
  line: string;
  task: string;
  done: boolean;
}

/** The spec's checks, on the Overview tab (specs 182, 188, 212).
 *
 *  `rows` is every row in the file, done ones included. `phase` is the
 *  one phase whose open rows may be TICKED — the first section still
 *  carrying an open mark, which is what the spec list's own column
 *  shows. A row already done is a check already made, and a row in a
 *  phase the workflow has not reached is a check nothing is waiting on;
 *  both are shown, neither is a box.
 *
 *  One `phase` for the whole set rather than one per tickable row is
 *  what makes each box's own value the row's verbatim line: a table row
 *  contains `|` and cannot be packed into one field with its phase
 *  beside it. `baseSha` is the file's own commit at read time, the same
 *  guard the description's form carries. */
export interface SpecChecksView {
  rows: SpecCheckView[];
  phase?: string;
  baseSha?: string;
}

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
  /** Whether the spec has been archived (spec 163). Its folder has
   *  moved into `archive/` and the spec is a RECORD: the description's
   *  textarea was built for a description edited while the work is live
   *  (spec 162), and a Save on an archived spec would have written,
   *  committed and pushed into `archive/`. */
  archived?: boolean;
  /** Where the Update button posts. Built by the server, because only
   *  it knows the action's own path. */
  updateAction: string;
  /** Where the Description tab's Save posts. */
  saveAction: string;
  /** Where the Overview tab's checks form posts (spec 212). Its own
   *  route, and therefore its own commit: a person no longer has to
   *  open the description's editor in order to tick a box. */
  tickAction: string;
  /** The queue's token, when the site has one — the Reopen control
   *  posts to `/api/queue` like every other lifecycle action, and that
   *  route checks it. Absent leaves the field out entirely rather than
   *  posting an empty one, exactly as `tokenField` does on the list. */
  token?: string;
  /** The spec's own checks (spec 182). Absent for a spec whose
   *  `4-status.md` has no phase section at all. */
  checks?: SpecChecksView;
  /** What the spec depends on, resolved to live folders the way the
   *  runtime gate resolves it (spec 166's line may hold a bare number,
   *  and a hand-edited one usually does). Read-only on Overview; the
   *  ticks of the Description tab's picker. Empty and neither is drawn
   *  at all. */
  dependsOn?: string[];
  /** What this spec MAY be made to depend on: every active spec in its
   *  own project, itself left out. Empty — a project whose only spec is
   *  this one — and the picker is not drawn (spec 174). */
  dependsOnOptions?: QueueTarget[];
  /** The commit `1-description.md` was read at, carried through the
   *  Description tab's form so a save whose file has moved since can be
   *  refused. Absent for a file git has never committed, which is not a
   *  mismatch. */
  descriptionBaseSha?: string;
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

/** One TAB of that page. Beside `specPagePath` and for the same reason:
 *  the server sends a refused save back to the tab its form was on, and
 *  the query-string shape of a tab is this layer's to know. */
export const specTabPath = (project: string, specFolder: string, tab: string): string =>
  `${specPagePath(project, specFolder)}?tab=${encodeURIComponent(tab)}`;

/** The page's tabs: where the spec stands, then its four documents in
 *  the order they are written and read, then the lead job's own two.
 *
 *  A tuple of this page's own, fed to `job-page.ts`'s `pickTab` and
 *  `tabBar` — which take the list as an argument since spec 212 exactly
 *  so there is still ONE tab-bar renderer for a page with seven tabs
 *  and a page with three. */
const SPEC_TABS = [
  "overview",
  "description",
  "analysis",
  "solution",
  "status",
  "activity",
  "steps",
] as const;
type SpecTab = (typeof SPEC_TABS)[number];

/** Which tabs move on their own, and therefore reload. Activity and
 *  Steps are the two that change while a step runs, and neither holds a
 *  form; every other tab carries one, and a page that reloads on a
 *  timer wipes what was half-typed or half-ticked. */
const RELOADING_TABS: readonly SpecTab[] = ["activity", "steps"];

/** The one file of the four a person owns (spec 162). `2-analysis.md`
 *  and `3-solution.md` are the analyze step's output —
 *  a hand edit there is overwritten the next time it runs — and
 *  `4-status.md` has been the runner's since spec 154. Named here
 *  because the page decides which tab is a textarea and the server
 *  decides which file the route writes, and those two must be the same
 *  file. */
export const EDITABLE_SPEC_FILE = "1-description.md";

/** The file whose Status marks a person may now flip, one row at a
 *  time (spec 182). Named beside `EDITABLE_SPEC_FILE` and for the same
 *  reason: this page decides which rows carry a box and the server
 *  decides which file the tick route writes, and those two must be the
 *  same file. It is NOT editable in the `EDITABLE_SPEC_FILE` sense —
 *  there is no textarea and never will be, because a textarea cannot
 *  structurally stop a person rewriting a step's own prose. */
export const STATUS_SPEC_FILE = "4-status.md";

/** Which file each document tab shows. The Description tab renders its
 *  own form rather than a `<pre>`, and is here for the file it names. */
const TAB_FILES: Partial<Record<SpecTab, string>> = {
  description: EDITABLE_SPEC_FILE,
  analysis: "2-analysis.md",
  solution: "3-solution.md",
  status: STATUS_SPEC_FILE,
};

/** What the spec depends on, on the front page, in words (spec 212).
 *
 *  Read-only, whether the spec is archived or not: the control that
 *  CHANGES it is the Description tab's picker, because the line it
 *  writes is a line of `1-description.md` and belongs with that file's
 *  own Save. Two controls for one fact can disagree; one cannot.
 *
 *  Nothing at all when the spec depends on nothing — the same
 *  convention `dependsOnField` keeps for a project with nothing to
 *  offer. */
function dependsOnLine(view: SpecPageView): string {
  const folders = view.dependsOn ?? [];
  if (folders.length === 0) return "";
  return (
    `<p class="desc"><strong>Depends on</strong> ` +
    `<span class="muted">${folders.map((f) => esc(f)).join(", ")}</span></p>`
  );
}

/** The spec's checks, on the OVERVIEW tab (specs 182, 188, 212).
 *
 *  Spec 182 put these rows at the top of the page because they were
 *  buried near the bottom of the fourth file, which is the last place
 *  anyone looks. Spec 188 then made every one of them inert and moved
 *  the tick onto the description's Edit form, because a second way of
 *  changing a spec was one too many for a reader to learn.
 *
 *  They are boxes again, with a Save of their own. That is not spec
 *  188 undone: a reader still has ONE place to tick, and the
 *  description's editor is now a tab beside this one rather than a page
 *  behind a link, so ticking a box no longer means opening it.
 *
 *  On the Overview PANEL rather than in the banner, which is where spec
 *  182 put the summary: a form in the banner rides onto Activity and
 *  Steps, and those two reload every ten seconds — which would wipe a
 *  half-ticked list, the exact failure this spec's reload scoping
 *  exists to prevent.
 *
 *  Done rows are shown too, dimmed: the list is what is left AND what
 *  has been settled, and a list that only ever shrinks says nothing
 *  about how far the spec got. They are not boxes, and neither are the
 *  open rows of a phase the workflow has not reached — a check already
 *  made and a check nothing is waiting on are both answers, not
 *  questions.
 *
 *  The phase leads its own group heading rather than repeating on every
 *  row: the rows under `Phase 4: REFACTOR` are all Phase 4's. */
function checklist(view: SpecPageView): string {
  const rows = view.checks?.rows ?? [];
  if (rows.length === 0) return "";
  const open = rows.filter((r) => !r.done).length;
  const groups: { phase: string; rows: SpecCheckView[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.phase === row.phase) last.rows.push(row);
    else groups.push({ phase: row.phase, rows: [row] });
  }
  // Spec 163: an archived spec is a RECORD, and a tick would write,
  // commit and push into `archive/`. The rows stay — they are a fact
  // about the spec — and nothing on them presses.
  const tickable = (row: SpecCheckView): boolean =>
    !view.archived && !row.done && row.phase === view.checks?.phase;
  const anyTickable = rows.some(tickable);
  const control = (row: SpecCheckView): string =>
    tickable(row)
      // The row's verbatim line is the value: the server finds the row
      // by it and refuses one that has moved, so a stale page can never
      // flip the wrong line.
      ? `<label class="checkbox"><input type="checkbox" name="tick" value="${esc(row.line)}"></label>`
      : `<span class="checkbox" aria-hidden="true">${row.done ? "✅" : "☐"}</span>`;
  const item = (row: SpecCheckView): string =>
    `<li class="check ${row.done ? "done" : "open"}">${control(row)}` +
    `<span class="checktask">${esc(row.task)}</span></li>`;
  const group = (g: { phase: string; rows: SpecCheckView[] }): string =>
    `<li class="checkphase">${esc(g.phase)}</li>` + g.rows.map(item).join("");
  const list = `<ul class="checklist">${groups.map(group).join("")}</ul>`;
  const head =
    `<p class="checkshead"><strong>Checks</strong> ` +
    `<span class="small muted">${open === 0 ? "all done" : `${open} of ${rows.length} still open`}</span></p>`;
  if (!anyTickable) return `<section class="checks">${head}${list}</section>`;
  return (
    `<section class="checks">${head}` +
    `<form method="post" action="${esc(view.tickAction)}">` +
    tokenField(view.token) +
    `<input type="hidden" name="checksPhase" value="${esc(view.checks!.phase!)}">` +
    // Empty rather than absent for a file git has never committed —
    // the same answer the description's own field gives.
    `<input type="hidden" name="statusBaseSha" value="${esc(view.checks?.baseSha ?? "")}">` +
    list +
    `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}</span>` +
    `</form></section>`
  );
}

/** The one action an archived spec offers (spec 198).
 *
 *  Reopening used to be done by hand in a terminal — move the folder out
 *  of `archive/`, overwrite three files, hunt the branch down in two
 *  repositories and two places each. It was done twice and something was
 *  missed both times, so it is one press, offered where the spec is.
 *
 *  A plain `POST /api/queue` with `steps=reopen`, the same enqueue every
 *  other lifecycle action on this dashboard uses. That is not tidiness:
 *  it is what makes this control and `/aide-reopen` in a terminal one
 *  operation rather than two implementations that have to be kept
 *  agreeing.
 *
 *  A form and not a link, for the reason the Update button gives: a GET
 *  would let a reload run it again.
 *
 *  Nothing ELSE about an archived spec changes — no textarea on the
 *  Description tab, the same read-only note above this, the checks shown
 *  but not tickable. And nothing here is drawn for a live spec: its own
 *  row on the queue list is where its actions are. */
function reopenControl(view: SpecPageView): string {
  return (
    `<form class="actionform" method="post" action="/api/queue">` +
    (view.token ? `<input type="hidden" name="token" value="${esc(view.token)}">` : "") +
    `<input type="hidden" name="project" value="${esc(view.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(view.specFolder)}">` +
    `<input type="hidden" name="steps" value="reopen">` +
    `<button class="btn" type="submit" ` +
    `title="take this spec back into the active list for another round: ` +
    `reset the analysis, the plan and the status, keep the description, and remove its branch">` +
    `Reopen</button></form>`
  );
}

/** One document, read-only, under its own name and commit stamp. A tab
 *  whose file the view does not carry at all renders the same "not
 *  written yet" note an empty one does, rather than nothing. */
function documentPanel(view: SpecPageView, label: string, now: number): string {
  const found = view.files.find((f) => f.label === label);
  return specFilePanel(found ?? { label, text: null }, now);
}

/** The Description tab: the one file of the four a person owns, in a
 *  textarea, with the Save that commits and pushes it (spec 162, moved
 *  onto this page by spec 212).
 *
 *  Modelled on `new-spec-page.ts`, which is the other page here that is
 *  nothing but a form: same `field()`/`tokenField()` helpers, and no
 *  script at all — a real form posting to a real route, following a 303
 *  back. The Save-busy behaviour comes from the shell's own head script,
 *  which listens on `document`, so nothing here has to wire it.
 *
 *  An archived spec gets the read-only panel instead: it is a RECORD,
 *  and a Save would have written, committed and pushed into `archive/`.
 *  The refusal itself is on the route — hiding a control is never the
 *  guard — but a box that only ever gets refused is not a box to draw. */
function descriptionPanel(view: SpecPageView, now: number): string {
  const file = view.files.find((f) => f.label === EDITABLE_SPEC_FILE);
  if (view.archived) return documentPanel(view, EDITABLE_SPEC_FILE, now);
  const picker = dependsOnField(view.dependsOnOptions ?? [], new Set(view.dependsOn ?? []));
  return (
    `<h2>${esc(EDITABLE_SPEC_FILE)}${fileStamp(file ?? { label: EDITABLE_SPEC_FILE, text: null }, now)}</h2>` +
    `<form method="post" action="${esc(view.saveAction)}" class="newspecform">` +
    tokenField(view.token) +
    // Empty rather than absent when git has never committed the file:
    // an absent field and an empty one say the same thing to the route,
    // and one of them is a field that cannot be there.
    `<input type="hidden" name="baseSha" value="${esc(view.descriptionBaseSha ?? "")}">` +
    // Spec 166: above the file, because a dependency is about the spec
    // rather than about the prose — and because the line it writes is
    // the one line the textarea below no longer shows. The control is
    // the New-spec page's own since spec 174.
    //
    // The note goes with the picker rather than standing on its own: a
    // project with nothing to depend on draws neither, and a sentence
    // about a control that is not there is one more thing to read past.
    (picker
      ? `<span class="frow">${picker}</span>` +
        `<p class="muted">A dependency applies from this spec's next gated step ` +
        `(implement, resolve, archive) — never to a step already running.</p>`
      : "") +
    `<span class="frow">` +
    field(
      EDITABLE_SPEC_FILE,
      // No newline between the tag and the text: an HTML parser eats a
      // single leading one, which would silently drop the first line of
      // a file that begins with a blank one.
      `<textarea name="text" rows="30" spellcheck="false">${esc(file?.text ?? "")}</textarea>`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}</span>` +
    `</form>`
  );
}

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
  const tab = pickTab(SPEC_TABS, opts.tab, "overview");
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
    // Where the description's editor would have been, in words: a
    // reader who came looking for it should not have to work out from a
    // missing textarea that the spec is closed.
    (view.archived
      ? rowMessage("info", "This spec is archived — a record, and read-only.", { tag: "p" }) +
        reopenControl(view)
      : "") +
    (view.error ? rowMessage("err", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "warn", view.notice.note, { tag: "p" }) : "");

  const panel =
    tab === "activity"
      ? activityPanel(lead ?? { results: [] })
      : tab === "steps"
        ? stepResults(lead?.results ?? [], lead?.archiveHeldBack)
        : tab === "description"
          ? descriptionPanel(view, now)
          : TAB_FILES[tab]
            ? documentPanel(view, TAB_FILES[tab]!, now)
            // Overview: no file text at all. Where the spec stands, what
            // it is waiting on, and what is still holding it back.
            : dependsOnLine(view) + checklist(view);

  const body = tabbedBody(
    banner,
    tabBar(
      SPEC_TABS,
      specPagePath(view.project, view.specFolder),
      tab,
      { activity: lead?.activity?.length ?? 0, steps: lead?.results.length ?? 0 },
      "Spec",
    ),
    panel,
  );

  return pageShell(
    view.specFolder,
    entries,
    "/",
    body,
    generatedAt,
    RELOADING_TABS.includes(tab) ? 10 : undefined,
  );
}
