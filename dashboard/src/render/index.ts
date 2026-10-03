// The dashboard's rendering, one file per page:
//
//   render/projects-page.ts  /projects — the listing, the panel that adds
//                            and removes projects, and the served
//                            `/projects/<name>` that carries the config
//                            and the readiness answer
//   render/specs-list.ts  / — the spec list
//   render/new-spec-page.ts  /new — the form that makes a spec
//   render/job-page.ts    /jobs/<id> — one job, in full
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
// inline CSS, no external references.

export {
  NEW_SPEC_ROUTE, OVERVIEW_PAGE, PROJECTS_ROUTE, projectListBody,
  navEntries,
  // `/projects/<name>` — the project's own page, served (spec 185), so
  // what it says about the config file is true when it is read rather
  // than at some earlier time.
  projectPagePath, renderProjectPage,
  renderProjectsPage,
  renderAddProjectPage,
  ADD_PROJECT_ROUTE,
} from "./pages/projects-page";
export type { ProjectPageOptions, ProjectView, SpecView, ProjectsPageOptions, ProjectDrift } from "./pages/projects-page";

export { renderNewSpecPage } from "./pages/new-spec-page.ts";
export type { NewSpecPageOptions } from "./pages/new-spec-page.ts";

export type { NavEntry } from "./ui/shell.ts";

export { backLink, resolveBackHref } from "./ui/components";

export {
  AI_TABS, OTHER_STEPS, renderSettingsPage, resolveSettingsTab, SETTINGS_GROUPS, SETTINGS_ROUTE, SETTINGS_STEPS,
  SETTINGS_TABS, settingsRowChoice, SPEC_STEPS, UNROWED_STEPS,
} from "./pages/settings-page";
export type { SettingsGroup, SettingsPageOptions, SettingsPanel } from "./pages/settings-page";
export {
  CHECKABLE_TOOLS, isToolPart, TOOL_PARTS, TOOL_TAB_LABELS, TOOL_TABS, toolPanel, toolPart,
} from "./pages/settings-page/tools.ts";
export type { CheckableTool, ExtraCheck, ToolCheck, ToolPart } from "./pages/settings-page/tools.ts";
export { usageView } from "./pages/settings-page/usage.ts";
export type { ToolUsage, UsageView, UsageWindow } from "./pages/settings-page/usage.ts";
export {
  choiceModel, choiceOf, modelLists, MODELS_ADD_ROUTE, MODELS_REMOVE_ROUTE, sameModel,
} from "./pages/settings-page/models.ts";
export type { ModelsPanel, OfferedModel, ToolModels } from "./pages/settings-page/models.ts";

// /test-servers (spec 425, REQ-3/REQ-4): every tracked test server,
// across every project, in one place.
export { renderTestServersPage, TEST_SERVERS_ROUTE } from "./pages/test-servers-page.ts";
export type { TestServerRow, TestServersPageOptions } from "./pages/test-servers-page.ts";

// /schedule (spec 272): the aggregate page listing every allowed
// project's scheduled jobs, an entry's own page, and the page that
// makes an entry.
export {
  renderSchedulePage, renderScheduleDetailPage, renderScheduleNewPage,
  NEW_SCHEDULE_DEFAULTS, scheduleNewPath,
  renderReportPanel, buildReportDocument,
  SCHEDULE_ROUTE, SCHEDULE_TABS, schedulePagePath, scheduleRunPath, scheduleSettingsPath, scheduleTabPath,
  renderProposalsPanel,
} from "./pages/schedule-page";
export type {
  SchedulePageOptions, SchedulePageRow, ScheduleDetailPageOptions, ScheduleTab,
} from "./pages/schedule-page";

// The eight answers that make the dashboard an app you install (spec
// 173). Unlike every other export here they are not pages: they are
// what `serve.ts` puts behind /manifest.webmanifest, /sw.js and the
// icon paths, computed rather than read from disk like the rest
// of this file.
export {
  APPLE_TOUCH_ICON,
  APP_BADGE_PNG_96,
  APP_ICON,
  APP_ICON_MASKABLE,
  APP_ICON_MASKABLE_PNG_512,
  APP_ICON_PNG_192,
  APP_ICON_PNG_512,
  PWA_FILES,
  PWA_LINKS,
  SERVICE_WORKER,
  WEBMANIFEST,
} from "./ui/pwa.ts";


// `stepBoxes` and `specSummary` used to be exported alongside these
// two. They are internal now: both take a spec ROW rather than a
// target, and a row is an internal shape with no caller outside
// specs-list.ts.
export {
  FILTER_KEYS, PHASE_LINES, computeSpecTotalDurationMs,
  filterShowsArchived, NOT_VERIFIED_KEY, parsePhaseKeys, phaseKey, phasePips, phasesFor, renderSpecGroupRows, renderSpecsPage, renderSpecsRows,
} from "./pages/specs-list";
export type {
  ArchivedSpecView, Phase, PhaseMessages, SpecsFilter, SpecsPageOptions, SpecTarget,
} from "./pages/specs-list";

export type { QueueRowView } from "./ui/job-state";

export { renderJobDetailPage } from "./pages/job-page";
export type { JobDetailView, JobStepResultView, JobTab, SpecFileView } from "./pages/job-page";

// `/specs/<project>/<specFolder>` — the SPEC, not one of its runs (spec
// 150). It shares the job page's tab bar and steps table rather than
// carrying copies of them.
export {
  EDITABLE_SPEC_FILE,
  STATUS_SPEC_FILE,
  FILE_TABS,
  resolveSpecTab,
  TAB_FILES,
  documentTabScript,
  renderSpecPage,
  renderSpecPageHead,
  renderSpecPageRest,
  renderSpecPageFailedRest,
  specPagePath,
  specTabPath,
} from "./pages/spec-page";
export type { SpecCheckView, SpecChecksView, SpecPageView } from "./pages/spec-page";
