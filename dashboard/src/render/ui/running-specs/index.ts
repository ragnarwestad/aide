import type { SpecActivityCounts } from "../../../queue/job-rules/running-specs.ts";

let read: (() => SpecActivityCounts) | undefined;

export function setSpecActivityCounts(source: (() => SpecActivityCounts) | undefined): void {
  read = source;
}

export function readSpecActivityCounts(): SpecActivityCounts {
  return read?.() ?? { running: 0, queued: 0 };
}
