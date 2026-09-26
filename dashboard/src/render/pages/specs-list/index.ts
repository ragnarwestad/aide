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
// The page carries browser code (compiled from specs-client.ts) so the
// list can refresh without reloading a control someone is half-way
// through setting. Everything the code does also works without it: the
// filters and the sort are ordinary links, and every Run control is a
// plain form.
//
// This file is now the composition root for four siblings under
// `specs-list/`: `data-model.ts` (SpecGroup and its types), `cells.ts`
// (the row and its cells), `filter-bar.ts` (the controls above the
// rows) and `model-picker.ts` (the AI/model selects a phase line
// carries). It keeps the page's own options type, the two entry points
// (`renderSpecsPage`, `renderSpecsRows`) and `groupRows`, which is the
// one function that has to know about both a filtered/sorted list AND
// a single row's markup.

import { rowMessage } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import type { QueueRowView } from "../../ui/job-state";
import { t, type Language } from "../../../i18n";
import type { FailedCreate } from "../../../push/failed-creates.ts";
import { renderFailedCreateNotices } from "./failed-create-notices.ts";
// Re-exported for the pages that pick a model outside a row of this
// list — `new-spec-page.ts` and `settings-page.ts` — so the split
// between this file and `specs-list/model-picker.ts` is invisible to
// them. Nothing here uses these locally.
export {
  TOOL_NAMES,
  defaultModelForTool,
  modelOptions,
  resolveChosenModel,
} from "./model-picker.ts";
import {
  applyFilter,
  groupBySpec,
  groupKey,
  isArchivedRow,
  sortGroups,
  type ArchivedSpecView,
  type SpecsFilter,
  type SpecTarget,
  type SpecGroup,
} from "./data-model";
// Re-exported for `render.ts` and the pages/tests that import the data
// model straight off this file's own historical path — some, like
// `PHASE_LINES` and `Phase`, only for that; nothing here reads them.
export {
  FILTER_FIELD_PREFIX,
  FILTER_KEYS,
  FROM_LIST_FIELD,
  PHASE_LINES,
  RUN_STEPS,
  computeSpecTotalDurationMs,
  filterShowsArchived,
  NOT_VERIFIED_KEY,
  phasesFor,
  type Phase,
} from "./data-model";
export {
  isArchivedRow,
  type ArchivedSpecView,
  type SpecsFilter,
  type SpecTarget,
  type SpecGroup,
};
import { LIST_COLUMNS, phaseSubRows, phasePips, refusalFor, specHeadRow, specNoticeRow } from "./cells.ts";
// Re-exported for `spec-page.ts`, which draws a spec's phase pip strip
// on its own Overview tab.
export { phasePips };
import { filterBar, sortableHead } from "./filter-bar.ts";
import type { PhaseMessages } from "./phase-messages";
export { phaseKey, parsePhaseKeys, type PhaseMessages } from "./phase-messages";

export interface SpecsPageOptions {
  /** The creates that ended without a spec and have not been dismissed
   *  (spec 506): each is a message above the filter bar, never a row. */
  failedCreates?: FailedCreate[];
  /** 81a ships no runner: the page says so rather than leaving jobs in
   *  "queued" with no explanation. */
  runnerAvailable: boolean;
  targets: SpecTarget[];
  /** `project/folder` keys of ARCHIVED specs. A create job normally
   *  keeps its group visible even though its spec is not a target (the
   *  folder does not exist until it lands) — but once the spec has been
   *  archived, that exception would keep a ghost row forever. */
  archived?: string[];
  /** The CLOSED subset of `archived` above (spec 406, REQ-7) — same
   *  cheap key list, filtered to the ones carrying a `**Closed:**`
   *  stamp. Read by the filter's own counts (`filter-bar.ts`) so an unbuilt
   *  closed spec's key contributes to "All" but never to "Archived":
   *  the same key/row split `archived` itself already has, one level
   *  more specific. */
  closed?: string[];
  /** The subset of `archived` whose spec has Acceptance rows marked Not
   *  verified: what the Not verified entry's count adds for the archived
   *  specs no row was built for. */
  notVerified?: string[];
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
  /** Browser code for this page, compiled from `specs-client.ts` by the
   *  server. Nothing is hardcoded as a string here: page code is
   *  TypeScript like everything else, and the compiler checks it. */
  script?: string;
  /** The models a job may be asked to run on, from the config. Empty or
   *  absent means the per-step configuration is the only answer and the
   *  page offers no choice at all. */
  modelChoices?: { name: string; tool?: "claude" | "codex" | "opencode" | "fake-claude" }[];
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
  /** Which phases a reader chose — at create time, or at a later Run —
   *  keyed by `project/specFolder` (spec 439): what `chosenSteps()` and
   *  `actionState()` read the row's ticks and its action button from,
   *  falling back to the row's own git history only for a spec with no
   *  entry here at all. Absent or missing an entry behaves exactly as
   *  before this existed. */
  pendingSteps?: Record<string, string[]>;
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk yet, so it appears in no other list on
   *  this page. Empty or absent means the form is not offered at all. */
  createProjects?: string[];
  /** Which projects can run a test server — the exact capability check
   *  `ctx.testServers.previewAvailable` already gates the spec page's own
   *  start link on (`spec-page.ts:198`, one conjunct of that page's own
   *  three-way AND — the other two are per-spec, not per-project) and the
   *  project page's Deploy tab on (`project-pages.ts:280`), passed
   *  straight through rather than re-derived (spec 466, AC-3). Absent
   *  treats every project as capable, unchanged from before this existed
   *  — real traffic always supplies it (`specs-pages.ts`). */
  testServerAvailable?: (project: string) => boolean;
  /** The messages of one unfolded phase, for the attempts that may have
   *  run it (newest first) — called only for a phase the address names
   *  in `phases` (spec 500). Undefined: nothing is kept to read. */
  phaseMessages?: (attemptIds: string[], step: string) => PhaseMessages | undefined;
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
  filter?: SpecsFilter;
  /** Spec 350. Absent means English (REQ-5) — the same default
   *  `pageShell`'s own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page, filter and sort. */
  currentUrl?: string;
}


// Which rows the reader has opened — the exceptions, not the rule. The
// default is collapsed: a row says what the spec IS and how it is
// doing, and the controls that act on it come with expanding it.
const openedSet = (f: SpecsFilter): Set<string> =>
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
  opts: SpecsPageOptions,
  now: number,
  opened: Set<string>,
): string {
  const testServerAvailable = opts.testServerAvailable ?? (() => true);
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
      //
      // An open row reads head row, phase lines, then the message rows:
      // the detail the chevron opens sits directly under the row, and
      // every message keeps that one place.
      const head = specHeadRow(g, opts, opened);
      const notice = specNoticeRow(g, refusalFor(g, opts), now, opts.lang ?? "en", testServerAvailable, {
        filter: opts.filter,
      });
      // Each spec ends with an empty row the stylesheet turns into the air
      // between two cards. It closes the group rather than opening the
      // next one, so the page's own row swap (row-swap.ts, which takes a
      // spec as its head row and everything up to the next) carries it
      // along with the spec it belongs to.
      const gap = `<tr class="specgap" aria-hidden="true"><td colspan="${LIST_COLUMNS}"></td></tr>`;
      return opened.has(groupKey(g.project, g.specFolder))
        ? head + phaseSubRows(g, opts, now) + notice + gap
        : head + notice + gap;
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
export function renderSpecsRows(rows: QueueRowView[], opts: SpecsPageOptions, now = Date.now()): string {
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
    renderFailedCreateNotices(opts.failedCreates ?? [], opts.lang ?? "en") +
    filterBar(groups, f, opts) +
    // "speclist" beside "list": the mobile stylesheet lays THIS table
    // out as stacked blocks (its rows are flex lines there), and the
    // archive page and the settings table share .list without wanting
    // any of that.
    `<div class="tablewrap"><table class="list speclist">${sortableHead(f, opts.lang ?? "en")}<tbody>${body}</tbody></table></div>`
  );
}

/** One spec's rows and nothing else, for a › that opened or shut that
 *  spec alone: the whole list is a megabyte once the archive is on it,
 *  and redrawing all of it to change one row took seconds on a phone.
 *  The table is empty when the filter does not show that spec, and the
 *  page then redraws the whole list instead. */
export function renderSpecGroupRows(rows: QueueRowView[], opts: SpecsPageOptions, key: string, now = Date.now()): string {
  const f = opts.filter ?? {};
  const groups = groupBySpec(rows, opts.targets, opts.archived, opts.archivedSpecs, now);
  const one = applyFilter(groups, f).filter((g) => groupKey(g.project, g.specFolder) === key);
  return `<table><tbody>${groupRows(one, opts, now, openedSet(f))}</tbody></table>`;
}

export function renderSpecsPage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: SpecsPageOptions,
): string {
  // One container: the script swaps its whole contents, so the controls
  // and the rows can never drift apart on a refresh.
  const lang = opts.lang ?? "en";
  const table = `<div id="jobrows">${renderSpecsRows(rows, opts)}</div>`;
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
  return pageShell("Specs", entries, "/", body, generatedAt, opts.script ? undefined : 10, {
    docTitle: "aide -board",
    hideHeading: true,
    script: opts.script,
    lang,
    currentUrl: opts.currentUrl,
  });
}
