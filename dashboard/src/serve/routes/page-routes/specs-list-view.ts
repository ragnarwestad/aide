import { groupBySpec, groupKey, applyFilter, sortGroups } from "../../../render/pages/specs-list/data-model";
import { firstActionLabel } from "../../../render/pages/specs-list/head-row.ts";
import { requestWindow, summaryJob, listSnapshot } from "../../list-window";
// The Specs list's view and its answers, for the two addresses that draw
// it: `/specs`, with every row shut, and a spec's own address, with that
// row open and the spec in it. One function builds the view, so the two
// cannot cut and order the list differently.
import {
  ARCHIVED_STATE, renderSpecGroupRows, renderSpecsRows, specPagePath, type QueueRowView, type SpecsPageOptions,
} from "../../../render";
import { languageChoice, sortChoice, specsClientScript, stateChoice } from "../../serve-helpers";
import { listedSpecJobs, specRowOptions } from "./spec-row-options.ts";
import { projectChoices } from "./project-pin.ts";
import type { RoutesContext } from "..";

export interface SpecsListParts {
  /** Everything the list is drawn from, less the open spec's detail. */
  view: SpecsPageOptions;
  /** The jobs the rows are drawn from. */
  rows: () => Promise<QueueRowView[]>;
  /** The cookies a choice made in the address asks to be remembered. */
  setCookies: string[];
}

/** The key a request asks one row for: `only` in a rows answer, the spec's
 *  own key (`detailKey`) for the spec opened in place, and none for a request
 *  that draws the whole list. */
export function oneRowKey(url: URL, detailKey?: string): string | undefined {
  if (url.searchParams.get("rows")) return url.searchParams.get("only") || undefined;
  return url.searchParams.get("detail") === "1" ? detailKey : undefined;
}

/** The list's view for this request. `openKey` is the spec whose row is
 *  open (`project/folder`), absent for a list with every row shut. `only`
 *  is the one row the request asks for (`oneRowKey`): with it the parts hold
 *  what that row is built from and nothing for any other row, and the two
 *  lists the filter bar counts by are empty, since no row reads them. */
export async function specsListParts(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  openKey?: string,
  only?: string,
  retry = true,
): Promise<SpecsListParts> {
  // The reader's own choice of language, from the address
  // or from the cookie it was last written into — the same shape as
  // the sort/state pair below, with one difference: this always
  // resolves to a concrete language, never `{}`.
  const langResult = languageChoice(url, req);
  const base = specRowOptions(ctx, url, langResult.lang);
  const jobs = ctx.queue.list();
  const unchanged = listSnapshot(ctx, jobs);
  const archivedKeys = base.archived ?? [];
  // The archived keys the filter bar counts by; none where one row is asked for.
  const counted = only ? [] : archivedKeys;
  // The keys every read of the archive below is cut to; absent, it reads them all.
  const keys = only ? new Set([only]) : undefined;
  const { closedKeys, notVerifiedKeys } = countedArchivedKeys(ctx, counted);
  // The reader's own choice of state, from the address or from the
  // cookie it was last written into (mirroring the sort
  // column's own `chosenSort` below).
  const stateResult = stateChoice(url, req, ctx.serverPort());
  const chosenState = stateResult.state;
  const archivedSpecs = oneRowArchivedSpecs(ctx, url, chosenState, archivedKeys, keys, openKey, only);
  // The reader's own choice of column, from the address or from the
  // cookie it was last written into.
  const chosenSort = sortChoice(url, req, ctx.serverPort());
  const view = await listView(ctx, base, {
    closedKeys, notVerifiedKeys, currentUrl: langResult.currentUrl, archivedSpecs,
    filter: listFilter(url, base, chosenState, chosenSort), openKey,
  });
  // Only the projects the queue may run. A project taken out of the
  // allowlist keeps its jobs in the history (and in /api/queue), but
  // a row for it could only offer a Run that would be refused.
  // A schedule job is not a spec (`listedSpecJobs`).
  const every = listedSpecJobs(ctx, jobs);
  const selected = only ? keys : selectWindow(ctx, url, view, base, every, openKey);
  const listed = every.filter((job) => !selected || selected.has(`${job.project}/${job.specFolder}`));
  return {
    view,
    rows: async () => {
      const rows = await Promise.all(listed.map(ctx.jobRow));
      if (unchanged()) return rows;
      if (!retry) throw new Error("List changed again; refresh the list.");
      const fresh = await specsListParts(ctx, req, url, openKey, only, false);
      const selectedRows = await fresh.rows();
      Object.assign(view, fresh.view);
      return selectedRows;
    },
    setCookies: [chosenSort.setCookie, stateResult.setCookie, langResult.setCookie].filter((c): c is string => !!c),
  };
}

/** Everything the list is drawn from, off the row options both pages share. */
async function listView(
  ctx: RoutesContext,
  base: SpecsPageOptions,
  parts: {
    closedKeys: string[];
    notVerifiedKeys: string[];
    currentUrl: string;
    archivedSpecs: NonNullable<SpecsPageOptions["archivedSpecs"]>;
    filter: SpecsPageOptions["filter"];
    openKey: string | undefined;
  },
): Promise<SpecsPageOptions> {
  const { openKey } = parts;
  return {
    ...base,
    closed: parts.closedKeys,
    notVerified: parts.notVerifiedKeys,
    currentUrl: parts.currentUrl,
    // The creates that ended without a spec and were not
    // dismissed — a message each, above the filter bar.
    failedCreates: ctx.push.failedCreates.list(),
    archivedSpecs: parts.archivedSpecs,
    script: await specsClientScript(),
    // The raw allowlist, not the discovered set: a project whose
    // FIRST spec this form exists to make has nothing on disk to be
    // discovered from, so deriving these from `targets()` would
    // leave it out of the one dropdown it needs to be in. Every
    // other list on this page stays derived, because every other
    // control is about a spec that already exists.
    createProjects: projectChoices(ctx),
    filter: parts.filter,
    // One row open at most, the one the address names. The folds inside its
    // row lead to that address, so they keep the row open.
    openSpec: { key: openKey },
    pdfAvailable: ctx.pdfToolAvailable,
    listPath: openKey ? specPagePath(openKey.slice(0, openKey.indexOf("/")), openKey.slice(openKey.indexOf("/") + 1)) : undefined,
  };
}

/** The closed subset of the archived keys, off `ctx.specRef` — the same
 *  per-key lookup job-actions.ts already uses, never a second walk — and,
 *  off the same lookup, the archived specs with a Not verified row: what the
 *  Not verified entry's count adds where no row is built. */
function countedArchivedKeys(ctx: RoutesContext, counted: string[]): { closedKeys: string[]; notVerifiedKeys: string[] } {
  const closedKeys = counted.filter((k) => {
    const cut = k.indexOf("/");
    return ctx.specRef(k.slice(0, cut), k.slice(cut + 1))?.closed;
  });
  const notVerifiedKeys = counted.filter((k) => {
    const cut = k.indexOf("/");
    const ref = ctx.specRef(k.slice(0, cut), k.slice(cut + 1));
    return (ref?.notVerified ?? 0) + (ref?.failed ?? 0) > 0;
  });
  return { closedKeys, notVerifiedKeys };
}

/** The archived rows a one-row request is built with; none for the whole
 *  list, which reads them once its window is chosen.
 *
 *  Every archived spec is a row on this list — but only for a reader whose
 *  chip asks for one. The builder decides that itself, off the same
 *  `filterShowsArchived` the filter's entries are defined by, and the scale
 *  question is why: aide alone archives about 150 specs, this page rebuilds
 *  itself on every change event on every open tab, and the default view must
 *  not pay for a set it does not show. An open archived spec the state hides
 *  is still built, as its own row. */
function oneRowArchivedSpecs(
  ctx: RoutesContext,
  url: URL,
  chosenState: string | undefined,
  archivedKeys: string[],
  keys: Set<string> | undefined,
  openKey: string | undefined,
  only: string | undefined,
): NonNullable<SpecsPageOptions["archivedSpecs"]> {
  const archivedState = (url.searchParams.get("q") ?? "").trim() ? "all" : chosenState;
  const archivedSpecs = only ? ctx.archivedSpecRows(archivedState, keys) : [];
  if (only && openKey && archivedKeys.includes(openKey) && !archivedSpecs.some((a) => `${a.project}/${a.folder}` === openKey)) {
    return ctx.archivedSpecRows(ARCHIVED_STATE, new Set([openKey]));
  }
  return archivedSpecs;
}

/** Straight from the query string: how the list is cut and ordered lives in
 *  the URL, so it survives a reload and can be sent to someone else. Nothing
 *  here is trusted — the renderer falls back to its defaults for anything it
 *  does not know.
 *
 *  The SORT alone falls back to what the reader last chose (`sortChoice`)
 *  rather than to the renderer's default: every other part of the filter is
 *  set from a control on this page and read back off the same address, but
 *  the sort is thrown away by every plain link to `/` there is. */
function listFilter(
  url: URL,
  base: SpecsPageOptions,
  chosenState: string | undefined,
  chosenSort: ReturnType<typeof sortChoice>,
): SpecsPageOptions["filter"] {
  return {
    ...base.filter,
    state: chosenState,
    sort: chosenSort.sort,
    dir: chosenSort.dir,
    // The search term, a query-string citizen like the
    // rest of the view — so it survives a reload, can be pasted to
    // someone else, and rides along on the SSE-driven row swap,
    // which sends `location.search` back verbatim.
    q: url.searchParams.get("q") ?? undefined,
  };
}

/** The window of rows the whole list draws: the summaries filtered, ordered
 *  and cut as the address asks, with every opened row kept in it. Sets the
 *  view's selection, summaries and archived rows, and answers the keys of
 *  the rows selected. */
function selectWindow(
  ctx: RoutesContext,
  url: URL,
  view: SpecsPageOptions,
  base: SpecsPageOptions,
  every: ReturnType<RoutesContext["queue"]["list"]>,
  openKey: string | undefined,
): Set<string> {
  const waiting = ctx.queue.waiting.snapshot().entries;
  const summaries = groupBySpec(every.map(job => summaryJob(job, waiting)), base.targets, base.archived, ctx.archivedSpecSummaries?.() ?? [], Date.now(), undefined, base.executionGroups, true);
  const f = view.filter ?? {};
  const normalized = view.openSpec && (f.sort === "started" || f.sort === "cost") ? { ...f, sort: "created", dir: undefined } : f;
  summaries.sort((a, b) => groupKey(a.project, a.specFolder).localeCompare(groupKey(b.project, b.specFolder)));
  const matches = applyFilter(summaries, normalized);
  const opened = new Set([...(normalized.open ?? "").split(",").filter(Boolean), ...(openKey ? [openKey] : [])]);
  const ordered = sortGroups(matches, normalized, (group) => firstActionLabel(group, view), view.lang ?? "en");
  view.selection = requestWindow(ordered.map((group) => ({ key: groupKey(group.project, group.specFolder) })), url, normalized, opened);
  for (const group of summaries) {
    const key = groupKey(group.project, group.specFolder);
    if (opened.has(key) && !view.selection.rows.some((row) => row.key === key)) view.selection.rows.push({ key });
  }
  view.summaryGroups = summaries;
  const selected = new Set(view.selection.rows.map((row) => row.key));
  view.archivedSpecs = ctx.archivedSpecRows("all", selected);
  return selected;
}

/** The headers of an HTML answer, with the cookies the request's choices ask for. */
export function listHeaders(parts: SpecsListParts): Headers {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const cookie of parts.setCookies) headers.append("set-cookie", cookie);
  return headers;
}

/** The rows alone (`?rows=1`): the page swaps them from script every few
 *  seconds, so a half-filled form is never wiped by a refresh. The sort
 *  cookie is written here as well as on the whole page, and this is the one
 *  that matters: pressing a column heading never reloads the page, so a
 *  cookie set only on the full page would never be written by the very act
 *  of choosing. `only` is the one spec a › opened or shut, so the page
 *  swaps that row and not the whole list. */
export async function specsRowsAnswer(parts: SpecsListParts, url: URL): Promise<Response> {
  const rows = await parts.rows();
  const only = url.searchParams.get("only");
  return new Response(only ? renderSpecGroupRows(rows, parts.view, only) : renderSpecsRows(rows, parts.view), {
    headers: listHeaders(parts),
  });
}
