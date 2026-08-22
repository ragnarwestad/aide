// The dashboard's rendering, one file per page:
//
//   render/site.ts        projects.html + one page per project — the
//                         generated file, and the served `/projects/<name>`
//                         that carries the config and the readiness answer
//   render/projects-page.ts  /projects — the listing, and the panel that
//                            adds and removes projects
//   render/queue-list.ts  / — the spec list
//   render/new-spec-page.ts  /new — the form that makes a spec
//   render/job-page.ts    /specs/<id> — one job, in full
//   render/spec-page.ts   /specs/<project>/<spec> — the whole spec
//   render/archive-page.ts   /archive — every archived spec, by project
//   render/shell.ts       the frame they all sit in
//   render/job-state.ts   what a job looks like to a page
//   render/html.ts        escaping and formatting
//   render/css.ts         the stylesheet, inlined into every page
//   render/pwa.ts         the manifest, the icons and the worker that
//                         make the served dashboard installable
//
// This file is the door: callers ask render.ts for a page and do not
// have to know which file it lives in. Every page is self-contained —
// inline CSS, no external references — because the generated site is
// published as plain files. The three SERVED pages — the spec list at
// `/`, the New-spec form at `/new` and Projects at `/projects` — carry
// browser code, compiled from queue-client.ts; the generated ones carry
// none.

export {
  ABOUT_PAGE, ARCHIVE_ROUTE, NEW_SPEC_ROUTE, OVERVIEW_PAGE, PROJECTS_ROUTE, projectListBody, renderSite,
  navEntries,
  // `/projects/<name>` — the project's own page, served (spec 185), so
  // what it says about the config file is true when it is read rather
  // than when the site was last generated.
  projectPagePath, renderProjectPage,
} from "./render/site.ts";
export type { Page, ProjectView, SpecView } from "./render/site.ts";

export { renderProjectsPage,
  renderAddProjectPage,
  renderProjectSettingsPage,
  renderRemoveProjectPage,
  ADD_PROJECT_ROUTE,
  projectSettingsRoute,
  removeProjectRoute } from "./render/projects-page.ts";
export type { ProjectsPageOptions } from "./render/projects-page.ts";

export { renderNewSpecPage } from "./render/new-spec-page.ts";
export type { NewSpecPageOptions } from "./render/new-spec-page.ts";

export type { NavEntry } from "./render/shell.ts";

// The five answers that make the dashboard an app you install (spec
// 173). Unlike every other export here they are not pages: they are
// what `serve.ts` puts behind /manifest.webmanifest, /sw.js and the
// three icon paths, computed rather than read from disk like the rest
// of this file.
export {
  APPLE_TOUCH_ICON,
  APP_ICON,
  APP_ICON_MASKABLE,
  SERVICE_WORKER,
  WEBMANIFEST,
} from "./render/pwa.ts";


// `stepBoxes` and `specSummary` used to be exported alongside these
// two. They are internal now: both take a spec ROW rather than a
// target, and a row is an internal shape with no caller outside
// queue-list.ts.
// `FILTER_KEYS`/`FILTER_FIELD_PREFIX` are the page's, not the server's:
// the forms send the view and the server sends it back, and one list
// kept in two places would eventually forget a key on one side.
export { FILTER_FIELD_PREFIX, FILTER_KEYS, renderQueuePage, renderQueueRows } from "./render/queue-list.ts";
export type { QueueFilter, QueuePageOptions, QueueTarget } from "./render/queue-list.ts";

export type { BranchView, QueueRowView } from "./render/job-state.ts";

export { renderJobDetailPage } from "./render/job-page.ts";
export type { JobDetailView, JobStepResultView, JobTab, SpecFileView } from "./render/job-page.ts";

// `/specs/<project>/<specFolder>` — the SPEC, not one of its runs (spec
// 150). It shares the job page's tab bar, activity block and steps
// table rather than carrying copies of them.
export {
  EDITABLE_SPEC_FILE,
  STATUS_SPEC_FILE,
  renderSpecPage,
  specEditPath,
  specPagePath,
} from "./render/spec-page.ts";
export type { SpecCheckView, SpecChecksView, SpecPageView } from "./render/spec-page.ts";

// `/archive` — every archived spec, grouped by project (spec 163). The
// pages it links to are the spec page's; what was missing was the way
// in.
export { renderArchivePage } from "./render/archive-page.ts";
export type { ArchiveFilter, ArchivePageView, ArchivedSpecView } from "./render/archive-page.ts";

// `/specs/<project>/<specFolder>/edit` — the one of the four files a
// person owns, in a textarea (spec 162).
export { renderSpecEditPage } from "./render/spec-edit-page.ts";
export type { SpecEditPageView } from "./render/spec-edit-page.ts";
