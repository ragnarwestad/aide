// The site's nav and its routes' paths. Split out of site.ts by theme
// (split site.ts by theme).

import type { NavEntry } from "../../ui/shell.ts";

// The nav entries for a project set — shared by the generator and the
// live server when it was started with a `--root` of its own.
//
// The Projects entry points at the SERVED page (spec 115), not at the
// generated file: the page that lists the projects is the page that adds
// and removes them, and that needs a server behind it. `navFromSite()`
// in serve.ts is the no-`--root` fallback and deliberately still names
// the file — it has no project set to link the served page's contents
// from.
export function navEntries(): NavEntry[] {
  return [
    { label: "Projects", path: PROJECTS_ROUTE },
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

/** The generated pages that are not projects. The server's fallback
 *  nav reads the site directory and would otherwise list them as ones. */
export const ABOUT_PAGE = "about.html";

/** The project overview. It answered `/` until spec 100 gave the root to
 *  the spec list, so it needs a filename of its own — and the Bun server
 *  never reaches `serveStatic` for `/` any more.
 *
 *  Since spec 115 the file itself is a redirect: the overview is SERVED,
 *  at `PROJECTS_ROUTE`. The filename stays because people bookmarked it
 *  and because `deploy/rsync-publish.sh` will not publish a site without
 *  it. */
export const OVERVIEW_PAGE = "projects.html";

/** Where the overview actually lives (spec 115): a served route, so the
 *  Add and Remove controls on it have a token to be checked against. */
export const PROJECTS_ROUTE = "/projects";

/** Where a spec is made (spec 121). It was a disclosure folded into the
 *  spec list until the button that opened it became a link to here. */
export const NEW_SPEC_ROUTE = "/new";

/** Where a project's own page is SERVED (spec 185). The generated
 *  `<slug>.html` is still written and still reachable; this is the one
 *  a live server links to, because it is the one that can answer what
 *  the config file says right now. */
export const projectPagePath = (name: string): string => `/projects/${encodeURIComponent(name)}`;
