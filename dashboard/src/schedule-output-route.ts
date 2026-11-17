export const SCHEDULE_OUTPUT_ROUTE_PREFIX = "/schedule-output/";

export const isScheduleOutputPath = (path: string): boolean =>
  path.startsWith(SCHEDULE_OUTPUT_ROUTE_PREFIX);

export const scheduleOutputRelativePath = (path: string): string =>
  path.slice(SCHEDULE_OUTPUT_ROUTE_PREFIX.length - 1);

export const scheduleRunOutputPath = (project: string, specFolder: string, runId: string): string =>
  `${SCHEDULE_OUTPUT_ROUTE_PREFIX}${project}/${specFolder}/runs/${runId}/`;
