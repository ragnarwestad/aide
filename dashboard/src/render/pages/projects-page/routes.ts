// The site's nav and its routes' paths.

import type { NavEntry } from "../../ui/shell.ts";
import { SCHEDULE_ROUTE } from "../schedule-page";

// The nav entries for a project set — shared by the generator and the
// live server when it was started with a `--root` of its own.
//
// The Projects entry points at the SERVED page (spec 115), not at the
// generated file: the page that lists the projects is the page that adds
// and removes them, and that needs a server behind it.
export function navEntries(): NavEntry[] {
  return [
    { label: "Projects", path: PROJECTS_ROUTE },
    // The aggregate Schedule page (spec 272): every allowed project's
    // scheduled jobs in one table, the same single-aggregate shape
    // Projects took after the tab-per-project removal below — never one
    // tab per project.
    { label: "Schedule", labelKey: "shell.tabSchedule", path: SCHEDULE_ROUTE },
    // An Archive tab stood here from spec 163 until spec 221. Every
    // archived spec is a row on the Specs list now, one chip away, with
    // its date, its description, its "not landed" mark and the same
    // search the tab had — so a second place to read the same thing was
    // a second place to keep in step with it.
    // A tab per project stood here, from the days this was a generated
    // site with a page per project and no server (aide-dashboard spec
    // 01). A project is reached from the Projects page now, which lists
    // every one with its counts, its warnings and its controls, so the
    // tabs said each project twice and the bar grew with the machine's
    // project count (2026-08-22).
  ];
}

/** The address people bookmarked before the overview became a served
 *  route (spec 115). `core-routes.ts` answers `/projects.html` with a
 *  redirect to `PROJECTS_ROUTE`, in server code, with no file behind it
 *  (spec 530) — the literal there, not this constant, since the route
 *  scanner behind `docs/http-routes.md`'s guard test reads a `path ===`
 *  check by its own literal or a plain constant name, not a
 *  concatenation. */
export const OVERVIEW_PAGE = "projects.html";

/** Where the overview actually lives (spec 115): a served route, so the
 *  Add and Remove controls on it have a server to post to. */
export const PROJECTS_ROUTE = "/projects";

/** Where a spec is made (spec 121). It was a disclosure folded into the
 *  spec list until the button that opened it became a link to here. */
export const NEW_SPEC_ROUTE = "/new";

/** Where a project's own page is SERVED (spec 185) — the only one there
 *  is. A generated `<slug>.html` beside it was written until then, and
 *  went because a frozen copy could not answer what the config file says
 *  right now, while sitting one tab away from the page that could. */
export const projectPagePath = (name: string): string => `/projects/${encodeURIComponent(name)}`;
