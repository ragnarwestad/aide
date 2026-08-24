// `/archive` — every archived spec, in one table (specs 163, 170).
//
// An archived spec's own page has worked since spec 150: `specDir()`
// resolves an archived folder because the scan loop records the
// directory of EVERY spec it finds, and only then drops the archived
// ones from the list. So the pages were there and nothing linked to
// one — reading an archived spec meant going to whichever specs
// repository it lives in and opening the files by hand.
//
// Spec 163 gave it a heading per project and a `.proj-row` per spec.
// That is fine for a project with six archived specs; aide has 79 and
// the number only grows, and sections make the one question a long
// archive actually asks — what was archived recently, whichever
// project it came from — impossible to answer. One table with the
// project as a CELL answers it, which is why the sections and their
// jump-links are gone.
//
// Everything here is a plain form or a plain link. The sort rides in
// the query string exactly as the spec list's does, and the search is
// a GET form: both survive a reload, can be pasted to someone else,
// and work with JavaScript switched off. No pagination — at 79 rows it
// would add page state and boundary rules to solve nothing, and every
// row being present is what keeps the browser's own find useful.

import { CHECKING, badge } from "./components.ts";
import { esc, relTimeLabel } from "./html.ts";
import { durationLabel } from "./job-state.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { ARCHIVE_ROUTE } from "./site.ts";

export interface ArchivedSpecView {
  /** Which project's archive it came out of — a column now, where it
   *  used to be the heading a whole section sat under. */
  project: string;
  /** The spec's folder, which is also its number — what a person calls
   *  it when they go looking for it. */
  folder: string;
  /** Its H1, when `1-description.md` has one. */
  title?: string;
  /** The prose under `## Description`, whole. The cell shows two lines
   *  of it and the search reads all of it — cutting it here would make
   *  the two disagree. */
  description?: string;
  /** When it was archived: the `4-status.md` stamp, or failing that the
   *  commit that last touched the folder. `null` when neither answers,
   *  and the row says so in words rather than leaving the cell blank. */
  archivedAt: string | null;
  /** Where the page that already worked lives. Built by the server from
   *  the same function the spec list links through. */
  href: string;
  /** Its own `aide/<folder>` is STILL on origin (spec 193): the spec
   *  was archived and its work never landed. Derived from origin rather
   *  than from the job, because this is the half that reaches a spec
   *  whose job the queue's LRU cap evicted long ago — 146's case, which
   *  carried no failure reason at all. */
  notLanded?: boolean;
  /** Its branch is open because the project reviews its code (spec 220),
   *  not because the landing failed. Takes precedence over `notLanded`,
   *  which is derived from the same fact and would otherwise say the
   *  opposite of what happened. */
  prOpen?: boolean;
  /** The request itself, when the run managed to open one. Absent where
   *  `gh` could not — and then the row says the branch is open with
   *  nothing describing it, which is a state worth seeing. */
  prUrl?: string;
  /** When that answer was last taken — epoch ms, the checker's own
   *  cache stamp (spec 208). The set is whatever a background schedule
   *  last found, so how OLD it is decides how much of it to believe:
   *  the mark says so, the same way `driftNote` labels a commits-behind
   *  count. Absent for a row carrying no mark, and for one whose answer
   *  has never been taken. */
  notLandedCheckedAt?: number;
  /** Nobody has yet asked git when this spec was archived (spec 208).
   *  Only a spec whose `4-status.md` carries no `Archived:` stamp can
   *  reach git at all, so this is the shrinking minority of a shrinking
   *  minority — and the cell says "checking…" for it rather than
   *  `date unknown`, which is what a spec git ASKED about and could not
   *  date says. */
  dateChecking?: boolean;
  /** What the spec cost in TIME: its phases added together, in
   *  milliseconds, off the `Time spent (ms)` stamp its archive landing
   *  wrote into `4-status.md` (spec 207). Absent for every spec
   *  archived before that stamp existed, and the cell is then genuinely
   *  blank — not `date unknown`, not a dash: 1-description.md asks for
   *  a blank in as many words, because a figure nobody recorded is
   *  different from a value that could not be found.
   *
   *  Milliseconds rather than the label, because the column SORTS:
   *  `localeCompare(..., { numeric: true })` compares the digit runs
   *  inside a string, so it would put `"3h12m"` before `"45s"`. */
  durationMs?: number;
}

/** How the table is cut and ordered, straight off the query string.
 *  Every value is whatever arrived: unusable ones are normalised here
 *  rather than refused, because a bookmark with a stale `sort=` should
 *  show the archive, not an error. */
export interface ArchiveFilter {
  q?: string;
  sort?: string;
  dir?: string;
}

export interface ArchivePageView {
  /** Every archived spec the reader may see, in no particular order:
   *  the filtering and the ordering are this module's, so there is one
   *  copy of each rule and the route has none. */
  rows: ArchivedSpecView[];
  filter: ArchiveFilter;
}

/** What the date cell says when the spec carries no stamp and git
 *  cannot date its folder either — a folder copied in rather than
 *  committed. Spelled out here so the listing and its test cannot word
 *  the same absence differently. */
export const NO_DATE = "date unknown";

/** The mark an archived row carries when its branch is still open.
 *  Spelled out here so the listing and its test cannot word the same
 *  fact differently, and drawn with the same `refused` badge the spec
 *  list gives a failed row — one archive is not a different kind of
 *  problem from the other. */
export const NOT_LANDED = "not landed";

/** The mark an archived row carries instead, when its branch is open
 *  BECAUSE THE PROJECT ASKED FOR THAT (spec 220): `codeLanding: pr` in
 *  its manifest, so the code waits on a pull request for as long as the
 *  review takes. Same fact from origin — the branch is there — and the
 *  opposite meaning, which is the whole reason it is worded apart:
 *  `NOT_LANDED` reads as an instruction to run archive again, and this
 *  one is an instruction to go and review something. */
export const PR_OPEN = "PR open";

/** What the description cell says when `1-description.md` has no
 *  `## Description` section. A dash, not a blank cell: the same reason
 *  the date says `date unknown`. */
const NO_DESCRIPTION = "—";

/** The three fields the search reads. Named in one place because the
 *  page says them out loud under the field — a filter whose reach is a
 *  guess is a filter nobody trusts. */
const SEARCHED = ["folder", "title", "description"];

const SORTS = ["date", "project", "title", "duration"];
const DEFAULT_SORT = "date";
/** The direction each column takes on the first click: newest archived
 *  first and longest first, but names from A. */
const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  date: "desc", project: "asc", title: "asc", duration: "desc",
};

// The same chevron the spec list's headings carry, and for the same
// reason: faint until hovered, so a reader can see the column CAN be
// sorted, and turned by a class rather than swapped for a second glyph.
const CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 6l4 4 4-4"></path></svg>';

interface Resolved {
  q: string;
  sort: string;
  dir: "asc" | "desc";
}

/** The query as the page will actually use it. One function, so the
 *  rows, the headings and the form can never be reading three
 *  different views of the same URL. */
function resolve(f: ArchiveFilter): Resolved {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  return {
    q: (f.q ?? "").trim(),
    sort,
    dir: f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!,
  };
}

/** Links, not script: the whole view lives in the URL. `q` first so a
 *  heading link reads the way the reader got here — searched, then
 *  sorted. A value equal to the default is left out entirely, which is
 *  what keeps `/archive` itself a clean link. */
function archiveHref(r: Resolved, patch: Partial<Resolved>): string {
  const merged = { ...r, ...patch };
  const parts: string[] = [];
  if (merged.q) parts.push(`q=${encodeURIComponent(merged.q)}`);
  if (merged.sort !== DEFAULT_SORT) parts.push(`sort=${encodeURIComponent(merged.sort)}`);
  if (merged.dir !== SORT_DEFAULT_DIR[merged.sort]!) parts.push(`dir=${merged.dir}`);
  return esc(parts.length ? `${ARCHIVE_ROUTE}?${parts.join("&")}` : ARCHIVE_ROUTE);
}

/** Everything the search reads, as one lowercase haystack. The WHOLE
 *  description, not the two lines the cell shows: a term found in the
 *  clipped tail still turns up its row, and the note under the field
 *  says as much. */
const haystack = (s: ArchivedSpecView): string =>
  `${s.folder}\n${s.title ?? ""}\n${s.description ?? ""}`.toLowerCase();

/** The last word in every comparison: folder NUMBER first — `92` and
 *  `150` are numbers, and `localeCompare` without `numeric` puts `150`
 *  before `92` — then the project, for two projects that number their
 *  specs alike. Deterministic, so a reload cannot reshuffle two rows
 *  the sorted column cannot tell apart. */
const tieBreak = (a: ArchivedSpecView, b: ArchivedSpecView): number =>
  a.folder.localeCompare(b.folder, "en", { numeric: true }) ||
  a.project.localeCompare(b.project, "en");

/** What the sorted column holds for one row. Title falls back to the
 *  folder — a spec whose `1-description.md` has no H1 still has a name,
 *  and the Title cell shows that name too. Only the date and the
 *  duration can genuinely be missing.
 *
 *  A NUMBER for the duration (spec 207), never its label: see
 *  `durationMs`. */
function sortKey(s: ArchivedSpecView, sort: string): string | number | null {
  if (sort === "project") return s.project;
  if (sort === "title") return s.title ?? s.folder;
  if (sort === "duration") return s.durationMs ?? null;
  return s.archivedAt;
}

function ordered(rows: ArchivedSpecView[], r: Resolved): ArchivedSpecView[] {
  const sign = r.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortKey(a, r.sort);
    const bv = sortKey(b, r.sort);
    // A spec no value could be found for stays at the bottom whichever
    // way the column is turned: it is not the oldest or the quickest,
    // it is unknown, and floating it to the top on a reversal would say
    // it was.
    //
    // `=== null` and never a truthy test (spec 207). Every sort key
    // used to be a non-empty string or `null`, so `if (av && !bv)` said
    // the same thing — and a duration of exactly `0` is falsy, present,
    // and would have sunk beside the rows that have no figure at all.
    if (av !== null && bv === null) return -1;
    if (av === null && bv !== null) return 1;
    const c =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : av !== null && bv !== null
          ? String(av).localeCompare(String(bv), "en", { numeric: true })
          : 0;
    return (c || tieBreak(a, b)) * sign;
  });
}

/** Which rows the table shows: the search, then the order. Filtering
 *  first is what makes the sort's tie-breaks describe the rows a reader
 *  can actually see. */
export function archiveRows(view: ArchivePageView): ArchivedSpecView[] {
  const r = resolve(view.filter);
  const term = r.q.toLowerCase();
  const kept = term ? view.rows.filter((s) => haystack(s).includes(term)) : view.rows;
  return ordered(kept, r);
}

function searchForm(r: Resolved): string {
  // The sort travels as hidden fields because a GET form REPLACES the
  // query string: without them, searching would silently throw away the
  // column the reader had just chosen.
  const keep =
    (r.sort !== DEFAULT_SORT ? `<input type="hidden" name="sort" value="${esc(r.sort)}">` : "") +
    (r.dir !== SORT_DEFAULT_DIR[r.sort]! ? `<input type="hidden" name="dir" value="${esc(r.dir)}">` : "");
  return (
    `<form class="row" method="get" action="${esc(ARCHIVE_ROUTE)}">` +
    // No caption over the field: the button beside it says Search, and
    // the same word twice made the field taller than the button it
    // stands next to, so the two did not line up (2026-08-23).
    `<input class="archive-q" type="search" name="q" value="${esc(r.q)}" ` +
    `placeholder="a word in any of three fields" aria-label="Search the archive">` +
    keep +
    `<button class="btn" type="submit">Search</button>` +
    `</form>\n` +
    // Said out loud, because the one thing a reader cannot see about a
    // filter is what it looked in.
    `<p class="listnote">Searches the ${SEARCHED.join(", the ")} — the whole description, ` +
    `including the part the column does not show.</p>\n`
  );
}

function head(r: Resolved): string {
  const th = (key: string, label: string) => {
    const on = key === r.sort;
    // Clicking the column you are already sorted by turns it round.
    const next = on ? (r.dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
    const cls =
      (on ? "sortlink on" : "sortlink") + ((on ? r.dir : SORT_DEFAULT_DIR[key]!) === "asc" ? " asc" : "");
    const aria = on ? ` aria-sort="${r.dir === "asc" ? "ascending" : "descending"}"` : "";
    return (
      `<th${aria}><a class="${cls}" href="${archiveHref(r, { sort: key, dir: next })}">` +
      `${esc(label)}${CHEVRON}</a></th>`
    );
  };
  // Description has no link: it is prose, and prose sorts to nothing
  // anyone came here for.
  return (
    `<thead><tr>${th("project", "Project")}${th("title", "Title")}` +
    `<th>Description</th>${th("date", "Date")}${th("duration", "Duration")}</tr></thead>`
  );
}

/** What the mark says on hover, age included (spec 208). Spelled out
 *  here rather than at the call site so the fact and its freshness
 *  cannot drift apart — the same reason `driftNote` exists one page
 *  over, and the same wording, because it is the same idea: an answer a
 *  schedule took is shown WITH how old it is rather than withheld.
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

function specRow(s: ArchivedSpecView, now: number): string {
  const title = s.title ? `<p class="spec-title">${esc(s.title)}</p>` : "";
  // Beside the link a reader would follow, because the mark is a reason
  // to follow it: the spec needs its `archive` run again.
  // Spec 220 first: the two marks come from ONE fact — the branch is
  // still on origin — and a project that reviews its code means that
  // fact to be true. Reading `notLanded` first would call every working
  // PR-mode archive stuck.
  const mark = s.prOpen
    ? ` ${prOpenMark(s)}`
    : s.notLanded
      ? ` ${badge("refused", NOT_LANDED, notLandedTitle(s.notLandedCheckedAt, now))}`
      : "";
  return (
    `<tr><td>${esc(s.project)}</td>` +
    `<td><a href="${esc(s.href)}">${esc(s.folder)}</a>${mark}${title}</td>` +
    `<td><div class="archive-desc">${esc(s.description ?? NO_DESCRIPTION)}</div></td>` +
    `<td class="archive-date">${esc(s.archivedAt ?? (s.dateChecking ? CHECKING : NO_DATE))}</td>` +
    // Blank, and deliberately not the dash the description cell uses or
    // the words the date cell uses: a spec archived before spec 207
    // recorded nothing, and "nothing was recorded" is what an empty
    // cell says.
    `<td class="archive-duration">${s.durationMs === undefined ? "" : esc(durationLabel(s.durationMs))}</td></tr>`
  );
}

export function renderArchivePage(
  view: ArchivePageView,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const r = resolve(view.filter);
  const shown = archiveRows(view);
  const projects = new Set(view.rows.map((s) => s.project)).size;

  // Three states, and they are not the same thing. An empty archive is
  // a fact about the projects; no match is a fact about the term the
  // reader just typed, and it has to leave the field standing so the
  // term can be edited rather than retyped.
  const body = !view.rows.length
    ? `<p class="empty">Nothing has been archived yet.</p>`
    : // The archive's OWN size, not the number of rows below it: the
      // rows are their own count, and a second number that moves with
      // the search would only be read as the first one.
      `<p class="summary">${projects} projects · ${view.rows.length} archived</p>\n` +
      searchForm(r) +
      (shown.length
        ? `<div class="tablewrap"><table class="list">${head(r)}\n` +
          `<tbody>${shown.map((s) => specRow(s, Date.parse(generatedAt) || 0)).join("\n")}</tbody></table></div>`
        : `<p class="empty">No archived spec matches that search.</p>`);

  // No meta refresh: the archive is a record, and a record does not
  // change under the reader.
  //
  // And no heading: the tab says "Archive", and the shell's <h1> said it
  // again directly under it (2026-08-21).
  return pageShell("Archive", entries, ARCHIVE_ROUTE, body, generatedAt, undefined, {
    hideHeading: true,
  });
}
