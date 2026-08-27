// The project pages. Two of the three are SERVED: the rows of the
// `/projects` list (`projectListBody`/`overviewRow`), and a project's
// own page (`renderProjectPage`, `/projects/<name>`, spec 185). The
// third, `renderSite`, is what is left of the static half — the
// redirect projects.html became (spec 115) and the About page. The
// page per project went on 2026-08-22; the comment on `renderSite`
// says why.
//
// A project's own page carries what a generated file could not answer:
// what its `.aide/config` says, and whether a run could start there.
// It does not repeat the manifest (spec 238) — that was a frozen copy
// of a file nothing on the page could act on, and a manifest that
// fails to parse says so on the project's row in the list.
//
// Split by theme into site/ (split site.ts by theme): types.ts (the
// view types), routes.ts (nav and paths), overview-list.ts (the
// `/projects` list rows), settings-table.ts (the project page's
// unified settings table) and project-page.ts (drift/deploy,
// readiness, schedule, and `renderProjectPage` itself). `renderSite`
// — what is left of the static generator — stays here.

import { pageShell, aboutProse, buildStampLine } from "../ui/shell.ts";
import { navEntries, ABOUT_PAGE, OVERVIEW_PAGE, PROJECTS_ROUTE } from "./site/routes.ts";
import type { ProjectView, Page } from "./site/types.ts";

export type { SpecView, ProjectView, Page, ProjectDrift, ProjectPageOptions } from "./site/types.ts";
export { UNCHECKED_NOTE } from "./site/types.ts";
export { navEntries, ABOUT_PAGE, OVERVIEW_PAGE, PROJECTS_ROUTE, NEW_SPEC_ROUTE, projectPagePath } from "./site/routes.ts";
export { projectListBody, projectSummary } from "./site/overview-list.ts";
export { driftPrefix, renderProjectPage } from "./site/project-page.ts";

// The prose itself lives in shell.ts, where the About DIALOG on every
// page shows the same words — this page is the no-JS fallback the menu
// item's href still points at.
function aboutBody(generatedAt: string): string {
  return aboutProse() + buildStampLine(generatedAt);
}

export function renderSite(_projects: ProjectView[], generatedAt: string): Page[] {
  const entries = navEntries();

  // The overview is served now (spec 115), because the controls that
  // change the project list need a token checked per request and a file
  // has no server behind it to do that. What is written HERE is the way
  // on: the script for a browser, the link for everything else. Both are
  // in the generated content rather than in the server, so a site
  // rsynced behind a plain file server sends the reader on too.
  const moved =
    `<p>This page has moved to <a href="${PROJECTS_ROUTE}">${PROJECTS_ROUTE}</a>.</p>`;
  const pages: Page[] = [
    {
      path: OVERVIEW_PAGE,
      // The tab always leads with aide; the tagline rides on the
      // overview, the one page that is about aide itself.
      html: pageShell("Projects", entries, PROJECTS_ROUTE, moved, generatedAt, undefined, {
        docTitle: "aide -board — from spec to merge",
        // The query string comes along: a bookmark that carried the
        // token is how a reader arrives here with one.
        script: `location.replace('${PROJECTS_ROUTE}' + location.search);`,
      }),
    },
  ];
  pages.push({
    path: ABOUT_PAGE,
    html: pageShell("About", entries, ABOUT_PAGE, aboutBody(generatedAt), generatedAt, undefined, {
      buildStamp: generatedAt,
    }),
  });
  // A page per project was written here until 2026-08-22. The server
  // serves one now (spec 185) — the one with the settings and the
  // readiness answer on it, reached from the Projects page — and a
  // frozen copy beside it was a second page with the same name, one
  // tab away from the live one and always a little out of date. The
  // overview above went the same way at spec 115 and is a redirect.
  return pages;
}
