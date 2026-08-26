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

import { esc, relTime, relTimeLabel, usdOrTokens } from "../ui/html.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { NEW_SPEC_ROUTE } from "./site.ts";
// One function, because the server routes on this path and the list
// links to it (spec 150).
import { PHASE_TAB, specPagePath, specTabPath } from "./spec-page.ts";
import {
  CHECKING,
  ICON_CHEVRON,
  ICON_SEARCH,
  badge,
  btn,
  filterPills,
  phaseChip,
  pips,
  rowMessage,
  stepLabel,
  tokenField,
} from "../ui/components.ts";
import {
  anyCostUnmeasured,
  completedThirds,
  currentStep,
  inFlight,
  specNotice,
  type RestingState,
  restingChip,
  specStateChip,
  stateLabel,
  durationLabel,
  wordPhase,
  type BranchView,
  type PhaseWord,
  type QueueRowView,
} from "../ui/job-state.ts";
import {
  TOOL_NAMES,
  aiPicker,
  defaultModelForTool,
  lockedDuration,
  lockedModel,
  modelOptions,
  modelPicker,
  phaseCaptionCells,
  resolveChosenModel,
} from "./queue-list/model-picker.ts";
// Re-exported for the pages that pick a model outside a row of this
// list — `new-spec-page.ts` and `settings-page.ts` — so the split
// between this file and `queue-list/model-picker.ts` is invisible to
// them.
export { TOOL_NAMES, defaultModelForTool, modelOptions, resolveChosenModel };

import {
  ARCHIVED_STATE,
  DEFAULT_SORT,
  DEFAULT_STATE_FILTER,
  PHASE_LINES,
  QUEUE_STEPS,
  SORTS,
  SORT_DEFAULT_DIR,
  STATE_FILTERS,
  applyFilter,
  computeSpecTotalDurationMs,
  filterShowsArchived,
  groupBySpec,
  groupKey,
  isArchivedRow,
  matchesSearch,
  matchesState,
  phaseDuration,
  phasesFor,
  sortGroups,
  stateFilter,
  type ArchivedSpecView,
  type Phase,
  type QueueFilter,
  type QueueTarget,
  type SpecGroup,
} from "./queue-list/data-model.ts";
// Re-exported for `render.ts` and the pages/tests that import the data
// model straight off this file's own historical path.
export {
  PHASE_LINES,
  QUEUE_STEPS,
  computeSpecTotalDurationMs,
  filterShowsArchived,
  isArchivedRow,
  phasesFor,
  type ArchivedSpecView,
  type Phase,
  type QueueFilter,
  type QueueTarget,
  type SpecGroup,
};


/** What the date cell says when the spec carries no stamp and git
 *  cannot date its folder either — a folder copied in rather than
 *  committed. Spelled out here so the row and its test cannot word the
 *  same absence differently. */
export const NO_DATE = "date unknown";

/** The mark an archived row carries when its branch is still open.
 *  Drawn with the same `refused` badge a failed row gets — one archive
 *  is not a different kind of problem from the other. */
export const NOT_LANDED = "not landed";

/** The mark an archived row carries instead, when its branch is open
 *  BECAUSE THE PROJECT ASKED FOR THAT (spec 220): `codeLanding: pr` in
 *  its manifest, so the code waits on a pull request for as long as the
 *  review takes. Same fact from origin — the branch is there — and the
 *  opposite meaning, which is the whole reason it is worded apart:
 *  `NOT_LANDED` reads as an instruction to run archive again, and this
 *  one is an instruction to go and review something. */
export const PR_OPEN = "PR open";

/** The three fields the search reads. Named in one place because the
 *  page says them out loud under the field — a filter whose reach is a
 *  guess is a filter nobody trusts. */
const SEARCHED = ["folder", "title", "description"];

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
  modelChoices?: { name: string; budgetUsd: number; tool?: "claude" | "codex" }[];
  /** The configured model per step (plus a "default" key), from the
   *  config's own `model` table. It is what a phase line's select is
   *  pre-filled with when the phase has not run yet — the reader sees
   *  the real name, never the word "default" (asked for 2026-08-19). */
  defaultModels?: Record<string, string>;
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
}

// --- what every form on this page needs ------------------------------------

// Every form on this page posts to the guarded surface, so every one of
// them carries the token when the page has one. Written once: a form
// that forgot it would be refused with a 401 the reader cannot act on.
/** How the list is cut and ordered. One list, exported so `serve.ts`
 *  builds the redirect after a POST from the same five keys the forms
 *  send — two copies would eventually disagree about what "the view" is. */
export const FILTER_KEYS = ["state", "project", "sort", "dir", "open", "q"] as const;

/** The prefix a filter key rides under as a form field. Prefixed
 *  because one of the five is `project`, which is ALSO what the Run
 *  form posts to say which spec to run: two fields of that name arrive
 *  as a list, and the enqueue refuses the whole request as "invalid
 *  project". */
export const FILTER_FIELD_PREFIX = "view.";

/** What tells `POST /api/queue` that the press came from a row on THIS
 *  list (spec 221). Reopen is offered in two places — an archived
 *  spec's own page and its row here — and the two want the answer on
 *  different pages. A marker rather than a redirect target: where to go
 *  back to is the server's decision, and a page that took the
 *  destination from the browser would take it from anyone. */
export const FROM_LIST_FIELD = "fromList";

/** The current view, sent along with the press. The redirect the server
 *  answers with can only carry forward what the POST itself received,
 *  so the fields have to leave the browser on the same request. */
const filterFields = (f?: QueueFilter): string =>
  FILTER_KEYS.map((k) => {
    const v = f?.[k];
    return v ? `<input type="hidden" name="${FILTER_FIELD_PREFIX}${k}" value="${esc(v)}">` : "";
  }).join("");


// Links, not script: the filter lives in the URL, so it survives a
// reload, can be shared, and works with JavaScript switched off. The
// page's own code intercepts the click to avoid reloading a form
// someone is half-way through.
function queueHref(f: QueueFilter, patch: QueueFilter): string {
  const merged = { ...f, ...patch };
  const q = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return esc(q ? `/?${q}` : "/");
}

// Which rows the reader has opened — the exceptions, not the rule. The
// default is collapsed: a row says what the spec IS and how it is
// doing, and the controls that act on it come with expanding it.
const openedSet = (f: QueueFilter): Set<string> =>
  new Set((f.open ?? "").split(",").filter(Boolean));

// The fold is a LINK, not a button, and the state is in the URL. That
// buys three things at once for no browser code at all: it works with
// script off, `queue-client.ts` already intercepts `a[data-nav]` inside
// `#jobrows` so a click neither reloads the page nor wipes a half-filled
// form, and the choice survives the table swapping itself every five
// seconds — the same mechanism the filter and the sort ride on.
function foldControl(g: SpecGroup, f: QueueFilter, opened: Set<string>): string {
  const key = groupKey(g.project, g.specFolder);
  const shut = !opened.has(key);
  const next = shut ? [...opened, key] : [...opened].filter((k) => k !== key);
  return (
    `<a class="fold${shut ? " shut" : ""}" data-nav href="${queueHref(f, { open: next.join(",") })}" ` +
    // The key is never the visible content — anything in `?open=` is
    // attacker-chosen text, and an icon cannot be mistaken for markup.
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${shut ? "show" : "hide"} the phases and controls of ${esc(g.specFolder)}">${ICON_CHEVRON}</a>`
  );
}

// What the page used to say in a paragraph above the list: how runs
// work here. A front page does not open with four sentences a returning
// reader has read, so the same facts sit behind a "?" beside the filter
// chips instead. It is inside `#jobrows`, so it shuts again on the
// five-second refresh, and fine for that: nothing here is being typed
// into.
function runsHelp(): string {
  return (
    `<details class="intro"><summary title="How runs work here" ` +
    `aria-label="How runs work here">?</summary>` +
    `<p>A few jobs run side by side here, each in a checkout of its own, ` +
    `and never two on the same spec. Every step is bounded by its own ` +
    `budget and a wall clock — a job that hits either cap is ` +
    `<em>stopped</em>, not failed.</p></details>`
  );
}

function filterBar(groups: SpecGroup[], f: QueueFilter, opts: QueuePageOptions): string {
  const chips = (
    name: string,
    label: string,
    entries: { key: string; label: string; count: number; on: boolean; patch: QueueFilter }[],
  ) =>
    filterPills(
      name,
      label,
      entries.map((e) => ({
        label: e.label,
        count: e.count,
        on: e.on,
        href: queueHref(f, e.patch),
      })),
    );

  const current = stateFilter(f.state).key;
  // Counts are of what the OTHER filter already allows, so the numbers
  // add up to the table you are looking at rather than to some list
  // nobody asked for. The search is one of those filters since spec 221
  // — a chip counting rows a term has cut would be counting a table
  // nobody can see. They count SPECS, because that is what the table
  // holds one line per.
  const counted = groups.filter((g) => matchesSearch(g, f));
  // The archived rows are built only where the filter shows them (spec
  // 221), so on the default view there are almost none to count — and
  // "Archived (0)" beside an archive of a hundred and fifty is the one
  // thing a count must not say. The KEYS are cheap and always sent, and
  // there is exactly one reader row per key, so the keys no row was
  // built for are the rest of the count. "Almost" because the default
  // view does build a row for an archived spec whose branch is still
  // open (spec 193), which is why this subtracts what is on the page
  // rather than testing whether anything is.
  //
  // Dropped while a search term is active: which archived specs a term
  // would have matched cannot be known without the rows, and a number
  // that is wrong is worse than a chip with no number on it.
  const built = new Set(
    groups.filter(isArchivedRow).map((g) => groupKey(g.project, g.specFolder)),
  );
  const uncounted = (f.q ?? "").trim()
    ? 0
    : (opts.archived ?? []).filter((k) => !built.has(k)).length;
  const states = chips(
    "state",
    "Show",
    STATE_FILTERS.map((s) => ({
      key: s.key,
      label: s.label,
      count:
        counted.filter((g) => matchesState(s, g.state)).length +
        (matchesState(s, ARCHIVED_STATE) ? uncounted : 0),
      on: s.key === current,
      // The DEFAULT entry is the one that travels as no value at all —
      // by position, so moving a chip to the front moves this with it.
      patch: { state: s.key === DEFAULT_STATE_FILTER.key ? "" : s.key },
    })),
  );

  // A chip per project stood here until 2026-08-23. It was one control
  // that grew with the machine: fine at two projects, unreadable at
  // twenty, and the dashboard now serves whatever a person has. Nothing
  // replaced it, deliberately — nobody had asked to filter by project,
  // and the list is short enough to read. Build something when the need
  // is real, and a dropdown is the shape that does not grow.
  return `<div class="row">${states}${runsHelp()}${newSpecLink(opts)}</div>` + searchForm(f);
}

/** The search field (spec 221). It came off `/archive`, which had the
 *  only search on this dashboard, and it reads the same three fields
 *  there as here.
 *
 *  Links, not script, like every other control on this page: a plain GET
 *  form, so it works with JavaScript switched off, survives a reload and
 *  can be pasted to someone else. A GET form REPLACES the query string,
 *  so everything else in the view travels as hidden fields — without
 *  them, searching would silently throw away the chip and the column the
 *  reader had just chosen. */
function searchForm(f: QueueFilter): string {
  const keep = FILTER_KEYS.filter((k) => k !== "q")
    .map((k) => (f[k] ? `<input type="hidden" name="${k}" value="${esc(f[k]!)}">` : ""))
    .join("");
  const q = (f.q ?? "").trim();
  return (
    `<form class="specsearch" method="get" action="/">` +
    // No caption over the field: the button beside it says Search, and
    // the same word twice made the field taller than the button it
    // stands next to (2026-08-23).
    //
    // The clear control (spec 226) sits inside the field, so getting
    // back to the whole list is one press rather than select-all and
    // delete. A LINK, like the fold and the sort: `q` is dropped and
    // every other filter travels on, so it works with script off,
    // survives a reload and can be pasted — and `data-nav` lets
    // `queue-client.ts` swap the rows in place instead of reloading.
    // Drawn only when there is something to clear; an × over an empty
    // field is a control that does nothing.
    `<span class="searchfield">` +
    `<span class="icon-search" aria-hidden="true">${ICON_SEARCH}</span>` +
    `<input class="archive-q" type="search" name="q" value="${esc(q)}" ` +
    `placeholder="a word in any of three fields" aria-label="Search the specs">` +
    (q
      ? `<a class="searchclear" data-nav href="${queueHref(f, { q: "" })}" ` +
        `title="Clear the search" aria-label="Clear the search">&times;</a>`
      : "") +
    `</span>` +
    keep +
    `<button class="btn" type="submit">Search</button>` +
    `</form>\n` +
    // Said out loud, because the one thing a reader cannot see about a
    // filter is what it looked in.
    `<p class="muted small listnote">Searches the ${SEARCHED.join(", the ")} — the whole ` +
    `description, including the part the row does not show.</p>\n`
  );
}

function sortableHead(f: QueueFilter): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  // `labelHtml` for the one column whose heading is a consumption label
  // and not a noun: "Cost" is the wrong word above a column of token
  // counts, so it carries the same two spans its cells do (spec 118).
  // `attrs` is the fold hook (spec 155): the two columns a phone drops
  // are named on the cell rather than counted by position, because the
  // column ORDER has already changed once (see below) and an
  // `nth-child` rule would have broken silently when it did.
  const th = (key: string, label: string, cls = "", labelHtml?: string, attrs = "") => {
    const on = key === sort;
    // Clicking the column you are already sorted by turns it round.
    const next = on ? (dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
    // Every sortable column carries the chevron — faint until hovered,
    // so the reader can see the column CAN be sorted; full on the sorted
    // one, and ascending turns it by a class rather than swapping a
    // glyph, same as the fold control. Which way an unsorted column
    // will go on the first click is what its chevron points.
    const mark = ICON_CHEVRON;
    const linkCls = on
      ? (dir === "asc" ? "sortlink on asc" : "sortlink on")
      : (SORT_DEFAULT_DIR[key] === "asc" ? "sortlink asc" : "sortlink");
    const aria = on ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
    return (
      `<th class="${cls}"${attrs}${aria}>` +
      `<a class="${linkCls}" data-nav href="${queueHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next })}">` +
      `${labelHtml ?? esc(label)}${mark}</a></th>`
    );
  };
  return (
    // "Progress", not "Step": the column stopped holding a step name the
    // moment the list became one line per spec. It holds the whole
    // workflow as pips on a header line, and how many attempts a phase
    // took on the lines beneath.
    // There were FIVE headings until 2026-08-23, the last one blank:
    // it headed a cell that held a shut row's one action until spec
    // 157 moved that beside the state, and every row had drawn an
    // empty `<td>` under it since. Dropping it from the header and
    // from both row types together is what keeps the columns lined up
    // — a row short of a cell the header still declares is what shifts
    // them. (Spec 124 put that column first, for a button COLUMN that
    // pushed the whole table sideways — 2026-08-19.)
    // "Spec" spans TWO columns since spec 165, which gave the row's AI
    // select a column of its own between the phase name and the model.
    // Spanning rather than a blank heading beside it: this row has
    // nothing to put in that column, and a column of its own here
    // would take its width from the spec NAME — leaving the phase
    // names, which are short, floating in a cell as wide as a folder
    // name. Spanning lets the phase names size their own column.
    `<thead><tr>${th("spec", "Spec", "", undefined, ' colspan="2"')}${th("state", "State")}` +
    `${th("started", "Time", "", undefined, ' data-col="started"')}` +
    `${th("cost", "Cost", "num", '<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>', ' data-col="cost"')}` +
    `</tr></thead>`
  );
}

// Stopping a run is the one thing this form does. It offered Approve
// beside it until spec 149, for a job parked between two steps — there
// is no stop between steps any more, so there is nothing to release and
// nothing to approve.
//
// It says "Cancel" and nothing else. It named the step it would stop
// until 2026-08-21 — "Cancel implement" — on the argument that it
// should read like the Run button beside it; but a row has only ever
// one thing to cancel, the State column beside it already says which
// step is running, and the name added a word without adding an answer.
//
// Drawn only when there IS something to cancel. It used to be in the
// markup whatever the state, greyed out, so the width of the action
// column could not change from row to row (spec 124); that column is
// gone, and a row draws exactly one control now — an inert Cancel
// beside a live Run is the "two controls" this spec removes.
//
// `actionform` is what the page's own code selects on, and
// `data-pending` is what the button says while the request is out —
// written here, beside the label it replaces, rather than as a verb
// table in the script.
function actionForm(r: QueueRowView, token: string | undefined, filter: QueueFilter | undefined): string {
  const hidden = tokenField(token) + filterFields(filter);
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/cancel" class="actionform">${hidden}` +
    // Primary, like every row's one action (spec 161): `danger` was
    // supposed to set it apart, but in dark mode `--danger` and
    // `--accent` sit close enough in hue that an outlined Cancel and a
    // filled button beside it said nothing different to the eye. And a
    // cancelled run can be started again, so it was never what `danger`
    // is for.
    btn({ label: "Cancel", pending: "cancelling…", variant: "primary" }) +
    `</form>`
  );
}

// Merging was a button here until spec 149, with a long comment about
// what it said and where it said it. It says nothing now, because it is
// not pressed: every step lands the work it produced, `implement` alone
// leaves its branch open on purpose, and `archive` is what lands that.
// `mergeForm`, `mergeReadyLabel` and `isCodeRepo` went with it —
// `isCodeRepo` existed only so the button's own sentence could say
// whether it would land the plan or the code.

// Every repo the spec pushed to, each with its own compare link and its
// own merge state. Never one link standing in for two: the two branches
// share a NAME and nothing else.
function branchList(branches: BranchView[]): string {
  if (branches.length === 0) return "";
  // A lead-in, because bare repo names read as words that fell out of
  // something else (asked for 2026-08-19).
  return (
    `<span class="branchlist"><span class="lbl">Repos:</span>` +
    branches
      .map(
        (b) =>
          `<span class="branch"><a class="small" href="${esc(b.url)}" ` +
          `title="compare the branch in ${esc(b.label)}">${esc(b.label)}</a>` +
          // Beside the compare link, never instead of it: one says where
          // the work is, the other where it can be tried.
          (b.previewUrl
            ? ` <a class="small" href="${esc(b.previewUrl)}" ` +
              `title="open this branch's own build">preview</a>`
            : "") +
          `</span>`,
      )
      .join("") +
    `</span>`
  );
}

// The two cells the header line and the phase lines fill the same way.
// A spec's state and a phase's state are the same question asked at two
// altitudes, and they must never be worded differently.
// Spec 143: the job's own error is NOT written here any more. It is a
// sentence a runner wrote — "the specs tree is dirty: /Users/…" — and
// this cell is sized for a badge, so it went off the right edge of the
// table. The row's panel says it instead (`specNoticeRow`).
const stateCell = (r: QueueRowView, resting: RestingState = {}): string =>
  specStateChip(r, resting);
// The same two-part shape, for a PHASE — whose state is the file's
// answer (`wordPhase`), not the last job's. No badge at all means the
// phase has neither happened nor been attempted. The attempt's own
// error text is NOT repeated here since spec 143: the row's panel says
// it once for the whole row, and the phase's own detail page — which
// this line links to — carries it in Activity, where that phase
// already reports what it did.
const phaseWordCell = (
  w: PhaseWord,
  /** Marks that belong to the phase's STATE but used to be written on
   *  its name cell, beside the model picker: the stale-description
   *  badge and the attempt count. Out there they had no width of their
   *  own, so two lines of free text stretched the name column and took
   *  the whole table sideways with it (seen 2026-08-20). Whether the
   *  State cell is their long-term home is still open; not stretching
   *  the table is not.
   *
   *  BESIDE the badge, not under it (spec 176). A `<div>` of its own
   *  made a phase line carrying a note taller than one without, so
   *  everything down the row moved the moment a second attempt
   *  started — and the page's own rule is that nothing moves because
   *  something else changed. The mark brings its own `<span>`, so it
   *  needs no wrapper of ours. */
  aside = "",
): string =>
  // `w.qualifier` is NOT drawn here, and there is nowhere in this cell
  // it could be (spec 195). It is a sentence, and spec 176's "beside
  // the badge" trick is only open to marks a word wide: a badge is
  // `nowrap`, so a sentence beside one runs off the right edge of the
  // table. Under the badge it made this line taller than the phase
  // lines around it — the last place on the page where something moved
  // because something else changed, reported four times. The row's
  // panel says it instead (`phaseDisagreement`/`specNoticeRow`), once
  // for the whole spec and named for the phase it is about, so a phase
  // line is one line in every state a phase can be in.
  (w.badge ? badge(w.badge.variant, w.badge.label) : `<span class="muted small">not run yet</span>`) +
  (aside ? ` ${aside}` : "");

/** The spec header row's own time cell: when the spec was made, and
 *  what its phases came to once they are all behind it (spec 199).
 *
 *  The total rides BESIDE the date, in the cell that is already there.
 *  A column of its own would take its width from a heading, and this
 *  table has no width to give — the same constraint that put the
 *  attempt count beside a badge rather than under it. */
function startedCell(g: SpecGroup, now: number): string {
  // A dash means git was asked and could not date the folder. Nobody
  // having asked yet is a different cell (spec 208).
  return g.createdAt ? relTime(g.createdAt, now) : g.freshnessUnknown ? CHECKING : "–";
}

/** One phase line's time cell: how long that phase took, or how long it
 *  has been going (spec 199).
 *
 *  A running one carries `data-elapsed` — the instant to count up from
 *  — and the page's own clock rewrites the text once a second from
 *  there. The server still writes a figure into it, so the cell says
 *  something with script switched off; and the mark is a `<span>` of
 *  fixed content in a cell that is already there, so a phase starting
 *  or stopping moves nothing on the page around it. */
function phaseDurationCell(latest: QueueRowView | undefined, step: string, now: number): string {
  const d = latest ? phaseDuration(latest, step, now) : null;
  if (!d) return "";
  const text = durationLabel(d.ms);
  return d.live
    ? `<span class="muted small" data-elapsed="${esc(d.since)}">${text}</span>`
    : `<span class="muted small">${text}</span>`;
}

// `blank` because a header with nothing spent still owes the reader a
// dash, while an empty phase line should simply be empty. That
// distinction is the whole reason this takes a parameter the shared
// formatter does not — everything else about the cell is `usdOrTokens`,
// which is where the dollar/token pair is decided for the whole site.
// `unmeasured` marks a figure that includes a stand-in: a stopped step
// is charged its whole budget because a SIGKILLed run prints no usage,
// and a total that says nothing about it reads as money spent (spec
// 152). The same "est." the job page's Steps table has shown per step
// since spec 118.
const costCell = (
  spentUsd: number,
  spentTokens: number | undefined,
  blank: string,
  unmeasured?: boolean,
): string =>
  spentUsd > 0
    ? usdOrTokens(spentUsd, spentTokens) + (unmeasured ? ' <span class="muted small">est.</span>' : "")
    : blank;

/** Whether a job is in flight on this spec — queued, running, or parked
 *  at a gate. ONE rule for the whole row, read off the SPEC and not off
 *  the steps some job happens to name: the queue refuses a second job
 *  on a spec that already has one (`clashing()`, queue.ts), so every
 *  control the row draws beside Cancel would be promising a press the
 *  server was going to turn down. `actionForm` already narrows itself
 *  to Cancel (or Approve + Cancel); everything else on the row reads
 *  THIS, so a control added later has one question to ask rather than a
 *  rule to remember. */
const specBusy = (g: SpecGroup): boolean => !!g.lead && inFlight(g.lead);

/** Why the row will not take a click, in the words the badge uses. One
 *  sentence for the whole row: about the JOB, so every locked control
 *  says the same thing rather than each wording it freshly. */
export const busyReason = (g: SpecGroup): string =>
  g.lead ? `${stepLabel(currentStep(g.lead))} is ${g.lead.landing ? "landing" : stateLabel(g.lead)}` : "";

// THE phase a spec is still waiting on — one fact, read by both halves
// of the State column, so the badge and the button beside it cannot
// name different phases (spec 191). They used to work it out apart:
// this rule lived in `preTicked` below for the button's sake, and
// `specHeadRow` asked `g.done` raw for the badge's. A spec whose
// history listed every step therefore got "done — nothing waiting on
// you" beside a button reading "Archive", and the button was right.
//
// ARCHIVE IS NEVER DONE ON A ROW THAT EXISTS. Archived-ness is a
// directory (`discover.ts`): a spec the list shows is a spec still in
// the active root, so whatever the git history says about an archive
// step having RUN, it did not finish the one thing archiving is.
//
// The history is the record of steps that ran (spec 154), and an
// archive that ran and declined to move the folder leaves a commit
// behind exactly like one that moved it. Counted as done it left spec
// 159 with every phase ticked, no next phase to suggest and no button
// at all — beside a badge reading "archive held back", which was the
// one thing on that row needing a press. The first fix read the
// held-back note and dropped that phase; too narrow, and spec 161
// showed why hours later — with the note cleared the row went to
// "done — nothing waiting on you" while the spec sat unarchived in
// the list. The note is a REASON archiving did not happen, not the
// only evidence that it did not (2026-08-21).
//
// So this never comes back empty for a spec on this page: `archive` is
// a member of `QUEUE_STEPS` and is deleted before the search, and
// archive is the floor every row still has ahead of it. Not exported,
// and deliberately: a caller outside this page — a summary of specs
// that really ARE archived, say — needs archive counted as done, and
// would be wrong to read this. Anything wanting to export it has to
// come back through this paragraph first.
function nextPhase(done: readonly string[]): string | undefined {
  const remaining = new Set(done);
  remaining.delete("archive");
  return QUEUE_STEPS.find((s) => !remaining.has(s));
}

// What a press would run, if nothing else is ticked: EVERY phase the
// spec has not had (spec 200). A press takes the spec as far as it can
// go, and unticking a box is how a reader says to stop somewhere. It
// depends on how far the spec has got, and on nothing about which
// phase is asking.
//
// `done` is what the spec's own git history PROVES (spec 154): the
// runner commits every step it finishes, and only such a commit puts a
// step here — a `4-status.md` line naming a step is a claim the row
// reports a disagreement about, never a source. A step run at
// somebody's keyboard counts once it is committed with the same
// subject, which is what the skills now offer to do; declined, the
// spec reads as still having that phase ahead of it.
//
// `archive` is deleted from that set for the same reason `nextPhase`
// deletes it: a spec on this list is by definition not archived,
// however its history reads. That is also what keeps the result from
// ever being empty, so the row always has a button — the bug spec
// 159/161 each patched with a fallback of its own, structurally gone
// rather than guarded against a third time. Two branches went with
// those fallbacks: whether the spec has ever had a job at all
// (`g.lead`) made no difference to the answer once every remaining
// phase is ticked, so it is not asked any more.
//
// The first member of this set is `nextPhase(g.done)` — both walk
// `QUEUE_STEPS` in order with the same archive rule — which is what
// keeps the button and the badge naming the same phase (spec 191).
//
// It used to live inside the strip of chips the controls line drew
// (`stepBoxes`, retired with that line in spec 124). The boxes are on
// the phase lines now and each asks this the same question, so the
// rule is read once per row and consulted per phase.
function preTicked(g: SpecGroup): Set<string> {
  const remaining = new Set(g.done);
  remaining.delete("archive");
  return new Set(QUEUE_STEPS.filter((s) => !remaining.has(s)));
}

// What the row's one button SAYS, built from the same set the boxes are
// ticked from (spec 157). Two things follow from naming it after the
// ticked phases rather than after the state's own suggestion:
//
// A reader can see the two disagree before pressing. The State column
// says what the spec's files make of it — "ready for analyze" — and the
// button says what a press would actually run. Where those differ the
// row reads "ready for analyze · Implement", and the disagreement is in
// the line rather than in the result.
//
// And a press on a SHUT row is legible: its phase boxes are not drawn,
// so the button's own word is the only thing that says what it would
// do.
//
// `preTicked()` ticks every phase the spec has left since spec 200, so
// the button names the first of them and not the whole of what a press
// does — deliberately, and the boxes right there on the row say the
// rest. Nothing ticked names nothing: no button is drawn at all,
// because a disabled one invites a press that cannot do anything.
function actionLabel(g: SpecGroup): string | undefined {
  const ticked = [...preTicked(g)];
  if (ticked.length === 0) return undefined;
  // The FIRST ticked phase, and nothing after it. A "+ 1" suffix said
  // how many more a press would run and was taken out on 2026-08-21:
  // a button label is a name, not a summary, and the phases themselves
  // are one click away on the row the press acts on.
  const first = stepLabel(ticked[0]!);
  return `${first[0]!.toUpperCase()}${first.slice(1)}`;
}

// The run form's own id. It exists for the rarely-set fields' sake
// alone: they are written after the form's closing tag, on the same
// line, and `form="<id>"` is what makes the browser post them with it
// anyway.
export const runFormId = (g: SpecGroup): string => `rowrun-${groupKey(g.project, g.specFolder)}`;

// Why the button you just pressed did nothing, and whether it was
// pressed on THIS row. The same key the fold state is written in, so
// no second format for "which spec" is invented.
//
// It is drawn in the row's panel and no longer in the name cell (spec
// 151): the sentence is a whole one — "analyze on 150-… is already
// running (job 03238f57) — cancel that one first if you want to start
// over" — and the name cell is sized for a folder name, so it pushed
// the branch marks and the title around underneath it.
const refusalFor = (g: SpecGroup, opts: QueuePageOptions): string | undefined =>
  opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

// The one thing the row asks of the reader, beside the sentence that
// says why (spec 157). Run or Cancel — never both, and nothing at all
// when there is nothing to run: the two are never the right press at the
// same time, so a second one in the markup could only ever be a
// greyed-out invitation. There was a third, Resolve, until spec 171
// folded resolving into `archive`.
//
// It sits in the State column now, after the badge, because the badge
// already answers what is happening or what can happen next (spec 132)
// and the button completes that sentence: "archive held back ·
// Implement", "implementing · Cancel". It used to be a stack
// of buttons in a cell of its own — a COLUMN at the front of the table
// in spec 124, which pushed every other column sideways, then the spec
// column's own cell spanning the phase lines (2026-08-19). Both were
// answers to "where do a row's buttons go" while there were still
// several of them.
//
// The same function draws it open or shut. A collapsed row used to have
// a narrower path of its own; what the two differ in now is one branch,
// not two call sites.
//
// The Run form is a carrier and nothing else: it holds the hidden
// fields, and the button that submits it and the boxes that fill it are
// written outside its tags, reaching it by `form="…"` — the trick spec
// 123 introduced for the model select.
function stateAction(g: SpecGroup, opts: QueuePageOptions, open: boolean): string {
  // The third branch, and the first thing asked (spec 224). An archived
  // spec has ONE action — `reopen` is the only step `ARCHIVE_ONLY_STEP`
  // lets past — so there is no Run form to carry and no phase to name:
  // the branches below would name one, because `preTicked` answers
  // "what would run next" for a spec whose workflow is over by ticking
  // `archive` alone.
  if (isArchivedRow(g)) return reopenForm(g, opts);
  const busy = specBusy(g);
  // A conflict used to draw a Resolve control of its own here, off the
  // job's stored `errorReason`. Spec 171 took it away: `archive`
  // resolves a conflict with the default branch itself, so a conflict
  // that survives to this row is one no machine could settle and there
  // is no press that would settle it either. It shows as the failure's
  // own text — which names the branch — and the row offers what every
  // other failed step's row offers, an ordinary re-run.
  //
  // What a press would run, and therefore what the button says. There
  // is none while a job is in flight: Cancel is the row's control then.
  const label = busy ? undefined : actionLabel(g);
  // The form is a CARRIER: hidden fields only, hidden by CSS, with the
  // button and the phase boxes written outside its tags and reaching
  // it by `form="…"`. So it is drawn wherever something names it — an
  // open row's boxes and model selects always do, and a shut row's
  // button does when there is one. Without it on a busy open row, the
  // page's own script would lose the thread from a press back to the
  // boxes it has to lock with it (`rowControls`, spec 151).
  const runForm =
    open || label
      ? `<form id="${esc(runFormId(g))}" method="post" action="/api/queue" class="rowrun">` +
        `${tokenField(opts.token)}${filterFields(opts.filter)}` +
        `<input type="hidden" name="project" value="${esc(g.project)}">` +
        `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
        // A SHUT row draws no phase boxes, so the phases a press would
        // run have nothing to be read off at submit time: they travel
        // as hidden fields instead. An open row must NOT have them — its
        // boxes are the reader's own, and a hidden field beside them
        // would outvote a phase just unticked.
        (open || !label
          ? ""
          : [...preTicked(g)].map((s) => `<input type="hidden" name="steps" value="${esc(s)}">`).join("")) +
        `</form>`
      : "";
  const primary = (() => {
    if (busy) return actionForm(g.lead!, opts.token, opts.filter);
    if (!label) return "";
    // Primary, like every row's one action (spec 161). It was
    // secondary until then, on the argument that a column of primary
    // buttons says nothing about which row to look at — but a row
    // draws exactly one control now, so there is no column to tell
    // apart and nothing left for the colour to say except that the
    // action is here.
    //
    // Built by hand rather than through `btn()`: it needs `form="…"`,
    // an attribute that helper's signature does not carry — the same
    // reason `modelPicker` builds its own `<select>`.
    return `<button type="submit" form="${esc(runFormId(g))}" class="btn primary" data-pending="starting…">${esc(label)}</button>`;
  })();
  // "Also touches" stood here until nobody could point at a press it
  // had ever served: 0 of the queue's 200 jobs named an extra repo, and
  // it drew one tick box per OTHER project on every open row — so
  // adding a project widened it and took the layout with it. The field
  // and the runner's flag went with the box: a run reaches its project
  // and its specs root, and a spec that must change two projects at
  // once needs the naming built back, deliberately.
  return runForm + primary;
}

// The one control on this page that is NOT about a spec that exists:
// every other way in is a form on a spec's own row, and a spec that has
// never been written has no row to put one on.
//
// A link, not a form and not a disclosure (spec 121): the form has a
// page of its own at `NEW_SPEC_ROUTE`, with a Create and a Cancel on
// it. It sits at the right-hand end of the filter chips' own row,
// beside the "?" — inside `#jobrows`, since spec 221 moved the filter
// bar in there — and keeps the primary-button look spec 113 gave it.
// It stood in a band of its own above the table before that.
// Not offered at all when no project on this machine may have a spec
// made in it, exactly as the panel was not.
function newSpecLink(opts: QueuePageOptions): string {
  if ((opts.createProjects ?? []).length === 0) return "";
  return `<a class="btn primary" href="${NEW_SPEC_ROUTE}">New spec</a>`;
}

// One line about the spec: what NOTHING ELSE on the row says. It used
// to fall back to "no status recorded yet" rather than go blank, on the
// grounds that a line blank on half the rows reads as a page that failed
// to load; spec 176 overturned that outright. No phase status belongs in
// this column at all — the markers and the State column are where a
// spec's progress is said — and a line with nothing to say says nothing.
function specSummary(g: SpecGroup): string {
  const bits: string[] = [];
  // NOT the title, and NOT the phase (2026-08-21), and NOT the
  // percentage (spec 167). The folder name above IS the title in slug
  // form and said it twice; the phase is what the pips and the State
  // column are for. The percentage counted the checkbox rows the
  // implement step ticks, and implement is ONE step — so it read 0
  // until implement finished and 90-something after, never anything
  // between. Two specs on the same day both read "0% done", one with
  // 21 task rows behind it and one with 4. What is left is what
  // neither the pips nor the badge carries.
  //
  // ONE exception, and it is the reason `named` exists: a create job's
  // spec has no folder yet, so the name above is a provisional key that
  // says nothing to anyone. There the title is the only readable thing
  // the row has, and it stays until the spec lands.
  if (!g.named && g.title) bits.push(esc(g.title));
  // Spec 208. Whatever git knows about this spec is not in yet — the
  // schedule that fills the caches has not reached it. Said out loud
  // rather than drawn as "nothing has run": that false negative is the
  // whole reason the peeks carry a `checkedAt` at all.
  if (g.freshnessUnknown) bits.push(CHECKING);
  // By NUMBER since 2026-08-21, not by folder. This line used to match
  // `aide-run-spec`'s dependency refusal word for word, which names the
  // whole folder; the number is what a reader recognises, it is
  // unambiguous because a number is never reused, and the folder name
  // made the line longer than the row it sits in.
  if (g.dependsOn.length) bits.push(`depends on: ${g.dependsOn.map((d) => esc(specNumber(d))).join(", ")}`);
  return bits.join(" · ");
}

/** The leading number of a spec folder — `92-a-spec-can-depend` is 92.
 *  A value that does not open with one is shown whole: a dependency may
 *  be written as a bare number already, and anything else is better
 *  said in full than silently truncated. */
function specNumber(folder: string): string {
  return /^\d+(?=-|$)/.exec(folder)?.[0] ?? folder;
}

/** One pip per phase: green for a phase that has run, blue for the one
 *  running now, grey for a phase still ahead. The whole workflow in six
 *  millimetres, on the line you are already reading — shared by the
 *  list's own row and the spec page's Overview tab (spec 239), so the
 *  two can never show a different chain for the same spec.
 *
 *  `create` had no pip from spec 116 until spec 167: the glance was
 *  about the four phases a reader can still RUN. The hole made create
 *  read as a different kind of thing rather than as the phase already
 *  behind you — the same reason the phase line got a box of its own on
 *  2026-08-21 — so it is a pip like the other four now.
 *
 *  It does not go through `wordPhase` with them, though: create has
 *  only two states, past and running. A spec that exists was created,
 *  so the pip is past unless a create job is in flight right now.
 *  `done` used to be the reason — it comes from the git history, which
 *  counts only the runner's own `Run /aide-<step> for <folder>` commits,
 *  and a spec written by hand has no create commit, so every one of
 *  those showed a grey pip saying the spec had not been made yet. Spec
 *  176 closed that gap one layer down (`withFreshness` puts create into
 *  the set for any spec whose folder is on disk), so the phase LINE
 *  agrees now; the two states above are what is left. */
export function phasePips(phases: Phase[], done: string[]): string {
  const createRunning = phases.find((p) => p.step === "create")?.attempts.some(inFlight);
  return pips(
    phases.map((p) => {
      // One rule, one function: what the FILES say, qualified by the
      // most relevant attempt (whatever is in flight, else the latest).
      // The pips used to read the job history alone, so a spec analysed
      // by hand showed four grey pips and a cancelled re-run turned a
      // finished phase grey again.
      const attempt = p.attempts.find(inFlight) ?? p.attempts[0];
      return {
        kind:
          p.step === "create"
            ? createRunning
              ? "now"
              : "past"
            : wordPhase(done.includes(p.step), p.heldBack, attempt, p.history).pip,
        title: stepLabel(p.step),
        // How much of a running implement is behind it (spec 210). The
        // fallback above is the latest attempt whatever became of it,
        // so the "only while it runs" half of the rule is what keeps a
        // stale phase from filling a pip for work that has stopped —
        // and that half lives in `completedThirds`, once.
        third: completedThirds(attempt),
      };
    }),
  );
}

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and — beside the state that says why — the one
// thing that can be done about it (`stateAction`, spec 157). Which
// phases a press would run is said on the phase lines beneath
// (`phaseSubRows`), one box per line, and on the button's own label.
function specHeadRow(
  g: SpecGroup,
  opts: QueuePageOptions,
  now: number,
  opened: Set<string>,
): string {
  // Whether this row is a RECORD rather than a control (spec 224). It
  // is asked once here and consulted wherever the row would otherwise
  // read live-only state, exactly as `busy` already is — the difference
  // being that `busy` says "not right now" and this says "not ever
  // again, without a Reopen first".
  const locked = isArchivedRow(g);
  // Four answers, not three — and named `run-*` rather than
  // `active`/`archived`, which `site.ts` uses for the unrelated
  // question of whether a spec folder has been archived on disk. The
  // two used to share the words and mean different things.
  const rowClass = locked
    ? "run-archived"
    : !g.lead
      ? "run-new"
      : inFlight(g.lead)
        ? "run-live"
        : "run-past";
  // The spec name is the way IN, and since spec 150 it opens the SPEC —
  // all four of its files as they stand — rather than whichever job
  // happened to run last. Which means EVERY spec has somewhere to point:
  // the old branch here said "a spec that has never run has no job page
  // to point at, so the name is text", and that is the sentence the spec
  // page invalidates. The phase lines below still link to jobs, because
  // a phase's page is that phase's own run.
  // The diff link sits beside it rather than replacing it — nothing a
  // reader uses today disappears.
  // `.label` so the name clamps to two lines with an ellipsis
  // (src/render/css.ts `.spec-name > .label`, reworked 2026-08-26): a
  // one-line clamp hid most of a long folder name behind a click.
  // `<project>:<folder>` since 2026-08-21. The project used to open the
  // line under the name, beside the title; it belongs to the NAME — a
  // folder number is only unique within its project — and the line
  // under it now carries what nothing else says.
  // `data-goto` (spec 208): a real navigation to a different document,
  // which no script can swap in — so the click is MARKED and the
  // browser is left to get on with it. Without it the reader saw the
  // old page, unchanged, for however long `specPageView` took, and a
  // click that changes nothing reads as a click that did not register.
  const spec =
    `<a class="label" data-goto href="${esc(specPagePath(g.project, g.specFolder))}" ` +
    `title="${esc(g.project)}:${esc(g.specFolder)}">` +
    `<span class="muted">${esc(g.project)}:</span>${esc(g.specFolder)}</a>`;
  // Spec 193's mark, on the row it belongs to (spec 224 moved it here
  // from the flat reader row `archivedHeadRow` drew). Beside the link a
  // reader would follow, because the mark is a reason to follow it: the
  // spec needs its `archive` run again. It reads `g.archive`, which only
  // a locked row has, so no other row draws one.
  //
  // Spec 220 first: the two marks come from ONE fact — the branch is
  // still on origin — and a project that reviews its code means that
  // fact to be true. Reading `notLanded` first would call every working
  // PR-mode archive stuck.
  const archiveMark = !g.archive
    ? ""
    : g.archive.prOpen
      ? ` ${prOpenMark(g.archive)}`
      : g.archive.notLanded
        ? ` ${badge("refused", NOT_LANDED, notLandedTitle(g.archive.notLandedCheckedAt, now))}`
        : "";
  // The mark beside each link is about the BRANCH alone (spec 174):
  // whether it landed, and what lands it. What the row's lead job is
  // doing is the State column's answer, said there once.
  const diff = g.branches.length ? ` ${branchList(g.branches)}` : "";
  // Spec 220: where the review is. Beside the branch list because it is
  // about the same branch — the code is on it and stays on it until
  // somebody merges the request. A `gh` that opened none says so
  // instead, and says it as a refusal: an open branch with nothing
  // describing it is the one outcome nobody is waiting for.
  const review = g.prUrl
    ? ` <a class="small" href="${esc(g.prUrl)}" title="the pull request this spec's code is waiting on">pull request</a>`
    : g.prError
      ? ` ${badge("refused", "no pull request", g.prError)}`
      : "";
  // The whole workflow in six millimetres, on the line you are already
  // reading — shared with the spec page's Overview tab since spec 239.
  const progress = phasePips(g.phases, g.done);
  // The earliest phase the spec's own files say has not happened — the
  // same one `preTicked` ticks a box for, from the same function, so
  // the badge and the button cannot name different phases (spec 191).
  // Worded for a reader here through `stepLabel`, so a phase added to
  // `STEP_LABELS` later reaches this sentence too.
  // NOT on a locked row (spec 224). `nextPhase` deletes `archive` from
  // the done-set before it looks for what is missing — right for a spec
  // still on the active list, and wrong for one whose folder has already
  // moved: it resolves to "archive" for every archived spec there is,
  // and `restingChip` would draw "ready" beside a spec that is finished.
  const nextStep = locked ? undefined : nextPhase(g.done);
  const readyPhase = nextStep ? stepLabel(nextStep) : undefined;
  // The other thing the State column is built from: the archive that
  // declined to move.
  const heldBack = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  // What the State column says for a locked row, drawn directly rather
  // than through `stateCell`/`restingChip`: those two answer "what is
  // happening, and what can happen next", and for this row the answer to
  // both is that it is over. The two archived states are told apart by
  // the MARK beside the name, not here — the word in this cell is the
  // same either way, which is what `ARCHIVED_STATE`'s own note says.
  const stateBadge = locked
    ? badge("done", ARCHIVED_STATE)
    : g.lead
      ? stateCell(g.lead, { archiveHeldBack: heldBack, readyPhase })
      // A spec with no job in the queue's memory reads the same way
      // (spec 176). It used to say "not started", which describes
      // the same kind of situation — nothing running, and here is
      // what could — while saying nothing useful, and could
      // contradict the button beside it: a spec whose analyze ran
      // long enough ago that its job record has aged out still has
      // its commits, so `readyPhase` is "implement" and the badge
      // read "not started".
      : restingChip({ archiveHeldBack: heldBack, readyPhase });
  // What goes under the name. A locked row draws nothing here (spec
  // 257) — `specSummary` has no path for it at all: it draws a title
  // for an unnamed create job and the dependency list, and an archived
  // row is `named` with nothing left to depend on. The description
  // stays searchable (`g.description`, read by `matchesSearch`); only
  // showing it under the title goes.
  const under = locked ? "" : `<div class="spec-title">${specSummary(g)}</div>`;
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    `<tr class="spechead ${rowClass}" id="${esc(rowAnchorId(g))}" data-folder="${esc(g.specFolder)}">` +
    // Two columns wide, like its heading: the second is the AI
    // column the phase lines below open up (spec 165), and this row
    // has nothing to say in it.
    // The pips ride with the name, on the same line and after it: the
    // column they had was empty on every phase line under this one, a
    // hand's width of nothing all the way down the table, and they are
    // narrow enough to sit beside a name that is already clamped
    // (2026-08-22). A "N runs" count under them said less than they do
    // and went in spec 165.
    `<td colspan="2"><div class="spec-name">${foldControl(g, opts.filter ?? {}, opened)} ${spec}` +
    archiveMark +
    `<span class="pipslot">${progress}</span></div>` +
    under +
    // The repo marks on a line of their own: beside the name they took
    // the width the name needed, and clamping it to "124-…" told the
    // reader nothing (2026-08-19).
    diff +
    review +
    `</td>` +
    // The badge says what is happening, or — once nothing is — the
    // resting state and what can happen next (spec 132). A sentence
    // under it said what to press until spec 174: the button beside it
    // names the phase it would run, so the line was telling a reader to
    // press the control they were looking at, to do what it already
    // said. The pips, the badge and the branch marks each answer a
    // narrower question of their own.
    //
    // The row's one button stands beside the badge since spec 157,
    // completing the sentence it starts: "archive held back ·
    // Implement". They share the page's own `row` container, so the
    // gap between them is declared once and the button drops to a line
    // of its own when the column runs out of width, rather than
    // widening the table (`.tablewrap` would scroll instead).
    // `.badgeslot` mirrors `.actionslot`: an invisible holder that can
    // reserve a width (mobile does) without stretching the pill inside
    // it — a min-width on the badge itself widened the coloured pill
    // (2026-08-24).
    `<td><span class="row"><span class="badgeslot">${stateBadge}` +
    `</span><span class="actionslot">${stateAction(
      g,
      opts,
      opened.has(groupKey(g.project, g.specFolder)),
    )}</span></span>` +
    `</td>` +
    // When the spec was MADE, and — once nothing is left to run — how
    // long its phases took (spec 199). The column used to hold the most
    // recent job's own start, so every run threw the row to the top of
    // a list sorted by it. A dash where git could not date the folder:
    // deliberately not a job's time, which is the movement this change
    // removes.
    (locked
      ? `<td class="archive-date" data-col="started">${archiveDateCell(g.archive!)}</td>`
      : `<td data-col="started">${startedCell(g, now)}</td>`) +
    `<td class="num" data-col="cost">${costCell(g.spentUsd, g.spentTokens, "–", g.costUnmeasured)}</td>` +
    `</tr>`
  );
}

/** The same column, a different question (spec 224): a locked row's date
 *  is when it was ARCHIVED, and the figure beside it is what the whole
 *  spec cost. `startedCell` reads `g.createdAt`, which comes off a
 *  target — and an archived spec is no target, so that cell would be a
 *  bare dash on every row here.
 *
 *  "checking…" is a spec nobody has ASKED git about; `date unknown` is
 *  one git was asked about and could not date. Two different answers,
 *  and a cell saying the wrong one is a cell that lies about whether
 *  there is anything still to find out. */
function archiveDateCell(s: ArchivedSpecView): string {
  const date = esc(s.archivedAt ?? (s.dateChecking ? CHECKING : NO_DATE));
  // A spec archived before spec 207 recorded no duration at all, which
  // is the one case that draws the date alone — not the dash the
  // description uses or the words a missing date uses elsewhere.
  if (s.durationMs === undefined) return date;
  return (
    `<span class="archive-duration">${esc(durationLabel(s.durationMs))}</span>` +
    ` <span class="muted small">${date}</span>`
  );
}

// One line per phase, in the workflow's own order, whether or not it has
// happened. A phase nobody has run yet is the point of the fixed order:
// it says what is still ahead without anyone counting rows.
//
// The line is where a phase is TICKED since spec 124 — the box the
// header's strip of chips used to carry, on the phase's own line,
// beside the picker for the next run of it. What it does NOT carry is
// a Run button: one press runs whatever is ticked, from the row's one
// action beside the state.
//
// The box is built without `done`: the phase's own State column, the
// next cell along, already says "done", and a checkmark here said it a
// second time, in a second alphabet. It stays tickable — rerunning a
// finished phase is the same submission it always was.
//
// The leading cell is the phase's NAME, hard left and alone (spec
// 165). It was the action column's, reserved and never filled, until
// spec 157 moved the row's one button beside the state.
function phaseSubRows(g: SpecGroup, opts: QueuePageOptions, now: number): string {
  const busy = specBusy(g);
  // The row is a record, not a control (spec 224). Read once here, like
  // `busy` beside it, and consulted where a line would otherwise offer a
  // press the server refuses.
  const locked = isArchivedRow(g);
  // Row-level, all three: which phases a press would run and why the
  // row will not take a click. Row-level facts, so they are asked once
  // and consulted per phase — the same shape `busy` itself already had.
  // Which step is being worked was a fourth until spec 168, read by
  // nothing but the spinner that used to sit on that phase's box.
  const ticked = preTicked(g);
  const why = busy ? busyReason(g) : "";
  // Spec 160: the phases this run can still be given or relieved of.
  // The server worked it out from the job as it stands — the row does
  // not re-derive it, so a live box and the route that takes its tick
  // can never disagree about where the tail starts. Empty for every
  // job that is not running, which is what keeps the brief `queued`
  // window between two steps looking exactly as it does today.
  const editable = new Set(g.lead?.editableSteps ?? []);
  // Every sub-row's tag and its cells, kept apart because the tag
  // carries the step and the cells carry the line. There is no cell
  // spanning them any more: the row's one action moved beside the
  // state (spec 157), and the phase lines took the left edge it left
  // — which is where "left of the phases" always meant.
  const lines: { tag: string; cells: string }[] = [];
  // A caption heads a control. A locked row draws no AI and no model
  // select (spec 224), so "AI" and "Model" would stand over an empty
  // cell — the same reason `aiPicker` draws nothing below two tools.
  if (!locked && (opts.modelChoices ?? []).length) {
    lines.push({
      tag: `<tr class="subrow" data-caption="1">`,
      cells: phaseCaptionCells(opts),
    });
  }
  g.phases
    .forEach((p) => {
      const latest = p.attempts[0];
      const word = wordPhase(g.done.includes(p.step), p.heldBack, latest, p.history);
      // Spec 237: a phase line opens the tab that shows what the phase
      // MADE, on the spec page the reader is already on — the four
      // workflow steps each have one, and `PHASE_TAB` is where the
      // mapping lives.
      //
      // Such a link is live whether or not the phase has ever run: the
      // tab is the spec's, not the run's, and it exists either way.
      // That is the same reason spec 150 gave a never-run SPEC somewhere
      // to point. A step OUTSIDE the four has no tab that speaks for it
      // and keeps the old rule exactly: its own job page, or plain text
      // when nothing has run it.
      const tab = PHASE_TAB[p.step];
      const href =
        tab ? specTabPath(g.project, g.specFolder, tab)
        : latest ? `/specs/${latest.id}`
        : undefined;
      const nameLink = href
        ? `<a href="${esc(href)}">${esc(stepLabel(p.step))}</a>`
        : `<span class="muted">${esc(stepLabel(p.step))}</span>`;
      // On mobile the AI/model selects are folded behind this control by
      // default (design handoff, mobile-spec-row): reading the list to
      // check status should not carry setup controls on every line. The
      // checkbox is invisible outside the mobile media query, so desktop
      // is unaffected — `.phasefold` is a plain inline wrapper there.
      // Only `.aimodel`'s own visibility toggles on the checkbox
      // (2026-08-24): `.modelcell` itself stays display:block on every
      // subrow, open or shut, so the table's column layout never
      // depends on which rows happen to be open — that inconsistency
      // was the actual bug the first version of this control had.
      // Not on a locked row (spec 224): what this folds away is the
      // `.aimodel` pair, and a locked line draws neither — so the
      // chevron would be a control that hides nothing, and the one
      // thing that may take a click on such a row is Reopen.
      const name = locked
        ? nameLink
        : `<label class="phasefold">` +
          `<input type="checkbox" class="foldphase">` +
          `<span class="foldchevron">${ICON_CHEVRON}</span>${nameLink}</label>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      // The plan is about an older problem than the description is: said
      // on the analyze line, because analyze is the phase that has to
      // run again. Amber, like every other "worth noticing, not
      // alarming" mark on this page — and it blocks nothing.
      const stale =
        p.step === "analyze" && g.analyzeStale
          ? " " +
            badge(
              "waiting",
              "description changed since",
              "1-description.md was committed after the last finished analyze",
            )
          : "";
      const tries =
        p.attempts.length > 1 ? `<span class="muted small">${p.attempts.length} attempts</span>` : "";
      // Live although the row is busy (spec 160): a phase this run has
      // not reached, which the reader may add to it or drop from it as
      // the run goes.
      const live = editable.has(p.step);
      // What the last run used is not spelled out in text any more —
      // it IS the picker's pre-filled value, in the column the caption
      // calls "Model".
      // `create` gets a box that is ticked and cannot be untucked: the
      // folder being on disk IS its answer, and a spec that exists
      // cannot be created again. It had no box at all until
      // 2026-08-21, and the hole where the other four have one made
      // the line read as a different KIND of thing rather than as the
      // one phase already behind you. It carries no `name`, so no
      // press can ever post `steps=create` — a disabled input is not
      // submitted either, and this is the belt as well as the braces.
      const box = locked
        ? phaseChip({
            dataAttr: "data-phase",
            value: p.step,
            label: "",
            ariaLabel: `${stepLabel(p.step)} — this spec is archived`,
            // Nothing to post and no form to post it to: `reopen` is the
            // one step an archived spec may be asked for, and the row's
            // Reopen carries it as a hidden field of its own.
            name: "",
            // What HAPPENED, not what a press would run next (spec 224).
            // `preTicked` answers the second question — and for a spec
            // whose workflow is over it always answers `{archive}`
            // alone, which would tick the one step this row did not have
            // and leave the ones it did unticked.
            checked: g.done.includes(p.step),
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say, and a padlock on all four of them would
            // be the row saying "archived" a fifth time.
            plain: true,
          })
        : QUEUE_STEPS.includes(p.step)
        ? phaseChip({
            // `data-phase`, not `data-step`: the line already carries
            // `data-step`, and one attribute per question keeps a test
            // that enumerates boxes from finding the lines too.
            dataAttr: "data-phase",
            value: p.step,
            // No visible label — the phase's own name leads the line
            // and the caption calls this column "Select". The
            // accessible one is given outright, since a wrapper with
            // no text has no name to offer.
            label: "",
            ariaLabel: stepLabel(p.step),
            // An editable box is never posted with the Run form: while
            // a job runs, that form asks for a SECOND job and the
            // queue refuses it as a clash. It still NAMES the form,
            // because that is how a press finds every control on the
            // row to lock — and a field with no name is submitted by
            // nobody, whatever it names.
            name: live ? "" : "steps",
            form: runFormId(g),
            postTo: live ? `/api/queue/${esc(g.lead!.id)}/steps` : undefined,
            // While busy this says what the RUNNING job will do with
            // the step, not what a fresh press would pre-tick
            // (`ticked`) — a step queued behind the running one is
            // still one this job named, and still reads as ticked.
            checked: busy ? !!g.lead?.steps.includes(p.step) : ticked.has(p.step),
            // The step being run had a carve-out here until spec 168,
            // because its box was drawn as a spinner instead. It falls
            // under the ordinary rule now and lands in the same place:
            // a running step is never `live` — `live` names a step the
            // run has NOT reached — so `busy && !live` disables it
            // exactly as the carve-out did.
            disabled: busy && !live,
            // Inert, but not padlocked: the tick already says whether
            // this job will get to the step (spec 145).
            plain: true,
            // A box the reader can still act on says what the tick
            // WOULD do; the rest say why the row will not take a
            // click.
            title: live
              ? `not started yet — ${g.lead?.steps.includes(p.step) ? "untick to drop it from this run" : "tick to add it to this run"}`
              : busy
                ? why
                : undefined,
          })
        : phaseChip({
            dataAttr: "data-phase",
            value: p.step,
            label: "",
            ariaLabel: `${stepLabel(p.step)} — already done, and not a step you can run`,
            // No name: nothing to post, whatever a browser decides to
            // do with a disabled field.
            name: "",
            checked: true,
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say.
            plain: true,
          });
      // The three choices this line offers, in one cell (spec 192): the
      // AI, then the model it fills in, then the phase's box. In the
      // order they are made in — which AI a phase runs on decides which
      // models there ARE to pick from, so it comes first.
      //
      // The AI had a column of its own from spec 165 to spec 192, and
      // one cell for the whole group before that — a span that had to
      // be kept level with `g.phases.length` and never a literal five,
      // since a spec whose past jobs touched a step outside the usual
      // set has that step appended as a line of its own. Neither is
      // needed now: every line writes this cell, whichever step it
      // names, and `aiPicker` simply draws nothing when there is one
      // configured AI and nothing to choose between.
      const pickCell =
        `<td class="modelcell"><span class="row">` +
        `<span class="aimodel">${aiPicker(g, opts, p.step, busy, live, latest?.model)}` +
        `${modelPicker(g, opts, p.step, busy, live, latest?.model)}</span>` +
        (locked ? lockedModel(p.step, p.model) : "") +
        `${box}</span></td>`;
      lines.push({
        tag: `<tr class="subrow" data-step="${esc(p.step)}">`,
        cells:
          // The name alone, hard left: it is what the eye lands on
          // first, and it started 2.5rem in behind the box until spec
          // 165 moved the box in beside the model.
          `<td class="phasecell">${name}</td>` +
          pickCell +
          `<td>${phaseWordCell(word, `${stale}${tries}`)}</td>` +
          // The phase's own duration, not when it began (spec 199).
          // Same physical column, a different question per row type —
          // which this column already did before, and which is what
          // makes "how long did this take?" readable without a column
          // of its own.
          `<td data-col="started">${locked ? lockedDuration(p.timeSpentMs) : phaseDurationCell(latest, p.step, now)}</td>` +
          `<td class="num" data-col="cost">${
            locked
              ? costCell(p.cost ?? 0, undefined, "", p.costUnmeasured)
              : latest
                ? costCell(latest.spentUsd, latest.spentTokens, "", anyCostUnmeasured(latest.results))
                : ""
          }</td>`,
      });
    });
  return lines.map((l) => `${l.tag}${l.cells}</tr>`).join("");
}

/** How many columns the list has. Two rows span the whole table — the
 *  "no spec matches" line and a row's message panel — and a count
 *  written twice is a count that drifts the next time a column moves. */
const LIST_COLUMNS = 5;

// The panel a row's long messages go into (spec 143): a row of its own,
// spanning the table, wrapping rather than overflowing. Everything the
// State column used to hold and could not — the runner's refusal, the
// spec's own reason for an archive that declined — is said here, once
// for the whole row, in the message component the page already has.
//
// Nothing to say draws nothing at all: an empty `.rowmsg` is invisible,
// but an empty `<tr>` is still a row of padding.
/** The one phase whose own record disagrees with the files, worded for
 *  the panel (spec 195). The sentence used to be drawn under that
 *  phase's badge, where it was the last thing on this page that could
 *  make one line taller than another.
 *
 *  The EARLIEST phase in workflow order, and only that one: the panel
 *  holds one message, and three disagreements listed in it would be the
 *  same growing block of text in a new place. It carries the phase's
 *  own name because a sentence moved out of the line it belonged to
 *  must say which line that was.
 *
 *  `p.attempts[0]`, not the in-flight-first pick the pips use: this is
 *  a RELOCATION of what `phaseSubRows` computes for that same phase's
 *  badge, so it has to read the same attempt that function does. */
function phaseDisagreement(g: SpecGroup): string | undefined {
  for (const p of g.phases) {
    const word = wordPhase(g.done.includes(p.step), p.heldBack, p.attempts[0], p.history);
    if (word.qualifier) return `${stepLabel(p.step)}: ${word.qualifier}`;
  }
  return undefined;
}

function specNoticeRow(g: SpecGroup, refusal: string | undefined): string {
  const notice = specNotice(
    g.lead,
    g.phases.find((p) => p.step === "archive")?.heldBack?.reason,
    refusal,
    phaseDisagreement(g),
  );
  if (!notice) return "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${LIST_COLUMNS}">${rowMessage(notice.variant, notice.text, { hook: notice.hook })}</td></tr>`
  );
}

/** What the "not landed" mark says on hover, age included (spec 208).
 *  Spelled out here rather than at the call site so the fact and its
 *  freshness cannot drift apart — the same reason `driftNote` exists,
 *  and the same idea: an answer a schedule took is shown WITH how old
 *  it is rather than withheld.
 *
 *  `relTimeLabel`, not `relTime` — this goes in a `title` attribute,
 *  where markup would show as literal tags. `checkedAt` is epoch ms
 *  (the checker's cache stamp) and the label takes an ISO string. */
function notLandedTitle(checkedAt: number | undefined, now: number): string {
  const why = "its branch is still on origin — re-run archive";
  if (checkedAt === undefined) return why;
  return `${why}, checked ${relTimeLabel(new Date(checkedAt).toISOString(), now)}`;
}

/** The waiting-on-review mark, wrapped in a link to the request when
 *  there is one to link to — the mark is a reason to go somewhere, and
 *  the place is the pull request. Without a URL it is the bare badge,
 *  saying the branch is open and nothing describes it. */
function prOpenMark(s: ArchivedSpecView): string {
  const mark = badge(
    "waiting",
    PR_OPEN,
    s.prUrl
      ? "its code is waiting on a pull request — open it to review"
      : "its code is on a branch and no pull request was opened for it",
  );
  return s.prUrl ? `<a href="${esc(s.prUrl)}">${mark}</a>` : mark;
}

/** The one action an archived spec offers (spec 198, on its row since
 *  spec 221). The same `POST /api/queue` with `steps=reopen` the spec's
 *  own page sends — not a shared helper with it, because the two differ
 *  in the one thing that matters here and a five-field form is not worth
 *  an abstraction over that difference.
 *
 *  What they differ in is `FROM_LIST_FIELD`: it is what tells the
 *  handler the press came from a row rather than from the spec's page,
 *  and therefore which page to answer on. A no-script form POST gets one
 *  redirect and no second chance to ask. */
function reopenForm(g: SpecGroup, opts: QueuePageOptions): string {
  return (
    `<form method="post" action="/api/queue" class="actionform">` +
    tokenField(opts.token) +
    filterFields(opts.filter) +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `<input type="hidden" name="steps" value="reopen">` +
    `<input type="hidden" name="${FROM_LIST_FIELD}" value="1">` +
    btn({ label: "Reopen", pending: "reopening…", variant: "primary" }) +
    `</form>`
  );
}

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
      const head = specHeadRow(g, opts, now, opened) + specNoticeRow(g, refusalFor(g, opts));
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
  const groups = groupBySpec(rows, opts.targets, opts.archived, opts.archivedSpecs);
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
        ? "No spec matches this filter."
        : "No spec to show — no project on this machine has one to run.") +
      `</td></tr>`;
  return (
    filterBar(groups, f, opts) +
    // "speclist" beside "list": the mobile stylesheet lays THIS table
    // out as stacked blocks (its rows are flex lines there), and the
    // archive page and the settings table share .list without wanting
    // any of that.
    `<div class="tablewrap"><table class="list speclist">${sortableHead(f)}<tbody>${body}</tbody></table></div>`
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
  const table = `<div id="jobrows">${renderQueueRows(rows, opts)}</div>`;
  const notice = opts.runnerAvailable
    ? ""
    : `<p class="muted">No runner is installed on this machine yet (slice 81b) — ` +
      `queued jobs stay queued, and nothing here spends money.</p>\n`;
  const body =
    notice +
    // The fallback, and only that. A refusal that names its spec is
    // shown in that spec's own panel (`specNoticeRow`) — the page lists up
    // to 25 of them, so the banner said nothing about which button was
    // pressed. One that names no spec has nowhere else to go, and
    // dropping it silently is worse than a banner.
    (opts.error && !opts.errorSpec
      ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n"
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
  });
}
