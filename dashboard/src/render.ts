// The dashboard's rendering, one file per page:
//
//   render/site.ts        index.html + one page per project (static)
//   render/live.ts        /live
//   render/queue-list.ts  /specs — the form and the spec list
//   render/job-page.ts    /specs/<id> — one job, in full
//   render/shell.ts       the frame all four sit in
//   render/job-state.ts   what a job looks like to a page
//   render/html.ts        escaping and formatting
//   render/css.ts         the stylesheet, inlined into every page
//
// This file is the door: callers ask render.ts for a page and do not
// have to know which file it lives in. Every page is self-contained —
// inline CSS, no external references — because the generated site is
// published as plain files. /queue is the one page that carries browser
// code, compiled from queue-client.ts.

export { renderSite, navEntries } from "./render/site.ts";
export type { Page, ProjectView, SpecView } from "./render/site.ts";

export type { NavEntry } from "./render/shell.ts";

export { renderLivePage } from "./render/live.ts";
export type { LiveRowView } from "./render/live.ts";

export { renderQueuePage, renderQueueRows, specSummary, stepBoxes } from "./render/queue-list.ts";
export type { QueueFilter, QueuePageOptions, QueueTarget } from "./render/queue-list.ts";

export type { QueueRowView } from "./render/job-state.ts";

export { renderJobDetailPage } from "./render/job-page.ts";
export type { JobDetailView, JobLiveView, JobStepResultView, JobTab } from "./render/job-page.ts";
