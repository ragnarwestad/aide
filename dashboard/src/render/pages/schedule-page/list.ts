// The /schedule list body (spec 276, reworked spec 278): search and
// sort across every allowed project's entries at once, the same
// pattern the Specs list already uses — monitoring only, per the
// description: no cron expression, no Edit action and no History link
// here, all three live on the detail page instead.
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { ICON_CHEVRON, ICON_SEARCH, btn, rowMessage, tokenField, typedConfirm } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { deleteSchedulePath, newSchedulePath, schedulePagePath } from "./tabs.ts";

export interface SchedulePageRow {
  project: string;
  entry: ScheduleEntry;
  lastState?: string;
  /** Feeds the "Last run" column's sort key only — the cell's own
   *  displayed text stays `lastState` (2-analysis.md, Findings). */
  lastRunAt?: string;
  outputHref?: string;
}

export interface ScheduleFilter {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

export const SORTS = ["name", "next", "last"];
export const DEFAULT_SORT = "name";
// Each column has the direction you almost always want first: names
// from A, the soonest next run, the most recent last run.
export const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  name: "asc",
  next: "asc",
  last: "desc",
};

const haystack = (r: SchedulePageRow): string => `${r.project}:${r.entry.name}\n${r.entry.prompt}`.toLowerCase();

/** A term of nothing but spaces is no search at all: it must not empty the list. */
export const matchesSearch = (r: SchedulePageRow, f: ScheduleFilter): boolean => {
  const term = (f.q ?? "").trim().toLowerCase();
  return !term || haystack(r).includes(term);
};

export function sortRows(rows: readonly SchedulePageRow[], f: ScheduleFilter, now: Date): SchedulePageRow[] {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: SchedulePageRow): number | string =>
    sort === "next"
      ? (nextFireTime(r.entry.cron, now)?.getTime() ?? Number.MAX_SAFE_INTEGER)
      : sort === "last"
        ? (r.lastRunAt ? Date.parse(r.lastRunAt) : 0)
        : `${r.project}:${r.entry.name}`.toLowerCase();
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number)) * sign;
  });
}

// Real navigation, no `data-nav`: `/schedule` has no `#jobrows`
// live-refresh loop for `swapRows()` to patch (2-analysis.md, Findings
// — reusing the Specs list's `data-nav` links here would prevent the
// click, rewrite the address bar, and never re-render).
function scheduleHref(f: ScheduleFilter, patch: { q?: string; sort?: string; dir?: string }): string {
  const merged = { ...f, ...patch };
  const q = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return esc(q ? `/schedule?${q}` : "/schedule");
}

export interface ScheduleListOptions {
  /** Every allowed project — decides only whether the New-job link is
   *  offered, the same way the Specs list's own New-spec link checks
   *  `createProjects`. */
  projects: readonly string[];
  rows: readonly SchedulePageRow[];
  filter?: ScheduleFilter;
  token?: string;
}

function row(r: SchedulePageRow, now: Date, token?: string): string {
  const next = nextFireTime(r.entry.cron, now);
  const state = r.lastState ?? "never run";
  const output = r.outputHref ? ` — <a href="${esc(r.outputHref)}">output</a>` : "";
  const detailHref = schedulePagePath(r.project, r.entry.name);
  const toggleUrl = `/api/queue/schedule/${encodeURIComponent(r.project)}/${encodeURIComponent(r.entry.name)}/enabled`;
  const runUrl = `/api/queue/schedule/${encodeURIComponent(r.project)}/${encodeURIComponent(r.entry.name)}/run`;
  return (
    `<tr>` +
    // `project:name`, matching the Specs list's own row format — the
    // list is no longer scoped to one project, so the row has to say
    // which one it belongs to.
    `<td><a href="${esc(detailHref)}">${esc(r.project)}:${esc(r.entry.name)}</a></td>` +
    `<td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td>` +
    `<td><span data-schedule-state>${esc(state)}</span>${output}</td>` +
    // A standalone checkbox with no surrounding form, the same shape
    // `postTailStep`'s own tail-step chip has and for the same reason:
    // it does nothing without script, and flips the flag immediately —
    // no confirm — the instant it does (`schedule-actions.ts`).
    `<td><input type="checkbox" class="scheduleenabled"${r.entry.enabled ? " checked" : ""} ` +
    `aria-label="Enabled: ${esc(r.entry.name)}" data-post-to="${esc(toggleUrl)}"></td>` +
    // The page's ordinary button, not a smaller one of its own: this is
    // the row's action, and it stands beside Delete and under Search and
    // New job (asked for 2026-08-31).
    `<td><form method="post" action="${esc(runUrl)}" class="actionform schedulerun">${tokenField(token)}` +
    btn({ label: "Run now", pending: "running…" }) +
    `</form></td>` +
    deleteCell(r, token) +
    `</tr>`
  );
}

// Delete, at the far right of the row it deletes (asked for
// 2026-08-31). It was on the entry's own Edit page, which is the one
// place a reader goes to CHANGE an entry — reaching it meant opening
// the thing you had decided to be rid of.
//
// The control is a LINK to the confirmation page spec 277 already
// built, so a browser with no script keeps exactly the flow it has
// today. With script the click opens that same confirmation over the
// list instead: `<dialog>`, the platform's own modal, the way the
// About box in the header is done — Escape and Cancel close it, and
// nothing is deleted by a stray click on a table row.
//
// What it asks for is the app's own confirmation gate, unchanged: the
// entry's exact name, typed (`typedConfirm`), posted to the same route,
// which refuses anything else. The dialog is a place to answer the
// question, never a lighter question.
function deleteCell(r: SchedulePageRow, token?: string): string {
  const name = r.entry.name;
  const deleteUrl = `/api/queue/schedule/${encodeURIComponent(r.project)}/${encodeURIComponent(name)}/delete`;
  return (
    `<td>` +
    `<a class="btn danger" href="${esc(deleteSchedulePath(r.project, name))}" ` +
    `data-delete-schedule aria-label="Delete ${esc(name)}">Delete</a>` +
    `<dialog class="confirmdialog"><div class="confirmpanel">` +
    `<h2>Delete ${esc(r.project)}:${esc(name)}?</h2>` +
    `<p class="muted">The entry leaves this project's manifest and stops firing. ` +
    `Its own run history stays in the queue.</p>` +
    `<form method="post" action="${esc(deleteUrl)}" class="scheduledeleteform">` +
    tokenField(token) +
    typedConfirm({ target: name, label: "Type the exact name to delete it", button: "Delete", pending: "deleting…" }) +
    `</form>` +
    // The platform's own close: no script, and it works even where the
    // one that opened the box did not run.
    `<form method="dialog"><button class="btn" type="submit">Cancel</button></form>` +
    `</div></dialog></td>`
  );
}

// The one control on this page that is not about an entry that
// exists — offered only when at least one allowed project could hold
// one, the same guard the Specs list's own "New spec" link runs.
function newJobLink(opts: ScheduleListOptions): string {
  if (opts.projects.length === 0) return "";
  // `.schedulenewlink` carries its own right-alignment rule
  // (`rows-and-forms.css`) rather than reusing `.specsearch > .btn.primary`,
  // which would also reach the Specs page's own New-spec link (3-solution.md,
  // Risk 5).
  return `<a class="btn primary schedulenewlink" href="${esc(newSchedulePath())}">New job</a>`;
}

function searchForm(f: ScheduleFilter, opts: ScheduleListOptions): string {
  const keep = (["sort", "dir"] as const)
    .map((k) => (f[k] ? `<input type="hidden" name="${k}" value="${esc(f[k]!)}">` : ""))
    .join("");
  const q = (f.q ?? "").trim();
  return (
    // A plain GET form, like the Specs list's own `.specsearch`: it
    // works with JavaScript switched off, survives a reload and can be
    // pasted to someone else.
    `<form class="specsearch" method="get" action="/schedule">` +
    `<span class="searchfield">` +
    `<span class="icon-search" aria-hidden="true">${ICON_SEARCH}</span>` +
    `<input class="archive-q" type="search" name="q" value="${esc(q)}" ` +
    `placeholder="a project, a name or a prompt path" aria-label="Search the schedule">` +
    (q
      ? `<a class="searchclear" href="${scheduleHref(f, { q: "" })}" ` +
        `title="Clear the search" aria-label="Clear the search">&times;</a>`
      : "") +
    `</span>` +
    keep +
    `<button class="btn" type="submit">Search</button>` +
    newJobLink(opts) +
    `</form>`
  );
}

function sortableHead(f: ScheduleFilter): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const th = (key: string, label: string) => {
    const on = key === sort;
    // Clicking the column you are already sorted by turns it round.
    const next = on ? (dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
    const linkCls = on
      ? dir === "asc"
        ? "sortlink on asc"
        : "sortlink on"
      : SORT_DEFAULT_DIR[key] === "asc"
        ? "sortlink asc"
        : "sortlink";
    const aria = on ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
    return (
      `<th${aria}><a class="${linkCls}" href="${scheduleHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next })}">` +
      `${esc(label)}${ICON_CHEVRON}</a></th>`
    );
  };
  // Two unlabelled columns at the end: Run now, then Delete.
  return (
    `<thead><tr>${th("name", "Name")}${th("next", "Next run")}${th("last", "Last run")}` +
    `<th>Enabled</th><th></th><th></th></tr></thead>`
  );
}

export function renderScheduleList(opts: ScheduleListOptions): string {
  const now = new Date();
  const f = opts.filter ?? {};
  const visible = sortRows(
    opts.rows.filter((r) => matchesSearch(r, f)),
    f,
    now,
  );
  const term = (f.q ?? "").trim();
  const table =
    visible.length === 0
      ? rowMessage("info", opts.rows.length === 0 ? "No schedule entry exists yet." : `No schedule entry matches "${term}".`)
      : `<div class="tablewrap"><table class="list">${sortableHead(f)}<tbody>${visible.map((r) => row(r, now, opts.token)).join("")}</tbody></table></div>`;
  return searchForm(f, opts) + table;
}
