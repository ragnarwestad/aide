export interface SpecTabCounts { activeJobs: number; openSpecs: number }

let read: (() => SpecTabCounts) | undefined;

export function setSpecActivityCounts(source: (() => SpecTabCounts) | undefined): void {
  read = source;
}

export function readSpecActivityCounts(): SpecTabCounts {
  return read?.() ?? { activeJobs: 0, openSpecs: 0 };
}
