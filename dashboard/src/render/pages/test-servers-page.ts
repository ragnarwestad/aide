// The board-wide overview (spec 425, REQ-3/REQ-4): every test server
// tracked ANYWHERE on this machine, in one place — a spec's own page
// only ever showed the one it belongs to, and there was nowhere at all
// to see the three-port pool as a whole. Modeled on `settings-page.ts`,
// the one existing precedent for "a global page with a
// table of rows", and reached the same way Settings is: the "…" menu.

import { isSpecFolder, pageShell, type NavEntry } from "../ui/shell.ts";
import { backLink } from "../ui/components";
import { esc } from "../ui/html.ts";
import type { Language } from "../../i18n";

export const TEST_SERVERS_ROUTE = "/test-servers";

/** One tracked board, already resolved into what a row needs to draw —
 *  the route handler builds this off `TestServerStore.listAll()` plus each
 *  entry's own spec path; this module only ever draws what it is given. */
export interface TestServerRow {
  project: string;
  specFolder: string;
  specHref: string;
  branch: string;
  // The same literal union `TestServerStatusView` (spec-page/types.ts) already
  // duplicates rather than importing `TestServerStatus` from `test-servers/store.ts`
  // — this module lives under `render/`, which never imports from
  // `serve/` (`test/guards/no-upward-imports-of-serve.test.ts`).
  status: "starting" | "running" | "failed";
  url?: string;
  stopAction: string;
}

export interface TestServersPageOptions {
  backHref?: string;
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
}

// REQ-4's own text is unconditional ("Hver testserver... skal ha en
// Stop-knapp") — a stuck "starting" entry holds a port exactly as a
// "running" one does, and a "failed" entry otherwise has no way to be
// cleared from this page at all, so every row gets the same form
// regardless of status (Plan review, Scope guardian must-fix).
// The link shows the address's host and port, never its scheme, path or
// token; a string that does not parse is shown as it is.
const addressText = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// The columns have names of their own (`ts-*`), so no rule written for the
// specs list's `data-col`s reaches this table.
const COLUMNS = ["ts-project", "ts-spec", "ts-branch", "ts-status", "ts-address", "ts-stop"] as const;
const th = (col: (typeof COLUMNS)[number], label: string): string => `<th data-col="${col}">${label}</th>`;

const row = (r: TestServerRow): string => {
  const address =
    r.status === "running" && r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(addressText(r.url))}</a>`
      : `<span class="muted">—</span>`;
  return (
    `<tr>` +
    `<td data-col="ts-project">${esc(r.project)}</td>` +
    // AC-7: a board tracked under a non-spec key (`MAIN_TEST_SERVER_KEY`) has no
    // spec page to link to.
    `<td data-col="ts-spec">${isSpecFolder(r.specFolder) ? `<a href="${esc(r.specHref)}">${esc(r.specFolder)}</a>` : esc(r.specFolder)}</td>` +
    `<td data-col="ts-branch">${esc(r.branch)}</td>` +
    `<td data-col="ts-status">${esc(r.status)}</td>` +
    `<td data-col="ts-address">${address}</td>` +
    `<td data-col="ts-stop"><form class="actionform" method="post" action="${esc(r.stopAction)}">` +
    `<button class="btn" type="submit">Stop</button></form></td>` +
    `</tr>`
  );
};

export function renderTestServersPage(
  entries: NavEntry[],
  generatedAt: string,
  rows: TestServerRow[],
  opts: TestServersPageOptions = {},
): string {
  const back = backLink(opts.backHref ?? "/", "Test servers");
  // This codebase's own "nothing to show, show nothing" rule: most of
  // the time no board is running at all, and an empty table reads as
  // broken rather than as the ordinary case.
  const body = !rows.length
    ? `<main>${back}<p class="muted">No test server is running right now.</p></main>`
    : `<main>${back}<div class="tablewrap"><table class="list testservers">` +
      `<colgroup>${COLUMNS.map((c) => `<col data-col="${c}">`).join("")}</colgroup><thead><tr>` +
      th("ts-project", "Project") + th("ts-spec", "Spec") + th("ts-branch", "Branch") +
      th("ts-status", "Status") + th("ts-address", "Address") + th("ts-stop", "") +
      `</tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div></main>`;
  return pageShell("Test servers", entries, TEST_SERVERS_ROUTE, body, generatedAt, undefined, {
    hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
