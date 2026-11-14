// The board-wide overview: every test server
// tracked ANYWHERE on this machine, in one place — a spec's own page
// only ever showed the one it belongs to, and there was nowhere at all
// to see the three-port pool as a whole. Modeled on `settings-page.ts`,
// the one existing precedent for "a global page with a
// table of rows", and reached the same way Settings is: the "…" menu.

import { isSpecFolder } from "../../project/spec-names.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { askButton, backLink, buttonForm, messageSlot, progressDialog } from "../ui/components";
import { esc } from "../ui/html.ts";
import { t, type Language } from "../../i18n";

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
  /** The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** `specsClientScript()` — what turns Stop into an XHR that removes
   *  its own row instead of reloading the page. Optional so
   *  a caller that wants the no-script fallback alone can leave it out. */
  script?: string;
}

// Every test server has a Stop button, unconditionally — a stuck "starting" entry holds a port exactly as a
// "running" one does, and a "failed" entry otherwise has no way to be
// cleared from this page at all, so every row gets the same form
// regardless of status.
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

/** A board's status in the reader's language: its own word while it starts,
 *  a job state's word once it runs or has failed. */
const STATUS_KEYS = { starting: "testServers.starting", running: "state.running", failed: "state.failed" } as const;

const row = (r: TestServerRow, lang: Language): string => {
  const address =
    r.status === "running" && r.url
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(addressText(r.url))}</a>`
      : `<span class="muted">—</span>`;
  return (
    `<tr>` +
    `<td data-col="ts-project">${esc(r.project)}</td>` +
    // A board tracked under a non-spec key (`MAIN_TEST_SERVER_KEY`) has no
    // spec page to link to.
    `<td data-col="ts-spec">${isSpecFolder(r.specFolder) ? `<a href="${esc(r.specHref)}">${esc(r.specFolder)}</a>` : esc(r.specFolder)}</td>` +
    `<td data-col="ts-branch">${esc(r.branch)}</td>` +
    `<td data-col="ts-status">${esc(t(lang, STATUS_KEYS[r.status]))}</td>` +
    `<td data-col="ts-address">${address}</td>` +
    `<td data-col="ts-stop">` +
    buttonForm({ action: r.stopAction, hook: "actionform", button: { label: t(lang, "jobs.stop") }, after: messageSlot("refused") }) +
    `</td>` +
    `</tr>`
  );
};

export function renderTestServersPage(
  entries: NavEntry[],
  generatedAt: string,
  rows: TestServerRow[],
  opts: TestServersPageOptions = {},
): string {
  const lang = opts.lang ?? "en";
  const back = backLink(opts.backHref ?? "/", t(lang, "shell.testServers"), "", { lang });
  // Clean up asks first, as Deploy does, and its OK queues the cleanup job.
  const cleanup = askButton({ label: t(lang, "testServers.cleanUp"), dialogId: "cleanupask" }) +
    progressDialog(lang, {
      id: "cleanupask",
      title: t(lang, "testServers.cleanUpTitle"),
      ask: {
        title: t(lang, "testServers.cleanUpAskTitle"),
        sentence: t(lang, "testServers.cleanUpAskSentence"),
        ok: { variant: "primary", pending: t(lang, "testServers.cleanUpTitle") },
        post: { action: "/api/queue/cleanup" },
        queuesJob: true,
      },
    });
  // This codebase's own "nothing to show, show nothing" rule: most of
  // the time no board is running at all, and an empty table reads as
  // broken rather than as the ordinary case.
  // No `<main>` of its own: `pageShell` already wraps the body in one, and
  // a second inside it took the frame's padding twice — the table then sat
  // 32 px inside the frame every other page's content lines up with.
  const body = !rows.length
    ? `${back}${cleanup}<p class="muted">${esc(t(lang, "testServers.none"))}</p>`
    // The submit listener's delegation anchor (specs-client/index.ts) —
    // the same role `#jobrows` plays for the specs list.
    : `${back}${cleanup}<div id="test-servers-rows" class="tablewrap"><table class="list testservers">` +
      `<colgroup>${COLUMNS.map((c) => `<col data-col="${c}">`).join("")}</colgroup><thead><tr>` +
      th("ts-project", esc(t(lang, "testServers.colProject"))) + th("ts-spec", esc(t(lang, "testServers.colSpec"))) +
      th("ts-branch", esc(t(lang, "testServers.colBranch"))) + th("ts-status", esc(t(lang, "testServers.colStatus"))) +
      th("ts-address", esc(t(lang, "testServers.colAddress"))) + th("ts-stop", "") +
      `</tr></thead><tbody>${rows.map((r) => row(r, lang)).join("")}</tbody></table></div>`;
  return pageShell(t(lang, "shell.testServers"), entries, TEST_SERVERS_ROUTE, body, generatedAt, {
    hideHeading: true, hideTabBar: true, lang, currentUrl: opts.currentUrl, script: opts.script,
  });
}
