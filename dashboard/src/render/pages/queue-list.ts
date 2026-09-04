// `/`: the one list of every spec there IS — cut and ordered on
// demand, one line per spec with its workflow phases beneath it, and
// every spec run from its own row.
//
// A spec is a row from the moment its folder exists, not from the moment
// it first runs: the dropdown and the list held the same things, and a
// spec crossing from one to the other told the reader nothing. Archived
// specs leave the page — but only where their project's absence can be
// PROVEN, never because a specs root happened to be unreadable.
//
// There was a form above the table too, with a spec dropdown of its own:
// two ways in, of which the dropdown read as the one you were meant to
// use, and which the five-second refresh could not keep current because
// it deliberately replaces the rows alone. The row does everything it
// did, so it is gone.
//
// The page carries browser code (compiled from queue-client.ts) so the
// list can refresh without reloading a control someone is half-way
// through setting. Everything the code does also works without it: the
// filters and the sort are ordinary links, and every Run control is a
// plain form.
//
// This file is now the composition root for four siblings under
// `queue-list/`: `data-model.ts` (SpecGroup and its types), `cells.ts`
// (the row and its cells), `filter-bar.ts` (the controls above the
// rows) and `model-picker.ts` (the AI/model selects a phase line
// carries). It keeps the page's own options type, the two entry points
// (`renderQueuePage`, `renderQueueRows`) and `groupRows`, which is the
// one function that has to know about both a filtered/sorted list AND
// a single row's markup.

import { rowMessage } from "../ui/components.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import type { QueueRowView } from "../ui/job-state.ts";
import { t, type Language } from "../../i18n/index.ts";
// Re-exported for the pages that pick a model outside a row of this
// list — `new-spec-page.ts` and `settings-page.ts` — so the split
// between this file and `queue-list/model-picker.ts` is invisible to
// them. Nothing here uses these locally.
export {
  TOOL_NAMES,
  defaultModelForTool,
  modelOptions,
  resolveChosenModel,
} from "./queue-list/model-picker.ts";
import {
  applyFilter,
  groupBySpec,
  groupKey,
  isArchivedRow,
  sortGroups,
  type ArchivedSpecView,
  type QueueFilter,
  type QueueTarget,
  type SpecGroup,
} from "./queue-list/data-model.ts";
// Re-exported for `render.ts` and the pages/tests that import the data
// model straight off this file's own historical path — some, like
// `PHASE_LINES` and `Phase`, only for that; nothing here reads them.
export {
  FILTER_FIELD_PREFIX,
  FILTER_KEYS,
  FROM_LIST_FIELD,
  PHASE_LINES,
  QUEUE_STEPS,
  computeSpecTotalDurationMs,
  filterShowsArchived,
  phasesFor,
  type Phase,
} from "./queue-list/data-model.ts";
export {
  isArchivedRow,
  type ArchivedSpecView,
  type QueueFilter,
  type QueueTarget,
  type SpecGroup,
};
import { LIST_COLUMNS, phaseSubRows, phasePips, refusalFor, specHeadRow, specNoticeRow } from "./queue-list/cells.ts";
// Re-exported for `spec-page.ts`, which draws a spec's phase pip strip
// on its own Overview tab.
export { phasePips };
import { filterBar, sortableHead } from "./queue-list/filter-bar.ts";

export interface QueuePageOptions {
  /** 81a ships no runner: the page says so rather than leaving jobs in
   *  "queued" with no explanation. */
  runnerAvailable: boolean;
  targets: QueueTarget[];
  /** `project/folder` keys of ARCHIVED specs. A create job normally
   *  keeps its group visible even though its spec is not a target (the
   *  folder does not exist until it lands) — but once the spec has been
   *  archived, that exception would keep a ghost row forever. */
  archived?: string[];
  /** The archived specs themselves, as reader rows (spec 221). The KEYS
   *  above are cheap and always sent — `groupBySpec` drops job rows by
   *  them; THIS is the walk over every archived folder, and the server
   *  only makes it when the resolved filter can show one
   *  (`filterShowsArchived`). Absent is therefore "the reader did not
   *  ask for them", not "there are none": the chip counts fall back to
   *  the keys above for exactly that reason.
   *
   *  Spec 193's exception lives on `notLanded` here rather than as a
   *  second visibility rule. An archived spec whose branch is still on
   *  origin used to be the ONE archived spec with a row, and it came
   *  through the ordinary interactive path — a Run, model selects and
   *  tick boxes the server would have refused. It is the same reader
   *  row as every other archived spec now, wearing the mark. */
  archivedSpecs?: ArchivedSpecView[];
  token?: string;
  /** Browser code for this page, compiled from `queue-client.ts` by the
   *  server. Nothing is hardcoded as a string here: page code is
   *  TypeScript like everything else, and the compiler checks it. */
  script?: string;
  /** The models a job may be asked to run on, from the config. Empty or
   *  absent means the per-step configuration is the only answer and the
   *  page offers no choice at all. */
  modelChoices?: { name: string; budgetUsd: number; tool?: "claude" | "codex" | "fake-claude" }[];
  /** The configured model per step (plus a "default" key), from the
   *  config's own `model` table. It is what a phase line's select is
   *  pre-filled with when the phase has not run yet — the reader sees
   *  the real name, never the word "default" (asked for 2026-08-19). */
  defaultModels?: Record<string, string>;
  /** A model picked for a phase before any job exists for it to attach
   *  to (spec 308), keyed by `project/specFolder` and then by step —
   *  what `resolveChosenModel()`'s new tier reads to survive a reload,
   *  a different browser, or simply leaving the page. Absent or missing
   *  an entry means nobody has picked one yet, which falls through to
   *  the configured default exactly as before this existed. */
  pendingModels?: Record<string, Record<string, string>>;
  /** The sibling of `pendingModels`, for an effort level picked before
   *  any job exists for it to attach to (spec 364) — same shape, same
   *  role, read by `resolveChosenEffort()`'s own pending tier. */
  pendingEffort?: Record<string, Record<string, string>>;
  /** Every allowlisted project. A job may name others it expects to
   *  touch, so the run watches and commits them instead of leaving half
   *  the work uncommitted on the machine. */
  projects?: string[];
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk yet, so it appears in no other list on
   *  this page. Empty or absent means the form is not offered at all. */
  createProjects?: string[];
  /** Why the last attempt was refused. Shown on the form, because the
   *  person who pressed the button is the one who needs to read it. */
  error?: string;
  /** Which spec that refusal belongs to, as `<project>/<specFolder>` —
   *  the same key the fold state already uses. The page lists up to 25
   *  rows, so a reason with no row attached says nothing about which
   *  button was pressed. Derived server-side from the job, never taken
   *  from the browser. */
  errorSpec?: string;
  /** How the list is cut and ordered, straight from the query string.
   *  Anything unrecognised falls back to the default rather than
   *  emptying the page. */
  filter?: QueueFilter;
  /** Spec 350. Absent means English (REQ-5) — the same default
   *  `pageShell`'s own `opts.lang` falls back to. */
  lang?: Language;
}


// Which rows the reader has opened — the exceptions, not the rule. The
// default is collapsed: a row says what the spec IS and how it is
// doing, and the controls that act on it come with expanding it.
const openedSet = (f: QueueFilter): Set<string> =>
  new Set((f.open ?? "").split(",").filter(Boolean));


// A collapsed row OMITS its phase lines and its "more" line rather than
// hiding them: the state is in the URL, so the server knows before it
// draws. A `<details>` cannot do this — it breaks the table — and a
// checkbox's state would be destroyed by the innerHTML swap every five
// seconds.
//
// Collapsed is the default, and the URL names the exceptions. That is
// what the fold is FOR: a list of twenty specs is read one state at a
// time, and the row you are about to act on is the one you open.
function groupRows(
  groups: SpecGroup[],
  opts: QueuePageOptions,
  now: number,
  opened: Set<string>,
): string {
  return groups
    .map((g) => {
      // An archived spec branched to a flat reader row of its own here
      // until spec 224 — `archivedHeadRow`, a second row builder kept
      // level with this one by hand, which had already drifted: no fold
      // and no phase lines on its side alone. There is one builder now
      // and `isArchivedRow` locks it, so the failure mode spec 193 met
      // in the other direction — an archived spec drawn as a fully
      // interactive row, offering a Run the server refuses — cannot be
      // reached by forgetting a branch.
      //
      // The panel belongs to the row, not to the phase lines: a
      // collapsed row is told what went wrong without being opened.
      const head = specHeadRow(g, opts, opened) + specNoticeRow(g, refusalFor(g, opts), now, opts.lang ?? "en");
      return opened.has(groupKey(g.project, g.specFolder))
        ? head + phaseSubRows(g, opts, now)
        : head;
    })
    .join("");
}

// The controls and the rows alone, so the page can refresh its table
// from script without touching a form someone is half-way through
// filling in.
//
// One list, cut and ordered on demand. It used to be two — a fixed
// "Active" section above a "Recent" one — which answered the single
// question "is anything running?" and no other. A filter answers that
// one too, and every other one besides.
//
// One line per SPEC, not per job. A spec taken through its four steps as
// four separate jobs used to fill four rows, repeating its own name on
// every one, each showing a single progress pip. It is one spec, and it
// gets one line, with its phases beneath it.
//
// EVERY spec the filter matches, for every filter (spec 226). There was
// a 25-row cap here, with a line under the table counting what it had
// dropped. Hiding rows is wrong in every view: the archived and the
// combined views are read with the browser's own find, and find cannot
// reach a row the server never sent. The cap was a performance guess,
// and if the poll's payload ever turns out to matter the fix is
// server-side — send only the rows that changed, or cache the fragment
// — never a cap again.
export function renderQueueRows(rows: QueueRowView[], opts: QueuePageOptions, now = Date.now()): string {
  const f = opts.filter ?? {};
  const groups = groupBySpec(rows, opts.targets, opts.archived, opts.archivedSpecs, now);
  const matched = sortGroups(applyFilter(groups, f), f);
  const body = matched.length
    ? // `groups`, not `matched`: a dependency the filter has hidden is
      // still in the way of the row that names it.
      groupRows(matched, opts, now, openedSet(f))
    : `<tr><td colspan="${LIST_COLUMNS}" class="empty muted">` +
      // Two different emptinesses. "Nothing matches what you asked for"
      // is answered by changing the filter; "there is no spec here at
      // all" is not, and telling that reader to pick one above is
      // pointing at an empty dropdown.
      (groups.length
        ? t(opts.lang ?? "en", "list.noSpecMatchesFilter")
        : t(opts.lang ?? "en", "list.noSpecAtAll")) +
      `</td></tr>`;
  return (
    filterBar(groups, f, opts) +
    // "speclist" beside "list": the mobile stylesheet lays THIS table
    // out as stacked blocks (its rows are flex lines there), and the
    // archive page and the settings table share .list without wanting
    // any of that.
    `<div class="tablewrap"><table class="list speclist">${sortableHead(f, opts.lang ?? "en")}<tbody>${body}</tbody></table></div>`
  );
}

export function renderQueuePage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: QueuePageOptions,
): string {
  // One container: the script swaps its whole contents, so the controls
  // and the rows can never drift apart on a refresh.
  const lang = opts.lang ?? "en";
  const table = `<div id="jobrows">${renderQueueRows(rows, opts)}</div>`;
  const notice = opts.runnerAvailable ? "" : `<p class="muted">${t(lang, "list.noRunner")}</p>\n`;
  const body =
    notice +
    // The fallback, and only that. A refusal that names its spec is
    // shown in that spec's own panel (`specNoticeRow`) — the page lists up
    // to 25 of them, so the banner said nothing about which button was
    // pressed. One that names no spec has nowhere else to go, and
    // dropping it silently is worse than a banner.
    (opts.error && !opts.errorSpec
      ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n"
      : "") +
    // The New spec link rides on the filter row now (right-hand end,
    // after the (?)): it is a plain link since spec 121, so the
    // five-second swap of `#jobrows` holds no half-typed state to lose.
    table;
  // The front page IS the board: the tab says only that — and the
  // heading said it a second time right under the Specs tab, so it is
  // gone (2026-08-19). The title still names the page for the shell.
  return pageShell("Specs", entries, "/", body, generatedAt, 10, {
    docTitle: "aide -board",
    hideHeading: true,
    refreshInNoscript: !!opts.script,
    script: opts.script,
    lang,
  });
}
