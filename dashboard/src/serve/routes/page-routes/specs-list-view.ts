// The Specs list's view and its answers, for the two addresses that draw
// it: `/specs`, with every row shut, and a spec's own address, with that
// row open and the spec in it. One function builds the view, so the two
// cannot cut and order the list differently.
import {
  ARCHIVED_STATE, renderSpecGroupRows, renderSpecsRows, specPagePath, type QueueRowView, type SpecsPageOptions,
} from "../../../render";
import { languageChoice, sortChoice, specsClientScript, stateChoice } from "../../serve-helpers";
import { listedSpecJobs, specRowOptions } from "./spec-row-options.ts";
import type { RoutesContext } from "..";

export interface SpecsListParts {
  /** Everything the list is drawn from, less the open spec's detail. */
  view: SpecsPageOptions;
  /** The jobs the rows are drawn from. */
  rows: () => Promise<QueueRowView[]>;
  /** The cookies a choice made in the address asks to be remembered. */
  setCookies: string[];
}

/** The list's view for this request. `openKey` is the spec whose row is
 *  open (`project/folder`), absent for a list with every row shut. */
export async function specsListParts(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  openKey?: string,
): Promise<SpecsListParts> {
  // The reader's own choice of language (spec 350), from the address
  // or from the cookie it was last written into — the same shape as
  // the sort/state pair below, with one difference: this always
  // resolves to a concrete language, never `{}`.
  const langResult = languageChoice(url, req);
  const base = specRowOptions(ctx, url, langResult.lang);
  const archivedKeys = base.archived ?? [];
  // spec 406, REQ-7: the closed subset of the same cheap key list, off
  // `ctx.specRef` — the same per-key lookup job-actions.ts already
  // uses, never a second walk.
  const closedKeys = archivedKeys.filter((k) => {
    const cut = k.indexOf("/");
    return ctx.specRef(k.slice(0, cut), k.slice(cut + 1))?.closed;
  });
  // Off the same lookup: the archived specs with a Not verified row,
  // what the Not verified entry's count adds where no row is built.
  const notVerifiedKeys = archivedKeys.filter((k) => {
    const cut = k.indexOf("/");
    const ref = ctx.specRef(k.slice(0, cut), k.slice(cut + 1));
    return (ref?.notVerified ?? 0) + (ref?.failed ?? 0) > 0;
  });
  // The reader's own choice of state, from the address or from the
  // cookie it was last written into (spec 338, mirroring the sort
  // column's own `chosenSort` below).
  const stateResult = stateChoice(url, req, ctx.serverPort());
  const chosenState = stateResult.state;
  // Every archived spec is a row on this list since spec 221 — but
  // only for a reader whose chip asks for one. The builder decides
  // that itself, off the same `filterShowsArchived` the filter's entries are
  // defined by, and the scale question is why: aide alone archives
  // about 150 specs, this page rebuilds itself on every change
  // event on every open tab, and the default view must not pay for
  // a set it does not show.
  let archivedSpecs = ctx.archivedSpecRows(chosenState);
  // The open spec's row is shown whatever the filter: an archived spec the
  // chosen state hides is built alone, so only this address pays for it.
  if (openKey && archivedKeys.includes(openKey) && !archivedSpecs.some((a) => `${a.project}/${a.folder}` === openKey)) {
    const open = ctx.archivedSpecRows(ARCHIVED_STATE).find((a) => `${a.project}/${a.folder}` === openKey);
    if (open) archivedSpecs = [...archivedSpecs, open];
  }
  // The reader's own choice of column, from the address or from the
  // cookie it was last written into.
  const chosenSort = sortChoice(url, req, ctx.serverPort());
  const view: SpecsPageOptions = {
    ...base,
    closed: closedKeys,
    notVerified: notVerifiedKeys,
    currentUrl: langResult.currentUrl,
    // Spec 506: the creates that ended without a spec and were not
    // dismissed — a message each, above the filter bar.
    failedCreates: ctx.push.failedCreates.list(),
    archivedSpecs,
    script: await specsClientScript(),
    // The raw allowlist, not the discovered set: a project whose
    // FIRST spec this form exists to make has nothing on disk to be
    // discovered from, so deriving these from `targets()` would
    // leave it out of the one dropdown it needs to be in. Every
    // other list on this page stays derived, because every other
    // control is about a spec that already exists.
    createProjects: [...ctx.allowed].sort(),
    // Straight from the query string: how the list is cut and
    // ordered lives in the URL, so it survives a reload and can be
    // sent to someone else. Nothing here is trusted — the renderer
    // falls back to its defaults for anything it does not know.
    //
    // The SORT alone falls back to what the reader last chose
    // (`sortChoice`) rather than to the renderer's default: every
    // other part of the filter is set from a control on this page
    // and read back off the same address, but the sort is thrown
    // away by every plain link to `/` there is.
    filter: {
      ...base.filter,
      state: chosenState,
      project: url.searchParams.get("project") ?? undefined,
      sort: chosenSort.sort,
      dir: chosenSort.dir,
      // The search term (spec 221), a query-string citizen like the
      // rest of the view — so it survives a reload, can be pasted to
      // someone else, and rides along on the SSE-driven row swap,
      // which sends `location.search` back verbatim.
      q: url.searchParams.get("q") ?? undefined,
    },
    // One row open at most, the one the address names. The folds inside its
    // row lead to that address, so they keep the row open.
    openSpec: { key: openKey },
    listPath: openKey ? specPagePath(openKey.slice(0, openKey.indexOf("/")), openKey.slice(openKey.indexOf("/") + 1)) : undefined,
  };
  // Only the projects the queue may run. A project taken out of the
  // allowlist keeps its jobs in the history (and in /api/queue), but
  // a row for it could only offer a Run that would be refused.
  // A schedule job is not a spec and a wiki build is no spec either
  // (`listedSpecJobs`).
  const listed = listedSpecJobs(ctx, ctx.queue.list());
  return {
    view,
    rows: () => Promise.all(listed.map(ctx.jobRow)),
    setCookies: [chosenSort.setCookie, stateResult.setCookie, langResult.setCookie].filter((c): c is string => !!c),
  };
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
