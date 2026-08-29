// The queue surface's path/token guard — pulled out of `createServer`'s
// closure the same way the earlier clusters were (spec: split serve.ts,
// step 5). Small and self-contained: neither function reads a `let`, so
// there is no getter/accessor dance here, unlike `schedules.ts` beside it.

import { NEW_SPEC_ROUTE, PROJECTS_ROUTE, SCHEDULE_ROUTE, SETTINGS_ROUTE } from "../render.ts";
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
  // The aggregate Schedule page (spec 272) and the output it links to —
  // traffic-analysis output (visit counts, error rates) is exactly the
  // sort of thing that must not be readable by anyone who merely
  // guesses or is handed the URL.
  path === SCHEDULE_ROUTE ||
  path.startsWith("/schedule-output/") ||
  path === "/queue" ||
  path === "/specs" ||
  path === "/api/queue" ||
  path.startsWith("/api/queue/") ||
  path.startsWith("/queue/") ||
  path.startsWith("/specs/");

/** The WHOLE queue surface is behind the token, read routes included:
 *  a token that a page hands to anyone who can load the page is not a
 *  secret. `POST /api/aide-run` is exempt on purpose — spec 80's
 *  emitter sends no credential and swallows the answer, so a 401 there
 *  would silently empty /live. */
export function queueGuard(req: Request, url: URL, queueToken: string | undefined): Response | null {
  if (!queueToken) {
    return new Response("the queue is off: no token is configured on this server\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const provided =
    req.headers.get("x-aide-token") ??
    url.searchParams.get("token") ??
    cookieValue(req.headers.get("cookie"), "aide_token");
  if (tokenMatches(provided, queueToken)) return null;
  return new Response(
    "unauthorized\n\n" +
      "This needs its token. Open /?token=<the token> once and the\n" +
      "browser keeps it in a cookie; API callers send it as X-Aide-Token.\n" +
      "The token lives in the file this server was started with.\n",
    { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
