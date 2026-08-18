// The dashboard's rendering, one file per page:
//
//   render/site.ts        projects.html + one page per project (static)
//   render/queue-list.ts  / — the form and the spec list
//   render/job-page.ts    /specs/<id> — one job, in full
//   render/shell.ts       the frame all four sit in
//   render/job-state.ts   what a job looks like to a page
//   render/html.ts        escaping and formatting
//   render/css.ts         the stylesheet, inlined into every page
//
// This file is the door: callers ask render.ts for a page and do not
// have to know which file it lives in. Every page is self-contained —
// inline CSS, no external references — because the generated site is
// published as plain files. The spec list at `/` is the one page that
// carries browser code, compiled from queue-client.ts.

export { ABOUT_PAGE, OVERVIEW_PAGE, renderSite, navEntries } from "./render/site.ts";
export type { Page, ProjectView, SpecView } from "./render/site.ts";

export type { NavEntry } from "./render/shell.ts";


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
export type { JobDetailView, JobLiveView, JobStepResultView, JobTab } from "./render/job-page.ts";
