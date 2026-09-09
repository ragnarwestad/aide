// The board-wide overview (spec 425, REQ-3/REQ-4): every test server
// tracked ANYWHERE on this machine, in one place — a spec's own page
// only ever showed the one it belongs to, and there was nowhere at all
// to see the three-port pool as a whole. Modeled on `settings-page.ts`,
// the one existing precedent for "a global, token-guarded page with a
// table of rows", and reached the same way Settings is: the "…" menu.

import { pageShell, type NavEntry } from "../ui/shell.ts";
import { backLink, tokenField } from "../ui/components.ts";
import { esc } from "../ui/html.ts";
import type { Language } from "../../i18n";

export const TEST_SERVERS_ROUTE = "/test-servers";

/** One tracked board, already resolved into what a row needs to draw —
 *  the route handler builds this off `BoardStore.listAll()` plus each
 *  entry's own spec path; this module only ever draws what it is given. */
export interface TestServerRow {
  project: string;
  specFolder: string;
  specHref: string;
  branch: string;
  // The same literal union `BoardStatusView` (spec-page/types.ts) already
  // duplicates rather than importing `BoardStatus` from `boards/store.ts`
  // — this module lives under `render/`, which never imports from
  // `serve/` (`test/guards/no-upward-imports-of-serve.test.ts`).
  status: "starting" | "running" | "failed";
  url?: string;
  stopAction: string;
}

export interface TestServersPageOptions {
  token?: string;
  backHref?: string;
  lang?: Language;
}

// REQ-4's own text is unconditional ("Hver testserver... skal ha en
// Stop-knapp") — a stuck "starting" entry holds a port exactly as a
// "running" one does, and a "failed" entry otherwise has no way to be
// cleared from this page at all, so every row gets the same form
// regardless of status (Plan review, Scope guardian must-fix).
const row = (r: TestServerRow, token?: string): string => {
  const address =
    r.status === "running" && r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>`
      : `<span class="muted">—</span>`;
  return (
    `<tr>` +
    `<td>${esc(r.project)}</td>` +
    `<td><a href="${esc(r.specHref)}">${esc(r.specFolder)}</a></td>` +
    `<td>${esc(r.branch)}</td>` +
    `<td>${esc(r.status)}</td>` +
    `<td>${address}</td>` +
    `<td><form class="actionform" method="post" action="${esc(r.stopAction)}">` +
    tokenField(token) +
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
    : `<main>${back}<table class="settingstable"><thead><tr>` +
      `<th>Project</th><th>Spec</th><th>Branch</th><th>Status</th><th>Address</th><th></th>` +
      `</tr></thead><tbody>${rows.map((r) => row(r, opts.token)).join("")}</tbody></table></main>`;
  return pageShell("Test servers", entries, TEST_SERVERS_ROUTE, body, generatedAt, undefined, {
    hideHeading: true, hideTabBar: true, lang: opts.lang,
  });
}
