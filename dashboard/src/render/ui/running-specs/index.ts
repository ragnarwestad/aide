import type { SpecActivityCounts } from "../../../queue/job-rules/running-specs.ts";

export interface SpecTabCounts extends SpecActivityCounts { openSpecs: number }

let read: (() => SpecTabCounts) | undefined;

export function setSpecActivityCounts(source: (() => SpecTabCounts) | undefined): void {
  read = source;
}

export function readSpecActivityCounts(): SpecTabCounts {
  return read?.() ?? { running: 0, queued: 0, openSpecs: 0 };
}
