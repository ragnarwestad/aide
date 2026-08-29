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
  ABOUT_PAGE, NEW_SPEC_ROUTE, OVERVIEW_PAGE, PROJECTS_ROUTE, projectListBody, renderSite,
  navEntries,
  // `/projects/<name>` — the project's own page, served (spec 185), so
  // what it says about the config file is true when it is read rather
  // than when the site was last generated.
  projectPagePath, renderProjectPage,
} from "./render/pages/site.ts";
export type { Page, ProjectPageOptions, ProjectView, SpecView } from "./render/pages/site.ts";

export { renderProjectsPage,
  renderAddProjectPage,
  renderRemoveProjectPage,
  ADD_PROJECT_ROUTE,
  removeProjectRoute } from "./render/pages/projects-page.ts";
export type { ProjectsPageOptions, ProjectDrift } from "./render/pages/projects-page.ts";

export { renderNewSpecPage } from "./render/pages/new-spec-page.ts";
export type { NewSpecPageOptions } from "./render/pages/new-spec-page.ts";

export type { NavEntry } from "./render/ui/shell.ts";

export { backLink, resolveBackHref } from "./render/ui/components.ts";

export { renderSettingsPage, SETTINGS_ROUTE, SETTINGS_STEPS } from "./render/pages/settings-page.ts";
export type { SettingsPageOptions } from "./render/pages/settings-page.ts";

// /schedule (spec 272): the aggregate page listing every allowed
// project's `schedule:` entries.
export { renderSchedulePage, SCHEDULE_ROUTE } from "./render/pages/schedule-page.ts";
export type { SchedulePageOptions, SchedulePageRow } from "./render/pages/schedule-page.ts";

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
} from "./render/ui/pwa.ts";


// `stepBoxes` and `specSummary` used to be exported alongside these
// two. They are internal now: both take a spec ROW rather than a
// target, and a row is an internal shape with no caller outside
// queue-list.ts.
// `FILTER_KEYS`/`FILTER_FIELD_PREFIX` are the page's, not the server's:
// the forms send the view and the server sends it back, and one list
// kept in two places would eventually forget a key on one side.
export {
  FILTER_FIELD_PREFIX, FILTER_KEYS, FROM_LIST_FIELD, PHASE_LINES, computeSpecTotalDurationMs,
  filterShowsArchived, phasePips, phasesFor, renderQueuePage, renderQueueRows,
} from "./render/pages/queue-list.ts";
export type {
  ArchivedSpecView, Phase, QueueFilter, QueuePageOptions, QueueTarget,
} from "./render/pages/queue-list.ts";

export type { BranchView, QueueRowView } from "./render/ui/job-state.ts";

export { renderJobDetailPage } from "./render/pages/job-page.ts";
export type { JobDetailView, JobStepResultView, JobTab, SpecFileView } from "./render/pages/job-page.ts";

// `/specs/<project>/<specFolder>` — the SPEC, not one of its runs (spec
// 150). It shares the job page's tab bar and steps table rather than
// carrying copies of them.
export {
  EDITABLE_SPEC_FILE,
  STATUS_SPEC_FILE,
  renderSpecPage,
  renderResetSpecPage,
  specPagePath,
  specTabPath,
} from "./render/pages/spec-page.ts";
export type { SpecCheckView, SpecChecksView, SpecPageView } from "./render/pages/spec-page.ts";
