// The schedule entry's own paths and tabs (spec 276) — the same
// path/tab-list shape `spec-page/tabs.ts` already has for a spec.

export const schedulePagePath = (project: string, name: string): string =>
  `/schedule/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;

export const scheduleTabPath = (project: string, name: string, tab: string): string =>
  `${schedulePagePath(project, name)}?tab=${encodeURIComponent(tab)}`;

export const newSchedulePath = (project: string): string =>
  `/schedule/${encodeURIComponent(project)}/new`;

export const deleteSchedulePath = (project: string, name: string): string =>
  `${schedulePagePath(project, name)}/delete`;

export const SCHEDULE_TABS = ["overview", "history"] as const;
export type ScheduleTab = (typeof SCHEDULE_TABS)[number];
