// The state filter, the search field, the sortable column headers and
// the New-spec link that sit above the spec list. This file draws the
// controls that choose WHICH rows show and in WHAT order; `cells.ts`
// draws the rows themselves.

import { NEW_SPEC_ROUTE } from "../projects-page";
import { btn, btnLink, FILTER_ICONS, helpPopover, ICON_CHEVRON, ICON_SEARCH } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import {
  ARCHIVED_STATE,
  CLOSED_STATE,
  DEFAULT_SORT,
  FILTER_KEYS,
  SORTS,
  SORT_DEFAULT_DIR,
  STATE_FILTERS,
  groupKey,
  isArchivedRow,
  matchesSearch,
  matchesState,
  matchesStateFilter,
  stateFilters,
  stateFilterLabel,
  toggledState,
  type SpecsFilter,
  type SpecGroup,
} from "./data-model";
import type { SpecsPageOptions } from "./";
import { capitalizeFirst } from "../../../messages/shared/written.ts";

// Links, not script: the filter lives in the URL, so it survives a
// reload, can be shared, and works with JavaScript switched off. The
// page's own code intercepts the click to avoid reloading a form
// someone is half-way through.
export function queueHref(f: SpecsFilter, patch: SpecsFilter): string {
  return esc(queuePath(f, patch));
}

/** The same address unescaped, for a caller that escapes it itself. `path`
 *  is the page the rows sit on: the Specs list's own unless the Jobs tab
 *  draws them. */
export function queuePath(f: SpecsFilter, patch: SpecsFilter = {}, path = "/specs"): string {
  const merged = { ...f, ...patch };
  if (["q", "state", "kind", "sort", "dir"].some((key) => Object.prototype.hasOwnProperty.call(patch, key) && (patch as Record<string, unknown>)[key] !== (f as Record<string, unknown>)[key])) {
    for (const key of ["limit", "boundary", "windowQuery", "windowLoaded", "grow"] as const) delete merged[key];
  }
  const q = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `${path}?${q}` : path;
}

// What the page used to say in a separate paragraph under the search
// field: what the search reads. It sits behind the "?" beside
// the field instead — the one thing a reader cannot see about a filter is
// what it looked in. It is inside `#jobrows`, so it shuts again on the
// five-second refresh, and fine for that: nothing here is being typed
// into.
/** The search help's id: the phone's "…" menu opens it by this. */
export const SEARCH_HELP = "search-help";

function runsHelp(lang: Language): string {
  return helpPopover(t(lang, "list.searchHelpTitle"), t(lang, "list.searchHelpBody"), SEARCH_HELP);
}

export function filterBar(groups: SpecGroup[], f: SpecsFilter, opts: SpecsPageOptions, shown: number): string {
  const lang = opts.lang ?? "en";
  // Counts are of what the OTHER filter already allows, so the numbers
  // add up to the table you are looking at rather than to some list
  // nobody asked for. The search is one of those filters
  // — an entry counting rows a term has cut would be counting a table
  // nobody can see. They count SPECS, because that is what the table
  // holds one line per.
  const counted = groups.filter((g) => matchesSearch(g, f));
  // The archived rows are built only where the filter shows them,
  // so on the default view there are almost none to count — and
  // "Archived (0)" beside an archive of a hundred and fifty is the one
  // thing a count must not say. The KEYS are cheap and always sent, and
  // there is exactly one reader row per key, so the keys no row was
  // built for are the rest of the count. "Almost" because the default
  // view does build a row for an archived spec whose branch is still
  // open, which is why this subtracts what is on the page
  // rather than testing whether anything is.
  //
  // Dropped while a search term is active: which archived specs a term
  // would have matched cannot be known without the rows, and a number
  // that is wrong is worse than an entry with no number on it.
  const built = new Set(
    groups.filter(isArchivedRow).map((g) => groupKey(g.project, g.specFolder)),
  );
  // Split in two rather than one `uncounted` total —
  // an unbuilt CLOSED key must count toward "All" but never toward
  // "Archived", the same split its own entry already keeps once a row
  // IS built (`matchesStateFilter` on `CLOSED_STATE`). `opts.closed` is
  // the same cheap key list `opts.archived` is, filtered server-side to
  // the ones actually closed.
  const closedKeys = new Set(opts.closed ?? []);
  const searching = (f.q ?? "").trim() !== "";
  const uncountedArchived = searching
    ? 0
    : (opts.archived ?? []).filter((k) => !built.has(k) && !closedKeys.has(k)).length;
  const uncountedClosed = searching
    ? 0
    : (opts.archived ?? []).filter((k) => !built.has(k) && closedKeys.has(k)).length;
  // The Not verified entry's own unbuilt: the archived specs that have a
  // count and no built row. Counted for this entry alone — the shared
  // `matchesState(s, ARCHIVED_STATE)` above is true for any entry naming
  // no `states`, and would add every unbuilt archived key to it.
  const uncountedNotVerified = searching ? 0 : (opts.notVerified ?? []).filter((k) => !built.has(k)).length;
  const state = stateDropdown(f, counted, { archived: uncountedArchived, closed: uncountedClosed, notVerified: uncountedNotVerified }, lang);
  return searchForm(
    {
      action: "/specs",
      hidden: FILTER_KEYS.filter((k) => k !== "q" && f[k]).map((k) => [k, f[k]!]),
      q: f.q ?? "",
      clearHref: queueHref(f, { q: "" }),
      after: state + resultCount(shown) + newSpecLink(opts, lang),
    },
    lang,
  );
}

// One dropdown of checkbox links. Each link carries the whole next value,
// so adding or removing a state works without JavaScript.
// Labelled "State", not "Phases": this page already calls this exact concept "State" —
// the table's own column heading — and "Phase" already means the
// create/analyze/implement/archive workflow step two columns over.
function stateDropdown(
  f: SpecsFilter,
  counted: SpecGroup[],
  uncounted: { archived: number; closed: number; notVerified: number },
  lang: Language,
): string {
  // Computed once, so the trigger and the panel option for the SAME
  // choice can never show two different counts — the trigger
  // below reads `chosen.count` off this same array rather than summing
  // its own copy.
  const ticked = stateFilters(f.state);
  const rows = STATE_FILTERS.map((s) => {
    const on = ticked[0]?.key === "all" || ticked.some((entry) => entry.key === s.key);
    const count =
      counted.filter((g) => matchesStateFilter(s, g)).length +
      (s.where ? uncounted.notVerified : matchesState(s, ARCHIVED_STATE) ? uncounted.archived : 0) +
      // An unbuilt closed key never reaches "Archived"
      // (CLOSED_STATE is not in that entry's `states`), only "All".
      (!s.where && matchesState(s, CLOSED_STATE) ? uncounted.closed : 0);
    return { s, on, count };
  });
  return menuDropdown({
    filter: "state",
    icon: "state",
    none: { label: t(lang, "list.state.none"), href: queueHref(f, { state: "none" }) },
    ariaLabel: t(lang, "list.statesLabel"),
    triggerLabel: t(lang, "list.statesLabel"),
    options: rows.map(({ s, on, count }) => ({
      key: s.key,
      label: stateFilterLabel(s.key, lang),
      count,
      on,
      // Always explicit: picking All has to be able to
      // override a REMEMBERED non-default filter, and a blank `state`
      // collapses to the same bare `/` a plain navigation with no choice
      // at all produces — the one thing that would tell the two apart.
      href: queueHref(f, { state: toggledState(STATE_FILTERS, ticked, s.key) }),
    })),
  });
}

/** One option of a dropdown: its label as plain text, its count, whether it is
 *  the chosen one, and the link that chooses it, already escaped. */
export interface MenuOption {
  key: string;
  /** A heading put immediately before this option. */
  heading?: string;
  label: string;
  count?: number;
  on: boolean;
  href: string;
}

/** How many rows the table under a filter row shows, after its filters and search. */
export function resultCount(n: number): string {
  return `<span class="counts" data-result-count>(${n})</span>`;
}

/** A filter dropdown of checkbox links, its button named by `triggerLabel`
 *  whatever is ticked. `filter` names the control for the page script and
 *  the tests. `none`, where given, stands beside the first option. */
export function menuDropdown(o: { filter: string; ariaLabel: string; options: MenuOption[]; triggerLabel: string; none?: Pick<MenuOption, "label" | "href">; icon?: keyof typeof FILTER_ICONS }): string {
  const [all, ...choices] = o.options;
  const option = (opt: MenuOption) =>
    (opt.heading ? `<strong>${esc(opt.heading)}</strong>` : "") +
    `<a data-nav href="${opt.href}" role="checkbox" aria-checked="${opt.on}">` +
    `<span class="check" aria-hidden="true"></span>${esc(opt.label)}${opt.count === undefined ? "" : ` (${opt.count})`}</a>`;
  const none = o.none ? option({ key: "none", ...o.none, on: !o.options.some((opt) => opt.on) }) : "";
  const options = `<div class="row">${option(all!)}${none}</div>` + choices.map(option).join("");
  const visible = esc(o.triggerLabel);
  const widths = `<span aria-hidden="true">${visible}</span>`;
  return (
    `<details class="menu state" id="${o.filter}-filter" data-filter="${o.filter}"${all?.on ? "" : " data-filter-active"}>` +
    `<summary aria-label="${o.ariaLabel}" title="${o.ariaLabel}">` +
    (o.icon ? `<span class="filtericon">${FILTER_ICONS[o.icon]}</span>` : "") +
    `<span class="menuwidth"><span>${visible}</span>${widths}</span>${ICON_CHEVRON}</summary>` +
    `<div class="menupanel" role="group" aria-label="${o.ariaLabel}">${options}</div>` +
    `</details>`
  );
}

/** The search field. It came off `/archive`, which had the
 *  only search on this dashboard, and it reads the same three fields
 *  there as here.
 *
 *  Links, not script, like every other control on this page: a plain GET
 *  form, so it works with JavaScript switched off, survives a reload and
 *  can be pasted to someone else. A GET form REPLACES the query string,
 *  so everything else in the view travels as hidden fields — without
 *  them, searching would silently throw away the filter and the column the
 *  reader had just chosen. `state` is one of those fields, unchanged by
 *  it still travels as a hidden field like every other filter
 *  key, so a plain "Search" press with no JavaScript preserves whichever
 *  state filter is active instead of silently resetting to the
 *  default. */
export function searchForm(
  o: {
    /** The page the form is asked of. */
    action: string;
    /** What travels on, as name and value. */
    hidden: [string, string][];
    q: string;
    /** The link that clears the term, already escaped. */
    clearHref: string;
    /** What follows the help popover: the dropdowns and the New link. */
    after: string;
  },
  lang: Language,
): string {
  const keep = o.hidden.map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
  const q = o.q.trim();
  const clearLabel = t(lang, "list.searchClearTitle");
  return (
    `<form class="specsearch" method="get" action="${o.action}">` +
    // No caption over the field: the button beside it says Search, and
    // the same word twice made the field taller than the button it
    // stands next to (2026-08-23).
    //
    // The clear control sits inside the field, so getting
    // back to the whole list is one press rather than select-all and
    // delete. A LINK, like the fold and the sort: `q` is dropped and
    // every other filter travels on, so it works with script off,
    // survives a reload and can be pasted — and `data-nav` lets
    // `specs-client.ts` swap the rows in place instead of reloading.
    // Drawn only when there is something to clear; an × over an empty
    // field is a control that does nothing.
    `<span class="searchfield">` +
    `<span class="icon-search" aria-hidden="true">${ICON_SEARCH}</span>` +
    `<input class="archive-q" type="search" name="q" enterkeyhint="search" value="${esc(q)}" ` +
    `placeholder="${capitalizeFirst(t(lang, "list.searchPlaceholder"))}" aria-label="${t(lang, "list.searchAriaLabel")}">` +
    (q
      ? `<a class="searchclear" data-nav href="${o.clearHref}" ` +
        `title="${clearLabel}" aria-label="${clearLabel}">&times;</a>`
      : "") +
    `</span>` +
    keep +
    btn({ label: t(lang, "list.search"), data: { "search-submit": "" } }) +
    runsHelp(lang) +
    o.after +
    `</form>\n`
  );
}

/** The columns' widths are declared on the column group, in this order. */
const JOB_COLUMNS = ["fold", "spec", "phase", "state", "started", "cost"];
const SPEC_COLUMNS = ["fold", "spec", "phase", "state", "actions"];
export const columnGroup = (specsList = false): string =>
  `<colgroup>${(specsList ? SPEC_COLUMNS : JOB_COLUMNS).map((c) => `<col data-col="${c}">`).join("")}</colgroup>`;

/** The five headings the list's table carries. Cost's heading holds both units; the reader's choice
 *  shows one. */
const HEADINGS: { key: string; label: TranslationKey; cls?: string; attrs: string; labelHtml?: (lang: Language) => string; plain?: boolean }[] = [
  { key: "created", label: "list.colUpdated", attrs: ' colspan="2" data-col="created"' },
  { key: "spec", label: "list.colSpec", attrs: ' data-col="spec"' },
  { key: "state", label: "list.colStateAlone", attrs: ' data-col="state"' },
  { key: "started", label: "list.colTime", attrs: ' data-col="started"' },
  {
    key: "cost",
    label: "list.colCost",
    cls: "num",
    attrs: ' data-col="cost"',
    labelHtml: (lang) => `<span class="u-usd">${t(lang, "list.colCost")}</span><span class="u-tok">${t(lang, "list.colTokens")}</span>`,
  },
];

const SPEC_HEADINGS: typeof HEADINGS = [
  { key: "created", label: "list.colCreated", attrs: ' colspan="2" data-col="created"' },
  { key: "spec", label: "list.colSpec", attrs: ' data-col="spec"' },
  { key: "state", label: "list.colStateAlone", attrs: ' data-col="state"' },
  { key: "actions", label: "list.colActions", attrs: ' data-col="actions"' },
];

/** What a sortable head is drawn from. */
export interface SortHeadOptions {
  now: { sort?: string; dir: "asc" | "desc" };
  href: (key: string) => string;
  specLabel: TranslationKey;
  /** The Specs list: job status is reached through its Jobs links. */
  specsList?: boolean;
  /** Headings only, no sort links: a list kept in an order of its own. */
  plain?: boolean;
}

// `labelHtml` for the one column whose heading is a consumption label
// and not a noun: "Cost" is the wrong word above a column of token
// counts, so it carries the same two spans its cells do.
// `attrs` is the fold hook: the two columns a phone drops
// are named on the cell rather than counted by position, because the
// column ORDER has already changed once (see below) and an
// `nth-child` rule would have broken silently when it did.
function sortHeading(
  href: (key: string) => string,
  now: { sort?: string; dir: "asc" | "desc" },
  h: { key: string; label: string; cls: string; labelHtml?: string; attrs: string },
): string {
  const { key, label, cls, labelHtml, attrs } = h;
  const { sort, dir } = now;
  const on = key === sort;
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
    `<a class="${linkCls}" data-nav href="${href(key)}">` +
    `${labelHtml ?? esc(label)}${mark}</a></th>`
  );
}

/** The list's table head with a sort link on every heading. `now.sort` is the
 *  column the rows are ordered by, undefined for a page that is in its own
 *  order and marks none; `href` is the already escaped link a heading leads
 *  to; `specLabel` heads the second column. */
export function sortHead(
  o: SortHeadOptions,
  lang: Language = "en",
): string {
  const { sort, dir } = o.now;
  const th = (key: string, label: string, cls = "", labelHtml?: string, attrs = "") =>
    sortHeading(o.href, { sort, dir }, { key, label, cls, labelHtml, attrs });
  return (
    // "Progress", not "Step": the column stopped holding a step name the
    // moment the list became one line per spec. It holds the whole
    // workflow as pips on a header line, and how many attempts a phase
    // took on the lines beneath.
    // There is no blank heading for a shut row's one action: it sits
    // beside the state, so a column for it would be an empty `<td>`
    // under every row. Leaving it out of the header and
    // from both row types together is what keeps the columns lined up
    // — a row short of a cell the header still declares is what shifts
    // them.
    // "Spec" spans TWO columns, because the row's AI select has a
    // column of its own between the phase name and the model.
    // Spanning rather than a blank heading beside it: this row has
    // nothing to put in that column, and a column of its own here
    // would take its width from the spec NAME — leaving the phase
    // names, which are short, floating in a cell as wide as a folder
    // name. Spanning lets the phase names size their own column.
    // Each column's width is declared on the COLUMN (list.css) — the
    // only place a table can be told one whether or not a row currently
    // draws a cell there. The second column belongs to the phase lines
    // alone and this head row spans across it, so a width stated on
    // cells left it 0 wide with every row shut and 300-odd wide with one
    // open, moving every column to its right (2026-09-04).
    // "fold" is the chevron's own, first and narrow (2026-09-22): the
    // control opens and shuts the row and is the one thing on it that is
    // not information, so it stands outside the title rather than inside
    // it — which also gives it a cell's worth of height to be hit in,
    // across both of the header's two lines.
    columnGroup(!!o.specsList) +
    `<thead><tr>` +
    (o.specsList ? SPEC_HEADINGS : HEADINGS).map((h) => {
      const label = h.key === "spec" ? o.specLabel : h.label;
      if (h.plain || o.plain) {
        const text = h.labelHtml?.(lang) ?? esc(t(lang, label));
        const action = h.key === "spec" && !o.specsList ? `<span class="colaction">${esc(t(lang, "list.colAction"))}</span>` : "";
        return `<th class="${h.cls ?? ""}"${h.attrs}>${text}${action}</th>`;
      }
      const cell = th(h.key, t(lang, label), h.cls ?? "", h.labelHtml?.(lang), h.attrs);
      // An open job's button stands at the right end of this column, just
      // before the state, so the column heads it there too.
      return h.key === "spec" && !o.specsList
        ? cell.replace(/<\/th>$/, `<span class="colaction">${esc(t(lang, "list.colAction"))}</span></th>`)
        : cell;
    }).join("") +
    `</tr></thead>`
  );
}

/** The Specs list's head: the column the view is sorted by, marked, and a
 *  heading's link turning it round when it is the one already sorted by. */
export function sortableHead(f: SpecsFilter, lang: Language = "en", specsList = false): string {
  const requested = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const sort = specsList && (requested === "started" || requested === "cost") ? DEFAULT_SORT : requested;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  return sortHead(
    {
      now: { sort, dir },
      // Clicking the column you are already sorted by turns it round.
      href: (key) => {
        const next = key === sort ? (dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
        return queueHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next });
      },
      specLabel: "list.colSpec",
      specsList,
    },
    lang,
  );
}

// The one control on this page that is NOT about a spec that exists:
// every other way in is a form on a spec's own row, and a spec that has
// never been written has no row to put one on.
//
// A link, not a form and not a disclosure: the form has a
// page of its own at `NEW_SPEC_ROUTE`, with a Create and a Cancel on
// it. It sits at the right-hand end of the search field's own row,
// beside the "?" — inside `#jobrows`, where the filter bar is — and
// keeps the primary-button look.
// Not offered at all when no project on this machine may have a spec
// made in it, exactly as the panel was not.
//
// It is named as the page it leads to is, in the reader's language.
export function newSpecLink(opts: Pick<SpecsPageOptions, "createProjects">, lang: Language): string {
  if ((opts.createProjects ?? []).length === 0) return "";
  return btnLink({ href: NEW_SPEC_ROUTE, label: t(lang, "newSpec.pageTitle"), shortLabel: t(lang, "list.newShort"), variant: "primary" });
}


/** A list's headings in a table of their own above the box that scrolls,
 *  so the scrollbar runs beside the rows alone. Both tables declare the
 *  same columns, which keeps the headings over their cells.
 *  "speclist" beside "list": the mobile stylesheet lays these tables out
 *  as stacked blocks, and the archive page and the settings table share
 *  .list without wanting any of that. `data-list` tells the Specs list's
 *  own columns apart from the Jobs tab's, which share the class. */
export function listTable(o: { tableAttrs: string; head: string; columns: string; boxAttrs: string; body: string; after: string }): string {
  const open = `<table class="list speclist"${o.tableAttrs}>`;
  return `<div class="listhead">${open}${o.head}</table></div>` +
    `<div class="tablewrap"${o.boxAttrs}>${open}${o.columns}<tbody>${o.body}</tbody></table>${o.after}</div>`;
}
