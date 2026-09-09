// The queue surface's path/token guard — pulled out of `createServer`'s
// closure the same way the earlier clusters were (spec: split serve.ts,
// step 5). Small and self-contained: neither function reads a `let`, so
// there is no getter/accessor dance here, unlike `schedules.ts` beside it.

import { NEW_SPEC_ROUTE, PROJECTS_ROUTE, SCHEDULE_ROUTE, SETTINGS_ROUTE, TEST_SERVERS_ROUTE } from "../render.ts";
import { cookieValue, tokenMatches } from "./serve-helpers.ts";

/** `/specs/<id>` joins the guarded set HERE, never as a special case
 *  further down: a read route outside the guard is exactly the silent
 *  bypass this check exists to prevent. The retired `/queue` paths are
 *  guarded too — a redirect that answers before the token is checked
 *  would tell an unauthenticated caller the page exists. */
export const isQueuePath = (path: string) =>
  path === "/" ||
  // The overview is a served page since spec 115, and it carries the
  // Add and Remove forms — so it is guarded exactly as `/` is. The
  // GENERATED `projects.html` stays outside the guard, as every
  // generated page does: it is a redirect and carries nothing.
  path === PROJECTS_ROUTE ||
  // The Add and Remove pages carry real forms too (2026-08-19).
  path.startsWith("/projects/") ||
  // And the New-spec form's own page (spec 121), for the same
  // reason: it carries a real form, and a form's token has to be
  // checked per request.
  path === NEW_SPEC_ROUTE ||
  path === SETTINGS_ROUTE ||
  // The board-wide overview (spec 425, REQ-3/REQ-4) carries a live Stop
  // control and every project's branch names — guarded exactly like
  // Settings beside it.
  path === TEST_SERVERS_ROUTE ||
  // The aggregate Schedule page (spec 272) and the output it links to —
  // traffic-analysis output (visit counts, error rates) is exactly the
  // sort of thing that must not be readable by anyone who merely
  // guesses or is handed the URL.
  path === SCHEDULE_ROUTE ||
  // An entry's own detail page and the New-job page (spec 276) — both
  // carry real forms (the Edit section, the create form), guarded per
  // request exactly as the Add/Remove project pages are.
  path.startsWith("/schedule/") ||
  path.startsWith("/schedule-output/") ||
  path === "/queue" ||
  path === "/specs" ||
  path === "/api/queue" ||
  path.startsWith("/api/queue/") ||
  path.startsWith("/queue/") ||
  path.startsWith("/specs/") ||
  // The test board's own Stop control (spec 424, REQ-4) — a POST with
  // real consequences, guarded exactly like every other queue route.
  path === "/api/self-stop";

/** Whether a bind address is loopback-only — the one address a header
 *  set by a proxy in front of this process cannot be forged on, since
 *  nothing else can reach the port at all (spec 363). */
export const isLoopbackBind = (host: string | undefined): boolean =>
  host === "127.0.0.1" || host === "::1";

/** The WHOLE queue surface is behind the token, read routes included:
 *  a token that a page hands to anyone who can load the page is not a
 *  secret. `POST /api/aide-run` is exempt on purpose — spec 80's
 *  emitter sends no credential and swallows the answer, so a 401 there
 *  would silently empty /live.
 *
 *  `port` names this server's own token cookie (spec 363): two boards
 *  on one host share ONE cookie jar for `127.0.0.1`, so an unqualified
 *  name would let whichever board answered last overwrite the other's
 *  cookie — an old, unversioned `aide_token` cookie is therefore never
 *  read here, on purpose, even if its value would have matched.
 *
 *  `headerAuth`, when given, is checked FIRST and can admit a request
 *  with no token and no cookie at all — a header-only deployment (no
 *  token file configured) must still work. The caller has already
 *  refused to start unless the server binds loopback whenever
 *  `headerAuth` is set (`createServer`), so honoring it here never
 *  trusts a header a stranger could have set. */
export function queueGuard(
  req: Request,
  url: URL,
  queueToken: string | undefined,
  port: number,
  headerAuth?: { header: string; users: string[] },
): Response | null {
  if (headerAuth) {
    const claimed = req.headers.get(headerAuth.header);
    if (claimed && headerAuth.users.includes(claimed)) return null;
  }
  if (!queueToken) {
    return new Response("the queue is off: no token is configured on this server\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const provided =
    req.headers.get("x-aide-token") ??
    url.searchParams.get("token") ??
    cookieValue(req.headers.get("cookie"), `aide_token_${port}`);
  if (tokenMatches(provided, queueToken)) return null;
  return new Response(
    "unauthorized\n\n" +
      "This needs its token. Open /?token=<the token> once and the\n" +
      "browser keeps it in a cookie; API callers send it as X-Aide-Token.\n" +
      "The token lives in the file this server was started with.\n",
    { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
