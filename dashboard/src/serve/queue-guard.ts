// Which paths are the queue surface, and whether a bind address is
// loopback — pulled out of `createServer`'s closure the same way the
// earlier clusters were (spec: split serve.ts, step 5). Small and
// self-contained: neither function reads a `let`, so there is no
// getter/accessor dance here, unlike `schedules.ts` beside it.

import { NEW_SPEC_ROUTE, PROJECTS_ROUTE, SCHEDULE_ROUTE, SETTINGS_ROUTE, TEST_SERVERS_ROUTE } from "../render";

/** `/specs/<id>` joins the queue set HERE, never as a special case
 *  further down, so `handleRoutes` is what answers it. The retired
 *  `/queue` paths are in it too, for the redirect they answer with. */
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
  // reason: it carries a real form.
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
  // A device turning notifications on or off (spec 501): a POST that
  // changes what the server sends and where, guarded like every other.
  path.startsWith("/api/push/") ||
  path.startsWith("/specs/") ||
  // The test board's own Stop control (spec 424, REQ-4) — a POST with
  // real consequences, guarded exactly like every other queue route.
  path === "/api/self-stop" ||
  // And its Run control (2026-09-11), on the same terms.
  path === "/api/self-run";

/** Whether a bind address is loopback-only — the one address a header
 *  set by a proxy in front of this process cannot be forged on, since
 *  nothing else can reach the port at all (spec 363). */
export const isLoopbackBind = (host: string | undefined): boolean =>
  host === "127.0.0.1" || host === "::1";
