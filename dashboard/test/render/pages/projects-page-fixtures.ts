// Shared test data for the projects-page suite, split by theme across
// projects-page-listing.test.ts, projects-page-add-remove-controls.test.ts
// and projects-page-add-form.test.ts (split out of projects-page.test.ts).
//
// Spec 115: `/projects` is a served page, and the Projects panel lives
// there. Spec 112 put the panel on `/` because the overview was a
// generated file with no server behind it to check a token against —
// once the overview IS served, that reason is gone, and the page that
// LISTS the projects is the page that changes the list.
//
// The panel's own tests moved here from render.test.ts with the panel:
// same markup, same questions, one page further along.

import {
  renderProjectsPage,
  type ProjectView,
  type ProjectsPageOptions,
} from "../../../src/render.ts";

export const AT = "2026-08-19T00:00:00Z";
export const NAV = [{ label: "Projects", path: "/projects" }];

export function project(name: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return { name, manifest: { ok: true, data: { name } }, specs: [], ...overrides };
}

export const page = (projects: ProjectView[], opts: Partial<ProjectsPageOptions> = {}): string =>
  renderProjectsPage(projects, AT, NAV, opts);
