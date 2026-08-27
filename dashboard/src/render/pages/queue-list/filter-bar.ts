// The filter chips, the search field, the sortable column headers and
// the New-spec link that sit above the spec list. This file draws the
// controls that choose WHICH rows show and in WHAT order; `cells.ts`
// draws the rows themselves.

import { NEW_SPEC_ROUTE } from "../site.ts";
import { ICON_CHEVRON, ICON_SEARCH, filterPills } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import {
  ARCHIVED_STATE,
  DEFAULT_SORT,
  DEFAULT_STATE_FILTER,
  FILTER_KEYS,
  SORTS,
  SORT_DEFAULT_DIR,
  STATE_FILTERS,
  groupKey,
  isArchivedRow,
  matchesSearch,
  matchesState,
  stateFilter,
  type QueueFilter,
  type SpecGroup,
} from "./data-model.ts";
import type { QueuePageOptions } from "../queue-list.ts";

/** The three fields the search reads. Named in one place because the
 *  page says them out loud under the field — a filter whose reach is a
 *  guess is a filter nobody trusts. */
const SEARCHED = ["project:folder", "title", "description"];

// Links, not script: the filter lives in the URL, so it survives a
// reload, can be shared, and works with JavaScript switched off. The
// page's own code intercepts the click to avoid reloading a form
// someone is half-way through.
export function queueHref(f: QueueFilter, patch: QueueFilter): string {
  const merged = { ...f, ...patch };
  const q = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return esc(q ? `/?${q}` : "/");
}

// What the page used to say in a paragraph above the list: how runs
// work here. A front page does not open with four sentences a returning
// reader has read, so the same facts sit behind a "?" beside the search
// field instead (spec 261 moved it there from the filter chips' own
// row). It is inside `#jobrows`, so it shuts again on the five-second
// refresh, and fine for that: nothing here is being typed into.
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

export function filterBar(groups: SpecGroup[], f: QueueFilter, opts: QueuePageOptions): string {
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
  return `<div class="row">${states}</div>` + searchForm(f, opts);
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
function searchForm(f: QueueFilter, opts: QueuePageOptions): string {
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
    runsHelp() +
    newSpecLink(opts) +
    `</form>\n` +
    // Said out loud, because the one thing a reader cannot see about a
    // filter is what it looked in.
    `<p class="muted small listnote">Searches the ${SEARCHED.join(", the ")} — the whole ` +
    `description, including the part the row does not show.</p>\n`
  );
}

export function sortableHead(f: QueueFilter): string {
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

// The one control on this page that is NOT about a spec that exists:
// every other way in is a form on a spec's own row, and a spec that has
// never been written has no row to put one on.
//
// A link, not a form and not a disclosure (spec 121): the form has a
// page of its own at `NEW_SPEC_ROUTE`, with a Create and a Cancel on
// it. It sits at the right-hand end of the search field's own row,
// beside the "?" (spec 261; it used to sit at the end of the filter
// chips' row instead) — inside `#jobrows`, since spec 221 moved the
// filter bar in there — and keeps the primary-button look spec 113 gave
// it. It stood in a band of its own above the table before that.
// Not offered at all when no project on this machine may have a spec
// made in it, exactly as the panel was not.
function newSpecLink(opts: QueuePageOptions): string {
  if ((opts.createProjects ?? []).length === 0) return "";
  return `<a class="btn primary" href="${NEW_SPEC_ROUTE}">New spec</a>`;
}

