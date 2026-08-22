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

/** One row of `4-status.md`'s Tasks tables, as the page shows it (spec
 *  182). `phase` and `line` are the row's identity and travel back with
 *  a tick: the server finds the row by them and refuses if either has
 *  moved, so a stale page can never flip the wrong line. */
export interface SpecCheckView {
  phase: string;
  line: string;
  task: string;
  done: boolean;
}

/** The spec's remaining checks, and where a tick posts (spec 182). */
export interface SpecChecksView {
  rows: SpecCheckView[];
  action: string;
  /** The commit `4-status.md` was read at — `saveSpecFile`'s existing
   *  file-level guard, carried through the form the way the description
   *  editor already carries it. */
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
   *  moved into `archive/` and the spec is a RECORD: Edit was built for
   *  a description edited while the work is live (spec 162), and Save
   *  on an archived spec would have written, committed and pushed into
   *  `archive/`. */
  archived?: boolean;
  /** Where the Update button posts. Built by the server, because only
   *  it knows the action's own path. */
  updateAction: string;
  /** The spec's own checks, at the top of the page (spec 182). Absent
   *  for a spec whose `4-status.md` has no phase section at all. */
  checks?: SpecChecksView;
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

/** The one file of the four a person owns (spec 162). `2-analysis.md`
 *  and `3-solution.md` are the analyze and review-plan steps' output —
 *  a hand edit there is overwritten the next time they run — and
 *  `4-status.md` has been the runner's since spec 154. Named here
 *  because the page decides which panel offers the link and the server
 *  decides which file the route writes, and those two must be the same
 *  file. */
export const EDITABLE_SPEC_FILE = "1-description.md";

/** The file whose Status marks a person may now flip, one row at a
 *  time (spec 182). Named beside `EDITABLE_SPEC_FILE` and for the same
 *  reason: this page decides which rows carry a button and the server
 *  decides which file the tick route writes, and those two must be the
 *  same file. It is NOT editable in the `EDITABLE_SPEC_FILE` sense —
 *  there is no textarea and never will be, because a textarea cannot
 *  structurally stop a person rewriting a step's own prose. */
export const STATUS_SPEC_FILE = "4-status.md";

/** Where Edit goes. Beside `specPagePath` for the same reason: the
 *  server routes on it and this page links to it. */
export const specEditPath = (project: string, specFolder: string): string =>
  `${specPagePath(project, specFolder)}/edit`;

/** The spec's remaining checks, above the tab bar (spec 182).
 *
 *  In the BANNER, not in the Overview panel: the description asks for
 *  the top of the spec's page, and a reader on Activity or Steps is
 *  reading the same spec. It is also where they stop being buried —
 *  these rows live near the bottom of the fourth file, which is the
 *  last place anyone looks.
 *
 *  Done rows are shown too, dimmed: the list is what is left AND what
 *  has been settled, and a list that only ever shrinks says nothing
 *  about how far the spec got. Each undone row is its own one-button
 *  `<form>` — one click, no JavaScript, the shape every other action on
 *  this dashboard already has. An archived spec's rows are a record and
 *  carry no control at all.
 *
 *  The phase leads its own group heading rather than repeating on every
 *  row: the rows under `Phase 4: REFACTOR` are all Phase 4's. */
function checklist(view: SpecPageView): string {
  const rows = view.checks?.rows ?? [];
  if (rows.length === 0) return "";
  const action = view.checks!.action;
  const baseSha = view.checks!.baseSha ?? "";
  const open = rows.filter((r) => !r.done).length;
  const groups: { phase: string; rows: SpecCheckView[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.phase === row.phase) last.rows.push(row);
    else groups.push({ phase: row.phase, rows: [row] });
  }
  const control = (row: SpecCheckView): string =>
    row.done || view.archived
      ? `<span class="checkbox" aria-hidden="true">${row.done ? "✅" : "☐"}</span>`
      : `<form class="actionform" method="post" action="${esc(action)}">` +
        `<input type="hidden" name="phase" value="${esc(row.phase)}">` +
        `<input type="hidden" name="line" value="${esc(row.line)}">` +
        `<input type="hidden" name="baseSha" value="${esc(baseSha)}">` +
        `<button class="checkbox" type="submit" title="tick this check off — it is committed as made by hand">` +
        `☐</button></form>`;
  const item = (row: SpecCheckView): string =>
    `<li class="check ${row.done ? "done" : "open"}">${control(row)}` +
    `<span class="checktask">${esc(row.task)}</span></li>`;
  const group = (g: { phase: string; rows: SpecCheckView[] }): string =>
    `<li class="checkphase">${esc(g.phase)}</li>` + g.rows.map(item).join("");
  return (
    `<section class="checks"><p class="checkshead"><strong>Checks</strong> ` +
    `<span class="small muted">${open === 0 ? "all done" : `${open} of ${rows.length} still open`}</span></p>` +
    `<ul class="checklist">${groups.map(group).join("")}</ul></section>`
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
    // Where Edit would have been, in words: a reader who came looking
    // for it should not have to work out from a missing button that the
    // spec is closed.
    (view.archived
      ? rowMessage("info", "This spec is archived — a record, and read-only.", { tag: "p" })
      : "") +
    (view.error ? rowMessage("err", view.error, { tag: "p" }) : "") +
    (view.notice ? rowMessage(view.notice.ok ? "info" : "warn", view.notice.note, { tag: "p" }) : "") +
    checklist(view);

  const panel =
    tab === "activity"
      ? activityPanel(lead ?? { results: [] })
      : tab === "steps"
        ? stepResults(lead?.results ?? [], lead?.archiveHeldBack)
        : view.files
            .map((f) =>
              specFilePanel(
                f,
                now,
                f.label === EDITABLE_SPEC_FILE && !view.archived
                  ? specEditPath(view.project, view.specFolder)
                  : undefined,
              ),
            )
            .join("");

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
